import { guard } from "../guard.ts";
import type { CommandContext } from "./context.ts";

export interface UnblockRun {
  dispatched: number[];
  /** Still waiting on an open blocker. They get no comment: the guard already explained on `labeled`. */
  waiting: number[];
  failed: number[];
  /** Closed issues that lost `in-progress`. */
  released: number[];
}

/**
 * First releases `in-progress` from the issue that just closed, if given. Then sweeps every open `ready-for-agent` issue (the event that triggered the
 * sweep only says "something closed"; the forge is the truth) and starts the
 * ones the guard would accept now, through the `issue` workflow. Issues
 * refused for any other reason stay as they are: `claim` explains those.
 */
export async function unblock(ctx: CommandContext, options: { closed?: number } = {}): Promise<UnblockRun> {
  const { tracker, codeHost, config } = ctx;
  const run: UnblockRun = { dispatched: [], waiting: [], failed: [], released: [] };
  // The issue that closed (a merged Factory PR closes it) must not keep `in-progress`. The number is only a hint:
  // the forge says whether it is closed and labelled.
  if (options.closed !== undefined) {
    const closed = await tracker.issue(options.closed);
    if (closed.state === "closed" && closed.labels.includes(config.labels.inProgress)) {
      await tracker.removeLabel(options.closed, config.labels.inProgress);
      run.released.push(options.closed);
    }
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
