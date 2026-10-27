import { issueBranch } from "../config.ts";
import type { ActiveRun, PullRequest } from "../seams/code-host.ts";
import type { CommandContext } from "./context.ts";
import { issueOfBranch } from "./pr-threads.ts";

/**
 * `factory:working`: on an issue or pull request only while a Factory run works on it. It is what people see, not a
 * lock (that is `in-progress`), so every write here is best effort: a refused write is logged and the run goes on.
 * Each run puts it on with the job token (a job-token label event starts no workflow) and takes it off at its end.
 */

type PrRef = Pick<PullRequest, "number" | "branch">;

/** What a run works on. An issue brings the open pull request of its Factory branch along, unless `issuePrs` is false. */
export interface WorkingTargets {
  issues: number[];
  prs: number[];
  issuePrs?: boolean;
}

export interface WorkingChange {
  issues: number[];
  prs: number[];
}

/** Puts the label on every target. */
export async function startWorking(ctx: CommandContext, targets: WorkingTargets): Promise<WorkingChange> {
  const { issues, prs } = await expand(ctx, targets);
  const label = ctx.config.labels.working;
  for (const n of issues) await attempt(ctx, `#${n}`, () => ctx.tracker.addLabel(n, label));
  for (const pr of prs) await attempt(ctx, `PR #${pr.number}`, () => ctx.codeHost.labelPr(pr.number, label));
  return { issues, prs: prs.map((p) => p.number) };
}

/**
 * Takes the label off every target, except where another Factory run (not `self`, the run that is ending) is queued
 * or going: that run still works there and takes it off at its own end. When the runs cannot be listed, it comes off
 * anyway: this run is over.
 */
export async function stopWorking(ctx: CommandContext, targets: WorkingTargets, self: number | null): Promise<{ released: WorkingChange; kept: WorkingChange }> {
  const { issues, prs } = await expand(ctx, targets);
  let runs: ActiveRun[] = [];
  try {
    runs = (await ctx.codeHost.activeRuns()).filter((r) => r.id !== self);
  } catch (error) {
    ctx.log(`The Factory runs could not be listed (${(error as Error).message}); ${ctx.config.labels.working} comes off regardless.`);
  }
  return await release(ctx, runs, issues, prs);
}

/**
 * The cleanup of the scan: a run that was cancelled or interrupted never reached its end. Every open issue and pull
 * request that carries the label while no Factory run is queued or going on it loses it. When the runs cannot be
 * listed, nothing is touched.
 */
export async function releaseOrphans(ctx: CommandContext): Promise<{ released: WorkingChange; kept: WorkingChange }> {
  const label = ctx.config.labels.working;
  const runs = await ctx.codeHost.activeRuns();
  const issues = await ctx.tracker.labeled(label);
  const prs = (await ctx.codeHost.openPullRequests()).filter((p) => p.labels.includes(label));
  return await release(ctx, runs, issues, prs);
}

async function release(ctx: CommandContext, runs: ActiveRun[], issues: number[], prs: PrRef[]) {
  const { config, tracker, codeHost } = ctx;
  const label = config.labels.working;
  const result: { released: WorkingChange; kept: WorkingChange } = { released: { issues: [], prs: [] }, kept: { issues: [], prs: [] } };
  const runIssues = new Set(runs.flatMap((r) => (r.issue === null ? [] : [r.issue])));
  // A run keyed by a pull request works on the issue of its Factory branch too.
  for (const r of runs) {
    if (r.pr === null) continue;
    const pr = prs.find((p) => p.number === r.pr) ?? (await codeHost.pullRequest(r.pr).catch(() => null));
    const issue = pr ? issueOfBranch(config, pr.branch) : null;
    if (issue !== null) runIssues.add(issue);
  }
  const runPrs = new Set(runs.flatMap((r) => (r.pr === null ? [] : [r.pr])));
  const triaging = runs.some((r) => r.workflow === "factory-triage.yml");

  for (const n of issues) {
    let busy = runIssues.has(n);
    // The Triage names no issue: while one runs, the issues still in Triage are its batch.
    if (!busy && triaging) busy = (await tracker.issue(n).catch(() => null))?.labels.includes(config.labels.agentExplore) ?? false;
    if (busy) {
      result.kept.issues.push(n);
      continue;
    }
    await attempt(ctx, `#${n}`, () => tracker.removeLabel(n, label));
    result.released.issues.push(n);
  }
  for (const pr of prs) {
    const issue = issueOfBranch(config, pr.branch);
    if (runPrs.has(pr.number) || (issue !== null && runIssues.has(issue))) {
      result.kept.prs.push(pr.number);
      continue;
    }
    await attempt(ctx, `PR #${pr.number}`, () => codeHost.unlabelPr(pr.number, label));
    result.released.prs.push(pr.number);
  }
  return result;
}

/** The targets with each issue's open Factory pull request added, no number twice. */
async function expand(ctx: CommandContext, targets: WorkingTargets): Promise<{ issues: number[]; prs: PrRef[] }> {
  const issues = [...new Set(targets.issues)];
  const prs = new Map<number, PrRef>();
  for (const n of targets.prs) {
    const pr = await ctx.codeHost.pullRequest(n).catch(() => null);
    prs.set(n, { number: n, branch: pr?.branch ?? "" });
  }
  for (const n of targets.issuePrs === false ? [] : issues) {
    const pr = await ctx.codeHost.openPrFor(issueBranch(ctx.config, n)).catch(() => null);
    if (pr) prs.set(pr.number, { number: pr.number, branch: pr.branch });
  }
  return { issues, prs: [...prs.values()] };
}

async function attempt(ctx: CommandContext, what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    ctx.log(`${ctx.config.labels.working} on ${what} could not be changed: ${(error as Error).message}`);
  }
}
