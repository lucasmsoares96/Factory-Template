import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ActiveRun, CodeHost, ConversationEntry, EvidenceImage, FailedCheck, MergeResult, PrCheck, PullRequest, PushResult, ReactionTarget, Review, ReviewThread, SubmittedReview, FactoryWorkflow, ThreadId } from "../../seams/code-host.ts";
import { marked } from "../../marker.ts";
import { GitHubApi, GitHubError, type GitHubApiOptions } from "./api.ts";
import { childEnv, runGh, type GhRunner } from "./gh.ts";

export { childEnv, type GhRunner };


/** Runs `git <args>` in `cwd` with `env` added to the environment. */
export type GitRunner = (args: string[], options: { cwd: string; env: Record<string, string> }) => Promise<{ code: number; stderr: string }>;

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
  head: z.object({ ref: z.string(), sha: z.string(), repo: z.object({ full_name: z.string() }).nullable().optional() }),
  base: z.object({ ref: z.string() }),
  labels: z.array(z.object({ name: z.string() })).default([]),
});
const refRow = z.object({ object: z.object({ sha: z.string() }) });
const reviewRow = z.object({
  id: z.number(),
  body: z.string().nullable().optional(),
  user: z.object({ login: z.string() }).nullable(),
  /** Absent on a pending review, which nobody else sees yet. */
  submitted_at: z.string().nullable().optional(),
});
const issueCommentRow = z.object({ id: z.number(), body: z.string().nullable().optional(), user: z.object({ login: z.string() }).nullable(), created_at: z.string() });
const reviewCommentRow = z.object({
  id: z.number(),
  path: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  user: z.object({ login: z.string() }).nullable(),
  in_reply_to_id: z.number().nullable().optional(),
});
const runRow = z.object({ id: z.number(), name: z.string().nullable().optional(), conclusion: z.string().nullable(), html_url: z.string() });
const activeRunRow = z.object({ id: z.number(), path: z.string(), display_title: z.string() });
/** Every status of a run that has not ended. */
const ACTIVE_STATUSES = ["queued", "in_progress", "waiting", "pending", "requested"];
/** The workflows whose runs work on an issue or a pull request. */
const FACTORY_WORKFLOWS = new Set(["factory-issue.yml", "factory-pr-feedback.yml", "factory-update-branches.yml", "factory-triage.yml", "factory-retro.yml"]);
/** The `run-name` of a Triage run that works on the batch; any other label event names itself otherwise and ends at once. */
const TRIAGE_RUN = "Factory triage";
const jobRow = z.object({ id: z.number(), name: z.string(), conclusion: z.string().nullable(), html_url: z.string().nullable() });
/**
 * A run that ended like this has no failed job to read. Nor does a cancelled run: a newer run of the same head
 * superseded it (`cancel-in-progress`), or someone stopped it. A job that hits its `timeout-minutes` may end `cancelled` while its run ends `failure`, so it is still read.
 */
const CLEAN_RUN = new Set(["success", "skipped", "neutral", "cancelled"]);
const FAILED_JOB = new Set(["failure", "timed_out", "cancelled"]);
const bodyRow = z.object({ body: z.string().nullable().optional() });
const changedCountRow = z.object({ changed_files: z.number().int() });
const fileRow = z.object({ filename: z.string(), previous_filename: z.string().optional() });
const workflowRunRow = z.object({ id: z.number(), created_at: z.string(), conclusion: z.string().nullable(), status: z.string().nullable() });
const prJobRow = z.object({ name: z.string(), status: z.string().nullable(), conclusion: z.string().nullable() });
/** The pull request workflow, whose jobs (`verify`, `preview deploy (<id>)`, `preview smoke (<id>)`) the merge reads. */
const PR_WORKFLOW = "factory-pr.yml";
const DEPLOY_WORKFLOW = "factory-deploy.yml";
/** The newest first: ISO 8601 UTC timestamps sort as strings. */
const newestFirst = <T extends { created_at: string }>(rows: T[]) => [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
const graphql = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() })).optional() });

/**
 * CodeHost over GitHub: REST by `fetch` and Zod, `git push` for the branch, and `gh pr edit --attach` only to upload the
 * prints of a body (GitHub's own image storage; REST has no endpoint for it, and `gh` rewrites the references in place). The token stays in this class:
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
    const ref = await this.api.getOrNull(this.api.repoPath(`/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`), refRow);
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
    return rows[0] ? toPr(rows[0], this.options.repo) : null;
  }

  async openPullRequests(): Promise<PullRequest[]> {
    const rows = await this.api.list(this.api.repoPath("/pulls?state=open"), prRow);
    return rows.map((row) => toPr(row, this.options.repo));
  }

  async pullRequest(number: number): Promise<PullRequest | null> {
    const row = await this.api.getOrNull(this.api.repoPath(`/pulls/${number}`), prRow);
    return row ? toPr(row, this.options.repo) : null;
  }

  async commentPr(pr: number, body: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/issues/${pr}/comments`), { body: marked(body) });
  }

  async openDraftPr(input: { branch: string; base: string; title: string; body: string; images?: EvidenceImage[] }): Promise<PullRequest> {
    const row = await this.api.request("POST", this.api.repoPath("/pulls"), prRow, {
      body: { head: input.branch, base: input.base, title: input.title, body: marked(input.body), draft: true },
    });
    if (input.images?.length) await this.updatePrBody(row!.number, input.body, input.images);
    return toPr(row!, this.options.repo);
  }

  /**
   * Without images, a plain REST write. With images, `gh pr edit --body-file --attach` uploads each print and swaps
   * its reference for the URL; if gh cannot attach, the body is written with the prints named instead of linked.
   */
  async updatePrBody(pr: number, plain: string, images: EvidenceImage[] = []): Promise<void> {
    const body = marked(plain);
    if (images.length === 0) return this.api.send("PATCH", this.api.repoPath(`/pulls/${pr}`), { body });
    const dir = await mkdtemp(join(tmpdir(), "factory-body-"));
    try {
      const bodyFile = join(dir, "body.md");
      await writeFile(bodyFile, body);
      const attach = images.flatMap((i) => ["--attach", i.path]);
      await this.gh(["pr", "edit", String(pr), "--repo", this.options.repo, "--body-file", bodyFile, ...attach], { env: childEnv(process.env, { GH_TOKEN: this.options.token }) });
    } catch (error) {
      const reason = this.scrub((error as Error).message).slice(0, 300);
      let text = body;
      for (const image of images) {
        const ref = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(image.path)}[^)]*\\)`, "g");
        text = text.replace(ref, () => `*${image.name}: could not be attached (gh said: ${reason}); the print is in the workflow run's artifacts.*`);
      }
      await this.api.send("PATCH", this.api.repoPath(`/pulls/${pr}`), { body: text });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
    if (comment) await this.api.send("POST", this.api.repoPath(`/issues/${pr}/comments`), { body: marked(comment) });
    await this.api.send("PATCH", this.api.repoPath(`/pulls/${pr}`), { state: "closed" });
  }

  async labelPr(pr: number, label: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/issues/${pr}/labels`), { labels: [label] });
  }

  async unlabelPr(pr: number, label: string): Promise<void> {
    await this.api.request("DELETE", `${this.api.repoPath(`/issues/${pr}/labels`)}/${encodeURIComponent(label)}`, z.unknown(), { allow404: true });
  }

  async submitReview(pr: number, review: Review): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/pulls/${pr}/reviews`), {
      event: review.event,
      body: marked(review.body),
      comments: review.comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: marked(c.body) })),
    });
  }

  async threads(pr: number): Promise<ReviewThread[]> {
    const rows = await this.api.list(this.api.repoPath(`/pulls/${pr}/comments`), reviewCommentRow);
    return rows
      .filter((r) => r.in_reply_to_id == null)
      .map((root) => ({
        id: String(root.id) as ThreadId,
        path: root.path ?? null,
        author: root.user?.login ?? "ghost",
        body: root.body ?? "",
        replies: rows.filter((r) => r.in_reply_to_id === root.id).map((r) => ({ author: r.user?.login ?? "ghost", body: r.body ?? "" })),
      }));
  }

  async reviews(pr: number): Promise<SubmittedReview[]> {
    const rows = await this.api.list(this.api.repoPath(`/pulls/${pr}/reviews`), reviewRow);
    return rows.map((r) => ({ author: r.user?.login ?? "ghost", body: r.body ?? "" }));
  }

  /**
   * Through the Actions API, which the job token reads with `actions: read` (the check-runs API would need `checks: read`):
   * the runs of the head that did not end clean or cancelled, their jobs that failed, timed out or were cancelled, and
   * the end of each job's log. A check posted by an app other than Actions is not seen.
   */
  async failedChecks(pr: number, lines: number): Promise<FailedCheck[]> {
    const head = (await this.api.get(this.api.repoPath(`/pulls/${pr}`), prRow)).head.sha;
    const runs = await this.api.listIn(this.api.repoPath(`/actions/runs?head_sha=${head}`), "workflow_runs", runRow);
    const checks: FailedCheck[] = [];
    for (const run of runs.filter((r) => !CLEAN_RUN.has(r.conclusion ?? ""))) {
      const jobs = await this.api.listIn(this.api.repoPath(`/actions/runs/${run.id}/jobs`), "jobs", jobRow);
      for (const job of jobs.filter((j) => FAILED_JOB.has(j.conclusion ?? ""))) {
        // One log that cannot be read (expired, refused) leaves the other checks theirs.
        const log = await this.api.text(this.api.repoPath(`/actions/jobs/${job.id}/logs`)).then(
          (text) => lastLines(text, lines),
          (error: Error) => `(the log could not be read: ${error.message})`,
        );
        checks.push({ name: run.name ? `${run.name} / ${job.name}` : job.name, url: job.html_url ?? run.html_url, log });
      }
    }
    return checks;
  }

  async conversation(pr: number): Promise<ConversationEntry[]> {
    const [comments, reviews] = await Promise.all([
      this.api.list(this.api.repoPath(`/issues/${pr}/comments`), issueCommentRow),
      this.api.list(this.api.repoPath(`/pulls/${pr}/reviews`), reviewRow),
    ]);
    const entries = [
      ...comments.map((c) => ({ at: c.created_at, entry: { id: `comment-${c.id}`, kind: "comment" as const, author: c.user?.login ?? "ghost", body: c.body ?? "" } })),
      ...reviews.flatMap((r) => (r.submitted_at ? [{ at: r.submitted_at, entry: { id: `review-${r.id}`, kind: "review" as const, author: r.user?.login ?? "ghost", body: r.body ?? "" } }] : [])),
    ];
    // ISO 8601 UTC timestamps sort as strings; the sort is stable, so equal times keep the API's order.
    return entries
      .filter((e) => e.entry.body.trim() !== "")
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      .map((e) => e.entry);
  }

  async replyToThread(pr: number, threadId: ThreadId, body: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/pulls/${pr}/comments/${threadId}/replies`), { body: marked(body) });
  }

  /** REST for comments; a review has no REST reactions endpoint, so GraphQL `addReaction` on its node id. */
  async react(target: ReactionTarget, reaction: "eyes"): Promise<void> {
    if (target.kind === "comment") return this.api.send("POST", this.api.repoPath(`/issues/comments/${target.id}/reactions`), { content: reaction });
    if (target.kind === "review-comment") return this.api.send("POST", this.api.repoPath(`/pulls/comments/${target.id}/reactions`), { content: reaction });
    const review = await this.api.get(this.api.repoPath(`/pulls/${target.pr}/reviews/${target.id}`), z.object({ node_id: z.string() }));
    const response = await this.api.request("POST", "/graphql", graphql, {
      body: {
        query: "mutation($subject: ID!, $content: ReactionContent!) { addReaction(input: { subjectId: $subject, content: $content }) { reaction { content } } }",
        variables: { subject: review.node_id, content: reaction.toUpperCase() },
      },
    });
    if (response?.errors?.length) throw new Error(`GitHub could not react to review ${target.id}: ${response.errors.map((e) => e.message).join("; ")}`);
  }

  async pullRequestBody(pr: number): Promise<string> {
    return (await this.api.get(this.api.repoPath(`/pulls/${pr}`), bodyRow)).body ?? "";
  }

  /** The files endpoint lists 3000 files at most: a longer diff throws rather than hide a path. */
  async changedFiles(pr: number): Promise<string[]> {
    const { changed_files: count } = await this.api.get(this.api.repoPath(`/pulls/${pr}`), changedCountRow);
    const rows = await this.api.list(this.api.repoPath(`/pulls/${pr}/files`), fileRow);
    if (rows.length < count) throw new Error(`GitHub listed ${rows.length} of the ${count} files of #${pr}.`);
    return [...new Set(rows.flatMap((r) => (r.previous_filename ? [r.filename, r.previous_filename] : [r.filename])))];
  }

  /** Through the Actions API (`actions: read`), like `failedChecks`: the latest attempt of each job of the newest run. */
  async prChecks(sha: string): Promise<PrCheck[]> {
    const runs = await this.api.listIn(this.api.repoPath(`/actions/workflows/${PR_WORKFLOW}/runs?head_sha=${sha}`), "workflow_runs", workflowRunRow);
    const newest = newestFirst(runs)[0];
    if (!newest) return [];
    const jobs = await this.api.listIn(this.api.repoPath(`/actions/runs/${newest.id}/jobs`), "jobs", prJobRow);
    return jobs.map((j) => ({ name: j.name, conclusion: j.status === "completed" ? j.conclusion : null }));
  }

  async lastDeploy(): Promise<string | null> {
    const path = this.api.repoPath(`/actions/workflows/${DEPLOY_WORKFLOW}/runs?branch=${encodeURIComponent(this.options.baseBranch)}&status=completed&per_page=20`);
    const { workflow_runs: runs } = await this.api.get(path, z.object({ workflow_runs: z.array(workflowRunRow) }));
    return newestFirst(runs)[0]?.conclusion ?? null;
  }

  /** `GET /compare/{base}...{sha}`: `behind_by` counts the base's commits the head lacks. */
  async behindBase(sha: string): Promise<boolean> {
    const path = this.api.repoPath(`/compare/${encodeURIComponent(this.options.baseBranch)}...${sha}`);
    return (await this.api.get(path, z.object({ behind_by: z.number().int() }))).behind_by > 0;
  }

  /** `PUT /pulls/{n}/merge` with `sha`: 405 (not mergeable), 409 (the head moved) and 422 (refused) are refusals. */
  async merge(pr: number, sha: string): Promise<MergeResult> {
    try {
      await this.api.send("PUT", this.api.repoPath(`/pulls/${pr}/merge`), { sha, merge_method: "merge" });
      return { ok: true };
    } catch (error) {
      if (error instanceof GitHubError && [405, 409, 422].includes(error.status)) return { ok: false, reason: this.scrub(error.message) };
      throw error;
    }
  }

  /** The repository's runs in each status that has not ended, kept when their workflow is a Factory one (a Triage run only when it triages). */
  async activeRuns(): Promise<ActiveRun[]> {
    const found: ActiveRun[] = [];
    for (const status of ACTIVE_STATUSES) {
      for (const run of await this.api.listIn(this.api.repoPath(`/actions/runs?status=${status}`), "workflow_runs", activeRunRow)) {
        const workflow = run.path.split("/").at(-1)!.split("@")[0]!;
        if (!FACTORY_WORKFLOWS.has(workflow) || (workflow === "factory-triage.yml" && run.display_title !== TRIAGE_RUN)) continue;
        found.push({ id: run.id, workflow, ...runTarget(run.display_title) });
      }
    }
    return found;
  }

  async dispatch(workflow: FactoryWorkflow, inputs: Record<string, string>): Promise<void> {
    const file = `factory-${workflow}.yml`;
    await this.api.send("POST", this.api.repoPath(`/actions/workflows/${file}/dispatches`), { ref: this.options.baseBranch, inputs });
  }

  async setResumeSweep(enabled: boolean): Promise<void> {
    await this.api.send("PUT", this.api.repoPath(`/actions/workflows/factory-resume.yml/${enabled ? "enable" : "disable"}`));
  }

  private scrub(text: string): string {
    return text.replaceAll(this.options.token, "***").replaceAll(Buffer.from(`x-access-token:${this.options.token}`).toString("base64"), "***");
  }
}

/**
 * What a Factory run title names at its start (the `run-name` of each workflow): `PR #N` a pull request, `#N` an
 * issue, either after `Retro of `. Only the start counts: the rest of an issue flow's title is the issue's own title.
 */
export function runTarget(title: string): { issue: number | null; pr: number | null } {
  const match = /^(?:Retro of )?(PR )?#(\d+)(?=\s|:|$)/.exec(title);
  if (!match) return { issue: null, pr: null };
  return match[1] ? { issue: null, pr: Number(match[2]) } : { issue: Number(match[2]), pr: null };
}

function lastLines(text: string, n: number): string {
  return text.trimEnd().split(/\r?\n/).slice(-n).join("\n");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A head repository other than `repo`, or one deleted since (`null`), is a fork. */
function toPr(row: z.infer<typeof prRow>, repo: string): PullRequest {
  const fork = row.head.repo?.full_name.toLowerCase() !== repo.toLowerCase();
  return { number: row.number, url: row.html_url, branch: row.head.ref, headSha: row.head.sha, state: row.state, draft: row.draft, base: row.base.ref, fork, labels: row.labels.map((l) => l.name) };
}

const runGit: GitRunner = (args, { cwd, env }) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, env: childEnv(process.env, env), maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      resolve({ code: error ? ((error as { code?: unknown }).code as number) || 1 : 0, stderr });
    });
  });
