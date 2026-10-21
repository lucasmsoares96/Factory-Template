import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReviewOutput } from "./result.ts";
import type { ReviewThread } from "./seams/code-host.ts";
import type { Issue } from "./seams/tracker.ts";

/**
 * Prompts for each agent session, rendered from the English templates in
 * `.factory/prompts/`. `{{NAME}}` is a variable; `{{RULES}}` is `rules.md`,
 * the hard rules every template repeats. Inputs are the issue with its
 * comments, `git log <base>..HEAD` and the previous attempt's feedback:
 * never a resumed session.
 */

export const PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));

export type Template = "development" | "review" | "triage" | "pull-request" | "pr-feedback" | "update-branch";

const cache = new Map<string, string>();
function load(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(`${PROMPTS_DIR}${name}.md`, "utf8");
    cache.set(name, text);
  }
  return text;
}

/** Fills `{{NAME}}` placeholders; a placeholder without a value is an error. */
export function renderTemplate(name: Template, vars: Record<string, string>): string {
  const fill = (text: string, file: string) =>
    text.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
      const value = vars[key];
      if (value === undefined) throw new Error(`${file}.md needs {{${key}}}`);
      return value;
    });
  const rules = fill(load("rules"), "rules").trim();
  const filled = fill(load(name).replaceAll("{{RULES}}", rules), name);
  return filled.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export interface StageContext {
  issue: Issue;
  /** `git log --format='%h %s' <base>..HEAD`. */
  log: string;
  /** Why the previous attempt failed, if it did. */
  feedback: string | null;
}

/** The issue and its comments, fenced as untrusted content. */
function issueBlock(issue: Issue): string {
  const comments = issue.comments.map((c) => `<comment author="${c.author}">\n${c.body}\n</comment>`).join("\n");
  return [`<issue number="${issue.number}">`, `# ${issue.title}`, "", issue.body, comments, "</issue>"].join("\n");
}

export function developmentPrompt(ctx: StageContext & { base?: string }): string {
  return renderTemplate("development", {
    NUMBER: String(ctx.issue.number),
    BASE: ctx.base ?? "main",
    ISSUE: issueBlock(ctx.issue),
    LOG: ctx.log || "(none)",
    FEEDBACK: ctx.feedback ? `\nFeedback from the previous attempt:\n${ctx.feedback}` : "",
  });
}

export interface ReviewContext extends Omit<StageContext, "feedback"> {
  /** Last commit an earlier Review saw; null on the first Review. */
  since: string | null;
  /** What the earlier Reviews of this run reported. */
  findings: ReviewOutput[];
}

export function reviewPrompt(ctx: ReviewContext): string {
  const findings = ctx.findings.flatMap((f) => [f.summary, ...f.inline.map((c) => `- ${c.path}:${c.line} ${c.body}`)]);
  return renderTemplate("review", {
    NUMBER: String(ctx.issue.number),
    SCOPE: ctx.since
      ? `Review only what changed since ${ctx.since} (\`git diff ${ctx.since}..HEAD\`), and check that the previous findings are dealt with. Do not start a second broad review.`
      : "Review the whole branch.",
    FINDINGS: findings.length > 0 ? `\nPrevious findings:\n${findings.join("\n")}` : "",
    ISSUE: issueBlock(ctx.issue),
    LOG: ctx.log || "(none)",
  });
}

export interface PullRequestContext extends Omit<StageContext, "feedback"> {
  base: string;
  /** What the run ended with: E2E green and in which attempt, or why it escalated and the last E2E output. */
  result: string;
  /** Local paths of the prints, grouped by Product. */
  prints: { product: string; path: string }[];
}

export function pullRequestPrompt(ctx: PullRequestContext): string {
  const byProduct = Map.groupBy(ctx.prints, (p) => p.product);
  const prints = [...byProduct].map(([product, files]) => [`${product}:`, ...files.map((f) => `- ${f.path}`)].join("\n"));
  return renderTemplate("pull-request", {
    NUMBER: String(ctx.issue.number),
    BASE: ctx.base,
    ISSUE: issueBlock(ctx.issue),
    LOG: ctx.log || "(none)",
    RESULT: ctx.result,
    PRINTS: prints.join("\n") || "(none)",
  });
}

/** Triage of a batch of `agent:explore` issues (`pnpm factory triage`). */
export function triagePrompt(ctx: { issues: Issue[] }): string {
  return renderTemplate("triage", {
    NUMBER: "N",
    ISSUES: ctx.issues.map(issueBlock).join("\n\n"),
  });
}

/** Review comments on a Factory pull request (ticket 18 runs it). */
export function prFeedbackPrompt(ctx: { issue: Issue; pr: number; log: string; threads: ReviewThread[] }): string {
  const threads = ctx.threads.map((t) =>
    [
      `<thread id="${t.id}"${t.path ? ` path="${t.path}"` : ""}>`,
      `<comment author="${t.author}">\n${t.body}\n</comment>`,
      ...t.replies.map((r) => `<comment author="${r.author}">\n${r.body}\n</comment>`),
      "</thread>",
    ].join("\n"),
  );
  return renderTemplate("pr-feedback", {
    NUMBER: String(ctx.issue.number),
    PR: String(ctx.pr),
    ISSUE: issueBlock(ctx.issue),
    THREADS: threads.join("\n\n") || "(no open threads)",
    LOG: ctx.log || "(none)",
  });
}

/** Merge conflicts with the base branch on a Factory branch (ticket 18 runs it). */
export function updateBranchPrompt(ctx: { issue: Issue; base: string; conflicts: string[] }): string {
  return renderTemplate("update-branch", {
    NUMBER: String(ctx.issue.number),
    BASE: ctx.base,
    CONFLICTS: ctx.conflicts.map((path) => `- \`${path}\``).join("\n"),
    ISSUE: issueBlock(ctx.issue),
  });
}
