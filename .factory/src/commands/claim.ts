import { issueBranch } from "../config.ts";
import { guard, isFactoryComment, type GuardDecision, type Refusal } from "../guard.ts";
import { messages } from "../messages.ts";
import type { CommandContext } from "./context.ts";
import { startWorking } from "./working.ts";

export type ClaimResult =
  | { claimed: true; issue: number; branch: string; startSha: string | null }
  | { claimed: false; issue: number; reason: Refusal };

export const WAITING_MARKER = "<!-- factory:waiting -->";

/**
 * Guard + lock. On success the issue moves from ready-for-agent to
 * in-progress, it and its open pull request get `factory:working`, and the run learns the branch head it must lease against.
 * `event` is the forge event that started the run (`labeled`, or none for a
 * dispatch); only `labeled` explains a Blocked Issue.
 */
export async function claim(ctx: CommandContext, number: number, options: { event: string | null }): Promise<ClaimResult> {
  const { tracker, codeHost, config } = ctx;
  const decision = await guard(ctx, config, number);
  if (!decision.ok) {
    await answerRefusal(ctx, decision, options.event);
    return { claimed: false, issue: number, reason: decision.reason };
  }

  const branch = issueBranch(config, number);
  const startSha = await codeHost.branchHead(branch);
  if (!(await tracker.swapLabel(number, config.labels.readyForAgent, config.labels.inProgress))) {
    return { claimed: false, issue: number, reason: "not-ready" };
  }
  await startWorking(ctx, { issues: [number], prs: [] });
  return { claimed: true, issue: number, branch, startSha };
}

/** Routes the issues a human can fix: missing criteria, missing seams, blockers. */
async function answerRefusal(ctx: CommandContext, decision: Exclude<GuardDecision, { ok: true }>, event: string | null) {
  const { tracker, config } = ctx;
  const { number } = decision.issue;
  const ready = config.labels.readyForAgent;
  const m = messages(config.language);
  switch (decision.reason) {
    case "missing-acceptance-criteria":
      if (await tracker.swapLabel(number, ready, config.labels.needsInfo)) {
        await tracker.comment(number, m.missingCriteria(ready));
      }
      return;
    case "missing-seams":
      if (await tracker.swapLabel(number, ready, config.labels.agentExplore)) {
        await tracker.comment(number, m.missingSeams());
        await startTriage(ctx, number);
      }
      return;
    case "blocked": {
      if (event !== "labeled") return;
      for (const c of decision.issue.comments) if (await isFactoryComment(tracker, c, WAITING_MARKER)) return;
      const list = decision.waitingOn.map((n) => `#${n}`).join(", ");
      await tracker.comment(number, [WAITING_MARKER, m.waitingOn(list, ready)].join("\n"));
      return;
    }
    default:
      return;
  }
}

/**
 * The swap above is made with the job token, which starts no workflow, so the Factory starts the Triage itself. No
 * issue list: a run already queued or going reads every issue in Triage. A dispatch that fails (local mode, a refused
 * call) leaves the issue in Triage for the next run, and is logged.
 */
async function startTriage(ctx: CommandContext, number: number): Promise<void> {
  try {
    await ctx.codeHost.dispatch("triage", {});
  } catch (error) {
    ctx.log(`The Triage of #${number} did not start: ${(error as Error).message}`);
  }
}
