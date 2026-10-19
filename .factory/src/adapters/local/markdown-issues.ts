import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { IssueComment } from "../../seams/tracker.ts";

/**
 * The local issue files: `.scratch/<feature>/issues/NN-<slug>.md`, as in
 * `.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md`.
 *
 * - `# NN: Title` on the first line;
 * - `Spec: [..](../spec.md)` links the parent spec;
 * - `Blocked by: 02, 08` (or `None …`) lists the blockers;
 * - `Status: <label>` is the issue's single label; `done` closes it;
 * - `## Comments` (last section) holds the conversation. Factory comments are
 *   fenced in `<!-- factory:comment … -->` blocks; any other text there is
 *   the local human's.
 */

const STATUS = /^(\*\*)?Status:(\*\*)?[ \t]*(.*)$/m;
const BLOCKED_BY = /^(\*\*)?Blocked by:(\*\*)?[ \t]*(.*)$/m;
const SPEC_LINK = /^(?:\*\*)?Spec:(?:\*\*)?[ \t]*\[[^\]]*\]\(([^)\s]+)\)/m;
const COMMENTS = /^## Comments[ \t]*$/m;
const OPEN = /<!-- factory:comment id="([^"]+)" author="([^"]+)" -->\n/g;
const CLOSE = "<!-- /factory:comment -->";
const CLOSED_STATUSES = new Set(["done", "wontfix"]);

export interface IssueFile {
  number: number;
  path: string;
  /** The `NN` of the file name, as written (e.g. `07`). */
  id: string;
}

export interface ParsedIssue {
  title: string;
  body: string;
  status: string;
  blockedBy: number[];
  /** Absolute path of the linked spec, if any. */
  specPath: string | null;
  factoryComments: { id: string; author: string; body: string }[];
  /** The rest of `## Comments`: what the human wrote. */
  humanText: string;
}

/** `NN-slug.md`: the name of an issue file; group 1 is the number. */
export const ISSUE_FILE = /^(\d+)-.*\.md$/;

export class MarkdownIssues {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async files(): Promise<IssueFile[]> {
    const names = await readdir(this.dir).catch(() => []);
    return names
      .map((name) => ISSUE_FILE.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ number: Number(m[1]), id: m[1]!, path: join(this.dir, m[0]) }))
      .sort((a, b) => a.number - b.number);
  }

  async file(number: number): Promise<IssueFile> {
    const matches = (await this.files()).filter((f) => f.number === number);
    if (matches.length === 0) throw new Error(`No issue #${number} in ${this.dir}`);
    if (matches.length > 1) throw new Error(`More than one file for issue #${number} in ${this.dir}`);
    return matches[0]!;
  }

  async read(number: number): Promise<{ file: IssueFile; text: string; issue: ParsedIssue }> {
    const file = await this.file(number);
    const text = await readFile(file.path, "utf8");
    return { file, text, issue: parse(text, file.path) };
  }

  async readSpec(path: string): Promise<string | null> {
    return readFile(path, "utf8").catch(() => null);
  }

  /** Rewrites the Status value, keeping the line's formatting. */
  async setStatus(number: number, status: string): Promise<void> {
    const { file, text } = await this.read(number);
    if (!STATUS.test(text)) throw new Error(`${file.path} has no Status: line`);
    await writeFile(file.path, text.replace(STATUS, (_, b1 = "", b2 = "") => `${b1}Status:${b2} ${status}`));
  }

  /** Appends a Factory comment at the end of `## Comments` (created when missing). */
  async appendComment(number: number, author: string, body: string): Promise<string> {
    const { file, text, issue } = await this.read(number);
    const id = `f${issue.factoryComments.length + 1}`;
    const withSection = COMMENTS.test(text) ? text.replace(/\s*$/, "\n") : `${text.replace(/\s*$/, "\n")}\n## Comments\n`;
    await writeFile(file.path, `${withSection}\n${block(id, author, body)}\n`);
    return id;
  }

  /**
   * Replaces the body of the Factory comment that contains `marker`, or appends
   * it: the single-comment pattern (evidence, the local pull request).
   */
  async upsertComment(number: number, author: string, marker: string, body: string): Promise<void> {
    const { file, text, issue } = await this.read(number);
    const existing = issue.factoryComments.find((c) => c.body.includes(marker));
    if (!existing) {
      await this.appendComment(number, author, body);
      return;
    }
    const start = text.indexOf(`<!-- factory:comment id="${existing.id}" `);
    const end = text.indexOf(CLOSE, start) + CLOSE.length;
    await writeFile(file.path, text.slice(0, start) + block(existing.id, author, body) + text.slice(end));
  }
}

function block(id: string, author: string, body: string): string {
  // A comment cannot close its own block (agent output is untrusted).
  const safe = body.replaceAll(CLOSE, "<!-- / factory:comment -->").trim();
  return `<!-- factory:comment id="${id}" author="${author}" -->\n${safe}\n${CLOSE}`;
}

export function parse(text: string, path: string): ParsedIssue {
  const titleLine = /^# (.*)$/m.exec(text)?.[1] ?? "";
  const title = titleLine.replace(/^\d+:\s*/, "").trim();
  const commentsAt = text.search(COMMENTS);
  const head = commentsAt === -1 ? text : text.slice(0, commentsAt);
  const comments = commentsAt === -1 ? "" : text.slice(commentsAt).replace(COMMENTS, "");
  const body = head.replace(/^# .*\n/m, "").trim();

  const status = (STATUS.exec(head)?.[3] ?? "").replaceAll("`", "").trim();
  const blockedLine = BLOCKED_BY.exec(head)?.[3] ?? "";
  const blockedBy = [...blockedLine.matchAll(/\b\d+\b/g)].map((m) => Number(m[0]));
  const link = SPEC_LINK.exec(head)?.[1];
  const specPath = link ? resolve(dirname(path), link) : null;

  const factoryComments: ParsedIssue["factoryComments"] = [];
  let humanText = "";
  let cursor = 0;
  for (const open of comments.matchAll(OPEN)) {
    if (open.index < cursor) continue;
    const start = open.index + open[0].length;
    const end = comments.indexOf(`\n${CLOSE}`, start);
    if (end === -1) break;
    humanText += comments.slice(cursor, open.index);
    factoryComments.push({ id: open[1]!, author: open[2]!, body: comments.slice(start, end) });
    cursor = end + CLOSE.length + 1;
  }
  humanText += comments.slice(cursor);
  return { title, body, status, blockedBy, specPath, factoryComments, humanText: humanText.trim() };
}

export function isClosed(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

export function comments(issue: ParsedIssue, human: string): IssueComment[] {
  const own = issue.humanText ? [{ id: "human", author: human, body: issue.humanText }] : [];
  return [...own, ...issue.factoryComments];
}
