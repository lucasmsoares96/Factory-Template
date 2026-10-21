import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { CodeHost, EvidenceGroup, PullRequest, PushResult, Review, ReviewThread } from "../../seams/code-host.ts";
import { GitHubApi, type GitHubApiOptions } from "./api.ts";

export const EVIDENCE_MARKER = "<!-- factory:evidence -->";

/** Runs `git <args>` in `cwd` with `env` added to the environment. */
export type GitRunner = (args: string[], options: { cwd: string; env: Record<string, string> }) => Promise<{ code: number; stderr: string }>;
/** Runs `gh <args>` with `env` added to the environment; throws on failure. */
export type GhRunner = (args: string[], env: Record<string, string>) => Promise<void>;

export interface GitHubCodeHostOptions extends GitHubApiOptions {
  baseBranch: string;
  /** The checkout the commits are pushed from. */
  cwd: string;
  /** Where to push; defaults to `https://github.com/<repo>.git`. Tests point it at a bare repository. */
  remoteUrl?: string;
  git?: GitRunner;
  gh?: GhRunner;
}

const prRow = z.object({
  number: z.number().int(),
  html_url: z.string(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().default(false),
  node_id: z.string().optional(),
  head: z.object({ ref: z.string(), sha: z.string() }),
});
const refRow = z.object({ object: z.object({ sha: z.string() }) });
const commentRow = z.object({ id: z.number(), body: z.string().nullable().optional() });
const reviewCommentRow = z.object({
  id: z.number(),
  path: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  user: z.object({ login: z.string() }).nullable(),
  in_reply_to_id: z.number().nullable().optional(),
});
const graphql = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() })).optional() });

/**
 * CodeHost over GitHub: REST by `fetch` and Zod, `git push` for the branch, and `gh` only to attach the prints to the
 * evidence comment (`--attach`, GitHub's own image storage; REST has no endpoint for it). The token stays in this class:
 * git and gh get it through their environment, never their arguments.
 */
export class GitHubCodeHost implements CodeHost {
  private readonly api: GitHubApi;
  private readonly options: GitHubCodeHostOptions;
  private readonly git: GitRunner;
  private readonly gh: GhRunner;

  constructor(options: GitHubCodeHostOptions) {
    this.options = options;
    this.api = new GitHubApi(options);
    this.git = options.git ?? runGit;
    this.gh = options.gh ?? runGh;
  }

  async branchHead(branch: string): Promise<string | null> {
    const ref = await this.api.getOrNull(this.api.repoPath(`/git/ref/heads/${branch}`), refRow);
    return ref?.object.sha ?? null;
  }

  async push(input: { branch: string; sha: string; expectedSha: string | null }): Promise<PushResult> {
    const ref = `refs/heads/${input.branch}`;
    const basic = Buffer.from(`x-access-token:${this.options.token}`).toString("base64");
    const result = await this.git(
      ["push", `--force-with-lease=${ref}:${input.expectedSha ?? ""}`, this.options.remoteUrl ?? `https://github.com/${this.options.repo}.git`, `${input.sha}:${ref}`],
      {
        cwd: this.options.cwd,
        // The header travels in the environment, so it is in no argv.
        env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    if (result.code === 0) return { ok: true };
    if (/stale info|\[rejected\]|fetch first|non-fast-forward/.test(result.stderr)) return { ok: false, reason: "branch-moved" };
    throw new Error(`git push failed (${result.code}): ${this.scrub(result.stderr).slice(0, 400)}`);
  }

  async openPrFor(branch: string): Promise<PullRequest | null> {
    const owner = this.options.repo.split("/")[0]!;
    const rows = await this.api.get(this.api.repoPath(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`), z.array(prRow));
    return rows[0] ? toPr(rows[0]) : null;
  }

  async pullRequest(number: number): Promise<PullRequest | null> {
    const row = await this.api.getOrNull(this.api.repoPath(`/pulls/${number}`), prRow);
    return row ? toPr(row) : null;
  }

  async commentPr(pr: number, body: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/issues/${pr}/comments`), { body });
  }

  async openDraftPr(input: { branch: string; base: string; title: string; body: string }): Promise<PullRequest> {
    const row = await this.api.request("POST", this.api.repoPath("/pulls"), prRow, {
      body: { head: input.branch, base: input.base, title: input.title, body: input.body, draft: true },
    });
    return toPr(row!);
  }

  async updatePrBody(pr: number, body: string): Promise<void> {
    await this.api.send("PATCH", this.api.repoPath(`/pulls/${pr}`), { body });
  }

  async markReady(pr: number): Promise<void> {
    const row = await this.api.get(this.api.repoPath(`/pulls/${pr}`), prRow);
    const response = await this.api.request("POST", "/graphql", graphql, {
      body: {
        query: "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number } } }",
        variables: { id: row.node_id },
      },
    });
    if (response?.errors?.length) throw new Error(`GitHub could not mark #${pr} ready: ${response.errors.map((e) => e.message).join("; ")}`);
  }

  async closePr(pr: number, comment?: string): Promise<void> {
    if (comment) await this.api.send("POST", this.api.repoPath(`/issues/${pr}/comments`), { body: comment });
    await this.api.send("PATCH", this.api.repoPath(`/pulls/${pr}`), { state: "closed" });
  }

  async labelPr(pr: number, label: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/issues/${pr}/labels`), { labels: [label] });
  }

  async submitReview(pr: number, review: Review): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/pulls/${pr}/reviews`), {
      event: review.event,
      body: review.body,
      comments: review.comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body })),
    });
  }

  async threads(pr: number): Promise<ReviewThread[]> {
    const rows = await this.api.list(this.api.repoPath(`/pulls/${pr}/comments`), reviewCommentRow);
    return rows
      .filter((r) => r.in_reply_to_id == null)
      .map((root) => ({
        id: String(root.id),
        path: root.path ?? null,
        author: root.user?.login ?? "ghost",
        body: root.body ?? "",
        replies: rows.filter((r) => r.in_reply_to_id === root.id).map((r) => ({ author: r.user?.login ?? "ghost", body: r.body ?? "" })),
      }));
  }

  async replyToThread(pr: number, threadId: string, body: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/pulls/${pr}/comments/${threadId}/replies`), { body });
  }

  /**
   * One evidence comment per PR: a previous one is deleted and the new one created with `gh pr comment --attach`
   * (the prints live in GitHub's attachment storage, not in the repo). If gh cannot attach, a text comment names the prints.
   */
  async postEvidence(pr: number, groups: EvidenceGroup[]): Promise<void> {
    const comments = await this.api.list(this.api.repoPath(`/issues/${pr}/comments`), commentRow);
    for (const old of comments.filter((c) => c.body?.startsWith(EVIDENCE_MARKER))) {
      await this.api.send("DELETE", this.api.repoPath(`/issues/comments/${old.id}`));
    }
    const lines = [EVIDENCE_MARKER, "**Evidence**"];
    for (const group of groups) {
      lines.push("", `### ${group.product}`, "");
      for (const image of group.images) lines.push(`![${image.name}](${image.path})`);
    }
    const dir = await mkdtemp(join(tmpdir(), "factory-evidence-"));
    try {
      const bodyFile = join(dir, "body.md");
      await writeFile(bodyFile, lines.join("\n") + "\n");
      const attach = groups.flatMap((g) => g.images.flatMap((i) => ["--attach", i.path]));
      await this.gh(["pr", "comment", String(pr), "--repo", this.options.repo, "--body-file", bodyFile, ...attach], { GH_TOKEN: this.options.token });
    } catch (error) {
      const names = groups.map((g) => `- ${g.product}: ${g.images.map((i) => i.name).join(", ")}`);
      const reason = this.scrub((error as Error).message).slice(0, 300);
      await this.api.send("POST", this.api.repoPath(`/issues/${pr}/comments`), {
        body: [EVIDENCE_MARKER, "**Evidence**", "", "The prints could not be attached to this comment; they are in the workflow run's artifacts.", ...names, "", `gh said: ${reason}`].join("\n"),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async dispatch(workflow: string, inputs: Record<string, string>): Promise<void> {
    const file = workflow.endsWith(".yml") ? workflow : `factory-${workflow}.yml`;
    await this.api.send("POST", this.api.repoPath(`/actions/workflows/${file}/dispatches`), { ref: this.options.baseBranch, inputs });
  }

  private scrub(text: string): string {
    return text.replaceAll(this.options.token, "***").replaceAll(Buffer.from(`x-access-token:${this.options.token}`).toString("base64"), "***");
  }
}

function toPr(row: z.infer<typeof prRow>): PullRequest {
  return { number: row.number, url: row.html_url, branch: row.head.ref, headSha: row.head.sha, state: row.state, draft: row.draft };
}

const runGit: GitRunner = (args, { cwd, env }) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      resolve({ code: error ? ((error as { code?: unknown }).code as number) || 1 : 0, stderr });
    });
  });

const runGh: GhRunner = (args, env) =>
  new Promise((resolve, reject) => {
    execFile("gh", args, { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
