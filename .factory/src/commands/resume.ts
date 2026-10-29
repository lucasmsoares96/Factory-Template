import { isFactoryComment } from "../guard.ts";
import type { FactoryWorkflow } from "../seams/code-host.ts";
import { parseWait, SESSION_LIMIT_MARKER, type Wait } from "../session-limit.ts";
import type { Tracker } from "../seams/tracker.ts";
import type { CommandContext } from "./context.ts";

export interface ResumeRun {
  resumed: { number: number; flow: Wait["flow"] }[];
  /** Their reset has not passed yet. */
  waiting: number[];
  /** Labelled with no wait of the Factory's to follow: the label came off, nothing started. */
  dropped: number[];
  /** The run could not be started: the label is back for the next sweep. */
  failed: number[];
  /** Nothing was left under the label, so the sweep switched itself off (`factory-resume.yml` is on only while something waits). */
  switchedOff: boolean;
}

/**
 * The sweep after the agent's usage limit (`factory-resume.yml`, cron): every open issue and pull request labelled
 * `sessionLimit` whose Factory wait (the marked comment `publish`, `apply` or `retro-publish` left) has passed starts
 * again, the same work it was doing: the issue flow, the round on its pull request, the Triage (one for all) or the
 * Retro. The label comes off before the dispatch, since the guard refuses an issue that has it, and it is the only
 * record that a wait is pending: each wait starts once. A dispatch that fails puts it back. When the sweep ends with
 * nothing under the label, it switches `factory-resume.yml` off: a scheduled run costs Actions minutes even when it
 * finds nothing, so `publish`, `apply` and `retro-publish` switch it on again at the next pause.
 */
export async function resume(ctx: CommandContext): Promise<ResumeRun> {
  const { tracker, codeHost, config } = ctx;
  const label = config.labels.sessionLimit;
  const now = ctx.now();
  const run: ResumeRun = { resumed: [], waiting: [], dropped: [], failed: [], switchedOff: false };
  const triage: number[] = [];

  const start = async (number: number, flow: Wait["flow"], unlabel: () => Promise<void>, relabel: () => Promise<void>, workflow: FactoryWorkflow, inputs: Record<string, string>) => {
    await unlabel();
    try {
      await codeHost.dispatch(workflow, inputs);
      run.resumed.push({ number, flow });
    } catch (error) {
      ctx.log(`factory: could not start ${flow} of #${number} again: ${(error as Error).message}`);
      await relabel().catch(() => undefined);
      run.failed.push(number);
    }
  };

  for (const number of (await tracker.labeled(label)).sort((a, b) => a - b)) {
    const unlabel = () => tracker.removeLabel(number, label);
    const relabel = () => tracker.addLabel(number, label);
    const wait = await latestWait(tracker, (await tracker.issue(number)).comments);
    if (wait === null || wait.flow === "update-pr" || (wait.flow === "pr-feedback" && wait.pr === null)) {
      await unlabel();
      run.dropped.push(number);
      continue;
    }
    if (Date.parse(wait.resumeAt) > now) {
      run.waiting.push(number);
      continue;
    }
    if (wait.flow === "triage") {
      triage.push(number);
      continue;
    }
    const [workflow, inputs] = dispatchOf(number, wait);
    await start(number, wait.flow, unlabel, relabel, workflow, inputs);
  }

  // One Triage reads every issue still in Triage.
  if (triage.length > 0) {
    for (const number of triage) await tracker.removeLabel(number, label);
    try {
      await codeHost.dispatch("triage", {});
      run.resumed.push(...triage.map((number) => ({ number, flow: "triage" as const })));
    } catch (error) {
      ctx.log(`factory: could not start the Triage again: ${(error as Error).message}`);
      for (const number of triage) await tracker.addLabel(number, label).catch(() => undefined);
      run.failed.push(...triage);
    }
  }

  // A pull request keyed by itself (an update of a PR with no Factory issue in progress) carries its own wait.
  for (const pr of (await codeHost.openPullRequests()).filter((p) => p.labels.includes(label)).sort((a, b) => a.number - b.number)) {
    const unlabel = () => codeHost.unlabelPr(pr.number, label);
    const relabel = () => codeHost.labelPr(pr.number, label);
    const wait = await latestWait(tracker, await codeHost.conversation(pr.number));
    if (wait?.flow !== "update-pr") {
      await unlabel();
      run.dropped.push(pr.number);
      continue;
    }
    if (Date.parse(wait.resumeAt) > now) {
      run.waiting.push(pr.number);
      continue;
    }
    await start(pr.number, wait.flow, unlabel, relabel, "update-branches", { pr: String(pr.number) });
  }
  run.switchedOff = await switchOffWhenIdle(ctx);
  return run;
}

/** Whether any open issue or pull request still waits under the label. */
async function anyPaused(ctx: CommandContext): Promise<boolean> {
  const label = ctx.config.labels.sessionLimit;
  if ((await ctx.tracker.labeled(label)).length > 0) return true;
  return (await ctx.codeHost.openPullRequests()).some((p) => p.labels.includes(label));
}

/**
 * Switches the sweep off when nothing waits. A pause that labelled an item since the read above also switched it on,
 * perhaps before this switch-off: the second read puts it back on, so an item is never left waiting with no sweep.
 * A failure is logged and changes nothing: a sweep left on only costs a run, and the next one tries again.
 */
async function switchOffWhenIdle(ctx: CommandContext): Promise<boolean> {
  try {
    if (await anyPaused(ctx)) return false;
    await ctx.codeHost.setResumeSweep(false);
    if (!(await anyPaused(ctx))) return true;
    await ctx.codeHost.setResumeSweep(true);
  } catch (error) {
    ctx.log(`factory: could not switch off the resume sweep: ${(error as Error).message}`);
  }
  return false;
}

/** The workflow that does the paused work again, and its inputs. */
function dispatchOf(issue: number, wait: Wait): [FactoryWorkflow, Record<string, string>] {
  switch (wait.flow) {
    case "pr-feedback":
      return ["pr-feedback", { pr: String(wait.pr) }];
    case "update-branch":
      return ["update-branches", { issue: String(issue) }];
    case "retro":
      return ["retro", { issue: String(issue), pr: wait.pr === null ? "" : String(wait.pr) }];
    default:
      return ["issue", { issue: String(issue) }];
  }
}

/** The wait of the newest Factory comment that carries one; null when there is none. */
export async function latestWait(tracker: Tracker, comments: { author: string; body: string }[]): Promise<Wait | null> {
  for (const comment of [...comments].reverse()) {
    if (!(await isFactoryComment(tracker, comment, SESSION_LIMIT_MARKER))) continue;
    const wait = parseWait(comment.body);
    if (wait) return wait;
  }
  return null;
}
