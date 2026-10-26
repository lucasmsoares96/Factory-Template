import { cp, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { marked } from "../../marker.ts";
import type { FactoryConfig } from "../../config.ts";
import type { CodeHost, EvidenceImage, PullRequest, PushResult, Review, ReviewThread, SubmittedReview } from "../../seams/code-host.ts";
import { Git } from "../../git.ts";
import type { MarkdownIssues } from "./markdown-issues.ts";

const PR_MARKER = "<!-- factory:pr ";

interface LocalPr {
  number: number;
  branch: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: "open" | "closed";
  labels: string[];
}

export interface LocalCodeHostOptions {
  /** The host repository: the "forge" the branch lands in. */
  remote: string;
  /** The checkout that pushes (the publish job's working copy). */
  from: string;
  /** The ticket files: the pull request, the review and the evidence live in their `## Comments`. */
  files: MarkdownIssues;
  config: FactoryConfig;
  /** Who writes the comments. */
  self?: string;
}

/**
 * CodeHost for `pnpm factory local`: the branch is a local branch of the host
 * repository, pushed with the same lease as on a forge. The pull request of
 * issue N is number N: a single comment in the ticket that is edited as it
 * changes, its body with the prints beside it. Reviews are appended to the ticket's comments, and prints are
 * copied to `.scratch/<feature>/evidence/NN/`.
 */
export class LocalCodeHost implements CodeHost {
  private readonly options: LocalCodeHostOptions;
  private readonly self: string;

  constructor(options: LocalCodeHostOptions) {
    this.options = options;
    this.self = options.self ?? "factory";
  }

  async branchHead(branch: string): Promise<string | null> {
    try {
      return (await git(this.options.remote, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`)).trim();
    } catch {
      return null;
    }
  }

  async push(input: { branch: string; sha: string; expectedSha: string | null }): Promise<PushResult> {
    const ref = `refs/heads/${input.branch}`;
    try {
      await git(this.options.from, "push", "--quiet", "--porcelain", `--force-with-lease=${ref}:${input.expectedSha ?? ""}`, this.options.remote, `${input.sha}:${ref}`);
      return { ok: true };
    } catch (error) {
      const output = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`;
      if (/stale info|\[rejected\]|already exists/.test(output)) return { ok: false, reason: "branch-moved" };
      throw error;
    }
  }

  async openPrFor(branch: string): Promise<PullRequest | null> {
    const issue = this.issueOf(branch);
    if (issue === null) return null;
    const pr = await this.read(issue);
    return pr && pr.state === "open" && pr.branch === branch ? this.view(pr) : null;
  }

  async pullRequest(number: number): Promise<PullRequest | null> {
    const pr = await this.read(number);
    return pr ? this.view(pr) : null;
  }

  async commentPr(pr: number, body: string): Promise<void> {
    await this.options.files.appendComment(pr, this.self, marked(body));
  }

  async openDraftPr(input: { branch: string; base: string; title: string; body: string; images?: EvidenceImage[] }): Promise<PullRequest> {
    const number = this.issueOf(input.branch);
    if (number === null) throw new Error(`Local pull requests need a ${this.options.config.branchPrefix}N branch, got ${input.branch}`);
    const { images = [], ...rest } = input;
    const pr: LocalPr = { number, ...rest, body: await this.keepImages(number, rest.body, images), draft: true, state: "open", labels: [] };
    await this.write(pr);
    return this.view(pr);
  }

  async updatePrBody(pr: number, body: string, images: EvidenceImage[] = []): Promise<void> {
    const kept = await this.keepImages(pr, body, images);
    await this.update(pr, (p) => (p.body = kept));
  }

  async markReady(pr: number): Promise<void> {
    await this.update(pr, (p) => (p.draft = false));
  }

  async closePr(pr: number, comment?: string): Promise<void> {
    if (comment) await this.options.files.appendComment(pr, this.self, marked(comment));
    await this.update(pr, (p) => (p.state = "closed"));
  }

  async labelPr(pr: number, label: string): Promise<void> {
    await this.update(pr, (p) => void (p.labels.includes(label) || p.labels.push(label)));
  }

  async submitReview(pr: number, review: Review): Promise<void> {
    const inline = review.comments.map((c) => `- \`${c.path}:${c.line}\` ${c.body}`);
    const body = ["**Factory review**", "", review.body, ...(inline.length ? ["", "**Inline**", ...inline] : [])];
    await this.options.files.appendComment(pr, this.self, marked(body.join("\n")));
  }

  async threads(_pr: number): Promise<ReviewThread[]> {
    return [];
  }

  /** The local review lives in the ticket's `## Comments`; a local run has no separate reviews to read. */
  async reviews(_pr: number): Promise<SubmittedReview[]> {
    return [];
  }

  async replyToThread(): Promise<void> {
    throw new Error("Review threads are not available in local mode.");
  }

  /** Copies the prints to `.scratch/<feature>/evidence/NN/` and points the body at them, relative to the ticket. */
  private async keepImages(pr: number, body: string, images: EvidenceImage[]): Promise<string> {
    if (images.length === 0) return body;
    const file = await this.options.files.file(pr);
    const dir = evidenceDir(this.options.files.dir, file.id);
    let text = body;
    for (const image of images) {
      const target = join(dir, image.product, image.name);
      await mkdir(dirname(target), { recursive: true });
      await cp(image.path, target);
      text = text.replaceAll(image.path, relative(dirname(file.path), target));
    }
    return text;
  }

  async dispatch(workflow: string, _inputs: Record<string, string>): Promise<void> {
    throw new Error(`Dispatching \`${workflow}\` is not available in local mode: run \`pnpm factory local <N>\` for the issue.`);
  }

  private issueOf(branch: string): number | null {
    const prefix = this.options.config.branchPrefix;
    if (!branch.startsWith(prefix)) return null;
    const n = Number(branch.slice(prefix.length));
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  private async read(issue: number): Promise<LocalPr | null> {
    const { issue: parsed } = await this.options.files.read(issue);
    const comment = parsed.factoryComments.find((c) => c.body.startsWith(PR_MARKER));
    if (!comment) return null;
    const json = comment.body.slice(PR_MARKER.length, comment.body.indexOf(" -->"));
    return JSON.parse(json) as LocalPr;
  }

  private async update(number: number, change: (pr: LocalPr) => void): Promise<void> {
    const pr = await this.read(number);
    if (!pr) throw new Error(`No local pull request for issue #${number}`);
    change(pr);
    await this.write(pr);
  }

  private async write(pr: LocalPr): Promise<void> {
    const state = pr.state === "closed" ? "closed" : pr.draft ? "draft" : "ready";
    const body = [
      `${PR_MARKER}${JSON.stringify(pr).replaceAll("-->", "--\\u003e")} -->`,
      `**Pull request (local, ${state}):** \`${pr.branch}\` → \`${pr.base}\``,
      "",
      `**${pr.title}**`,
      "",
      pr.body,
      ...(pr.labels.length ? ["", `Labels: ${pr.labels.map((l) => `\`${l}\``).join(", ")}`] : []),
    ].join("\n");
    await this.options.files.upsertComment(pr.number, this.self, PR_MARKER, marked(body));
  }

  private async view(pr: LocalPr): Promise<PullRequest> {
    return {
      number: pr.number,
      url: `local:${pr.branch}`,
      branch: pr.branch,
      headSha: (await this.branchHead(pr.branch)) ?? "",
      state: pr.state,
      draft: pr.draft,
    };
  }
}

/** `.scratch/<feature>/evidence/NN/`, next to the feature's `issues/`. */
export function evidenceDir(issuesDir: string, id: string): string {
  return join(dirname(issuesDir), "evidence", id);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return new Git(cwd).run(...args);
}
