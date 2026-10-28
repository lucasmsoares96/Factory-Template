import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { issueBranch } from "../config.ts";
import { isMarked } from "../marker.ts";
import { retroPrompt } from "../prompts.ts";
import { parseRetro, retroExtraction, retroFailure, retroIssueBody, retroMarker, retroResultSchema, RETRO_FILE, type RetroResult } from "../retro-output.ts";
import type { ReviewThread, SubmittedReview } from "../seams/code-host.ts";
import type { Issue, IssueComment } from "../seams/tracker.ts";
import type { CommandContext } from "./context.ts";
import { issueOfBranch } from "./pr-threads.ts";
import { startWorking } from "./working.ts";

const MINUTE = 60_000;

/** A workflow run of the Factory that worked on the issue. */
export interface RunRef {
  id: number;
  url: string;
  workflow: string;
  title: string;
  createdAt: string;
}

/** How the runs of an issue are recognised: the issue, its PR, and the titles a run started by their events carries. */
export interface RunMatch {
  issue: number;
  pr: number | null;
  titles: string[];
}

/** The runs of an issue and their `work-out` artifacts (the session streams). Not one of the four seams: only the Retro reads it. */
export interface RunLogs {
  find(match: RunMatch): Promise<RunRef[]>;
  /** Downloads the run's `work-out` artifact into `dir` (new and empty); returns the files, relative to `dir`, or none when it is gone. */
  download(run: RunRef, dir: string): Promise<string[]>;
}

/** `sources.json`: what `retro-collect` gathered, read by `retro`. */
export interface RetroSources {
  issue: number;
  pr: number | null;
  title: string;
  branch: string;
  runs: (RunRef & { dir: string; files: string[] })[];
}
const SOURCES_FILE = "sources.json";

export type CollectResult =
  | { collected: true; issue: number; pr: number | null; runs: number }
  | { collected: false; issue: number | null; pr: number | null; reason: string };

export interface CollectOptions {
  issue: number | null;
  pr: number | null;
  /** `closed`: a Factory PR closed (needs a writer's finding); `dispatch`: an Escalation or a person asked for it. */
  trigger: "closed" | "dispatch";
  out: string;
  runLogs: RunLogs;
}

/**
 * The read-only first job (job token): decides whether there is anything to learn, then writes the primary sources
 * of the run into `out` (new and empty): the issue with its parent and the writers' comments, the PR's writer-only
 * threads and reviews, and the `work-out` artifact of every run. Everything it writes is data for the Retro, never
 * something to run. A closed PR goes on only when a writer other than the Factory left a thread or a review on it.
 * Its one write: `factory:working` on the origin issue when the Retro goes on.
 */
export async function retroCollect(ctx: CommandContext, options: CollectOptions): Promise<CollectResult> {
  const { tracker, codeHost, config } = ctx;
  const pr = options.pr === null ? null : await codeHost.pullRequest(options.pr);
  const number = options.issue ?? (pr ? issueOfBranch(config, pr.branch) : null);
  if (number === null) {
    return { collected: false, issue: null, pr: options.pr, reason: options.pr === null ? "neither an issue nor a pull request was given" : `pull request #${options.pr} is not on a Factory branch` };
  }
  const branch = issueBranch(config, number);
  const prNumber = pr?.number ?? (await codeHost.openPrFor(branch))?.number ?? null;

  const writes = writerCheck(tracker.canWrite.bind(tracker));
  const threads = prNumber === null ? [] : await writerThreads(await codeHost.threads(prNumber), writes);
  const reviews = prNumber === null ? [] : await filter(await codeHost.reviews(prNumber), (r) => writes(r.author));
  if (options.trigger === "closed") {
    const human = threads.some((t) => [t, ...t.replies].some((c) => !isMarked(c.body))) || reviews.some((r) => !isMarked(r.body));
    if (!human) return { collected: false, issue: number, pr: prNumber, reason: "no thread or review from a writer: a clean pull request has nothing to teach" };
  }

  const issue = await tracker.issue(number);
  const comments = await filter(issue.comments, (c) => writes(c.author));
  await mkdir(options.out, { recursive: true });
  await writeFile(join(options.out, "issue.md"), issueText(issue, comments));
  if (prNumber !== null) await writeFile(join(options.out, "pull-request.md"), pullRequestText(prNumber, threads, reviews));

  const prTitle = prNumber === null ? null : `Fix #${number}: ${issue.title}`;
  const found = await options.runLogs.find({ issue: number, pr: prNumber, titles: [issue.title, ...(prTitle ? [prTitle] : [])] });
  const runs: RetroSources["runs"] = [];
  for (const run of found) {
    const dir = join("runs", String(run.id));
    const target = join(options.out, dir);
    await mkdir(target, { recursive: true });
    runs.push({ ...run, dir, files: await options.runLogs.download(run, target) });
  }

  const sources: RetroSources = { issue: number, pr: prNumber, title: issue.title, branch, runs };
  await writeFile(join(options.out, SOURCES_FILE), `${JSON.stringify(sources, null, 2)}\n`);
  // The Retro goes on: its origin issue shows it until the run ends (`working off` in `done`, which runs once collected).
  await startWorking(ctx, { issues: [number], prs: [], issuePrs: false });
  return { collected: true, issue: number, pr: prNumber, runs: runs.length };
}

/**
 * The read-only second job (job `work`, no forge token): one Retro session over the sources, which follows the
 * `retro` skill and ends with a `<retro>` block. Writes `retro.json` into `out`; with no valid block it throws, so
 * nothing is published.
 */
export async function retro(ctx: CommandContext, options: { in: string; out: string }): Promise<RetroResult> {
  const { agent, config } = ctx;
  const sources = JSON.parse(await readFile(join(options.in, SOURCES_FILE), "utf8")) as RetroSources;
  const run = await agent.run("retro", retroPrompt({ sources, dir: options.in, base: config.baseBranch, language: config.language }), {
    timeoutMs: config.timeouts.retro * MINUTE,
    model: config.models.retro,
    extract: retroExtraction,
  });
  const block = run.timedOut ? null : parseRetro(run.output);
  if (block === null) throw new Error(retroFailure(run.timedOut));
  const result: RetroResult = { ...block, issue: sources.issue, pr: sources.pr, title: sources.title, usage: run.usage, retries: run.retries };
  await mkdir(options.out, { recursive: true });
  await writeFile(join(options.out, RETRO_FILE), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export type RetroPublishResult =
  | { issue: number; outcome: "created" | "updated"; retro: number }
  | { issue: number; outcome: "no-candidates" };

/**
 * The write job (forge token). Trusts nothing in `retro.json` but its shape. With candidates: the one Retro issue of
 * the origin, created with `needs-triage` and `retro`, or edited in place when an open one carries its marker. With
 * none: a short comment where the Retro started. It never applies `ready-for-agent`: a person decides.
 */
export async function retroPublish(ctx: CommandContext, options: { in: string; runUrl: string | null }): Promise<RetroPublishResult> {
  const { tracker, codeHost, config } = ctx;
  const result = retroResultSchema.parse(JSON.parse(await readFile(join(options.in, RETRO_FILE), "utf8")));
  const number = result.issue;

  if (result.candidates.length === 0) {
    const text = `The automatic Retro found no candidate it could trace to this run's record, so it opened no issue.${options.runUrl ? ` Run: ${options.runUrl}` : ""}`;
    if (result.pr !== null) await codeHost.commentPr(result.pr, text);
    else await tracker.comment(number, text);
    return { issue: number, outcome: "no-candidates" };
  }

  const body = retroIssueBody(result, { runUrl: options.runUrl, pricing: config.pricing });
  const existing = await existingRetro(ctx, number);
  if (existing !== null) {
    await tracker.updateIssue(existing, body);
    await tracker.addLabel(existing, config.labels.needsTriage);
    return { issue: number, outcome: "updated", retro: existing };
  }
  const created = await tracker.createIssue({
    title: `Retro: #${number} ${result.title}`,
    body,
    labels: [config.labels.needsTriage, config.labels.retro],
    relatedTo: number,
  });
  return { issue: number, outcome: "created", retro: created.number };
}

/** The open Retro issue of the origin: labelled `retro`, written by the Factory, with the origin's marker. */
async function existingRetro(ctx: CommandContext, issue: number): Promise<number | null> {
  for (const candidate of await ctx.tracker.labeled(ctx.config.labels.retro)) {
    const { body } = await ctx.tracker.issue(candidate);
    if (isMarked(body) && body.includes(retroMarker(issue))) return candidate;
  }
  return null;
}

/** `canWrite`, asked once per login. */
function writerCheck(canWrite: (login: string) => Promise<boolean>): (login: string) => Promise<boolean> {
  const known = new Map<string, Promise<boolean>>();
  return (login) => {
    let answer = known.get(login);
    if (!answer) known.set(login, (answer = canWrite(login)));
    return answer;
  };
}

/** Threads written only by writers: a thread with a stranger's text in it never reaches the Retro. */
async function writerThreads(threads: ReviewThread[], writes: (login: string) => Promise<boolean>): Promise<ReviewThread[]> {
  return filter(threads, async (t) => {
    for (const c of [t, ...t.replies]) if (!(await writes(c.author))) return false;
    return true;
  });
}

async function filter<T>(items: T[], keep: (item: T) => Promise<boolean>): Promise<T[]> {
  const kept: T[] = [];
  for (const item of items) if (await keep(item)) kept.push(item);
  return kept;
}

function issueText(issue: Issue, comments: IssueComment[]): string {
  const parts = [`# #${issue.number} ${issue.title}`, "", issue.body];
  if (issue.parent) parts.push("", `## Parent spec #${issue.parent.number}`, "", issue.parent.body);
  parts.push("", "## Comments from writers (the Factory's carry its hidden marker)");
  for (const c of comments) parts.push("", `### ${c.author} (comment ${c.id})`, "", c.body);
  return `${parts.join("\n")}\n`;
}

function pullRequestText(pr: number, threads: ReviewThread[], reviews: SubmittedReview[]): string {
  const parts = [`# Pull request #${pr}`, "", "## Reviews (the Factory's Review includes \"Rules this review wanted and could not find\")"];
  for (const r of reviews) parts.push("", `### Review by ${r.author}`, "", r.body);
  parts.push("", "## Review threads");
  for (const t of threads) {
    parts.push("", `### Thread ${t.id}${t.path ? ` on \`${t.path}\`` : ""}`, "", `**${t.author}:** ${t.body}`);
    for (const reply of t.replies) parts.push("", `**${reply.author}:** ${reply.body}`);
  }
  return `${parts.join("\n")}\n`;
}
