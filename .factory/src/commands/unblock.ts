import { checkCriteria } from "../criteria.ts";
import type { Issue } from "../seams/tracker.ts";
import { guard } from "../guard.ts";
import { issueBranch } from "../config.ts";
import type { CommandContext } from "./context.ts";

export interface UnblockRun {
  dispatched: number[];
  /** Still waiting on an open blocker. They get no comment: the guard already explained on `labeled`. */
  waiting: number[];
  failed: number[];
  /** Closed issues that lost `in-progress`. */
  released: number[];
  /** Closed issues whose acceptance criteria were checked after a merged Factory pull request closed them. */
  checked: number[];
}

/** Writes tried before giving up on an issue edited again and again. */
const CHECK_ATTEMPTS = 5;

/**
 * First releases `in-progress` from the issue that just closed, if given. Then sweeps every open `ready-for-agent` issue (the event that triggered the
 * sweep only says "something closed"; the forge is the truth) and starts the
 * ones the guard would accept now, through the `issue` workflow. Issues
 * refused for any other reason stay as they are: `claim` explains those.
 */
export async function unblock(ctx: CommandContext, options: { closed?: number } = {}): Promise<UnblockRun> {
  const { tracker, codeHost, config } = ctx;
  const run: UnblockRun = { dispatched: [], waiting: [], failed: [], released: [], checked: [] };
  // The issue that closed (a merged Factory PR closes it) must not keep `in-progress`. The number is only a hint:
  // the forge says whether it is closed and labelled.
  if (options.closed !== undefined) {
    const closed = await tracker.issue(options.closed);
    if (closed.state === "closed" && closed.labels.includes(config.labels.inProgress)) {
      await tracker.removeLabel(options.closed, config.labels.inProgress);
      run.released.push(options.closed);
    }
    if (await markCriteria(ctx, closed)) run.checked.push(options.closed);
  }
  for (const number of (await tracker.labeled(config.labels.readyForAgent)).sort((a, b) => a - b)) {
    const decision = await guard(ctx, config, number);
    if (!decision.ok) {
      if (decision.reason === "blocked") run.waiting.push(number);
      continue;
    }
    try {
      await codeHost.dispatch("issue", { issue: String(number) });
      run.dispatched.push(number);
    } catch (error) {
      ctx.log(`factory: could not start #${number}: ${(error as Error).message}`);
      run.failed.push(number);
    }
  }
  return run;
}

/**
 * A Factory pull request that merged closed the issue as completed: check the boxes of its criteria section. A body
 * that changes between the read and the write is read again and the edit redone, so a concurrent edit is never erased
 * (the REST API has no conditional write: the body is read once more right before it is written). An issue closed as
 * not planned, or with no merged Factory pull request, is not touched.
 */
async function markCriteria(ctx: CommandContext, closed: Issue): Promise<boolean> {
  const { tracker, codeHost, config } = ctx;
  if (closed.state !== "closed" || closed.stateReason !== "completed") return false;
  if ((await codeHost.mergedPrFor(issueBranch(config, closed.number))) === null) return false;
  let body = closed.body;
  for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt++) {
    const next = checkCriteria(body);
    if (next === body) return false;
    const latest = (await tracker.issue(closed.number)).body;
    if (latest === body) {
      await tracker.rewriteIssueBody(closed.number, next);
      return true;
    }
    body = latest;
  }
  ctx.log(`factory: #${closed.number} kept changing, its criteria were not checked`);
  return false;
}
