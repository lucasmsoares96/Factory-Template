import { issueBranch } from "../config.ts";
import { guard, isFactoryComment, type GuardDecision, type Refusal } from "../guard.ts";
import type { CommandContext } from "./context.ts";

export type ClaimResult =
  | { claimed: true; issue: number; branch: string; startSha: string | null }
  | { claimed: false; issue: number; reason: Refusal };

export const WAITING_MARKER = "<!-- factory:waiting -->";

/**
 * Guard + lock. On success the issue moves from ready-for-agent to
 * in-progress and the run learns the branch head it must lease against.
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
  return { claimed: true, issue: number, branch, startSha };
}

/** Routes the issues a human can fix: missing criteria, missing seams, blockers. */
async function answerRefusal(ctx: CommandContext, decision: Exclude<GuardDecision, { ok: true }>, event: string | null) {
  const { tracker, config } = ctx;
  const { number } = decision.issue;
  const ready = config.labels.readyForAgent;
  switch (decision.reason) {
    case "missing-acceptance-criteria":
      if (await tracker.swapLabel(number, ready, config.labels.needsInfo)) {
        await tracker.comment(
          number,
          `The Factory needs a \`## Acceptance criteria\` section in the issue body. Add it and re-add \`${ready}\`.`,
        );
      }
      return;
    case "missing-seams":
      if (await tracker.swapLabel(number, ready, config.labels.agentExplore)) {
        await tracker.comment(
          number,
          "No agreed seams: the parent spec has no `## Testing Decisions` and there is no Triage comment. Sent to Triage.",
        );
      }
      return;
    case "blocked": {
      if (event !== "labeled") return;
      for (const c of decision.issue.comments) if (await isFactoryComment(tracker, c, WAITING_MARKER)) return;
      const list = decision.waitingOn.map((n) => `#${n}`).join(", ");
      await tracker.comment(
        number,
        [
          WAITING_MARKER,
          `Waiting on ${list}. The Factory starts this issue when the last of them is done.`,
          `If you remove a dependency, remove and re-add \`${ready}\` to start right away.`,
        ].join("\n"),
      );
      return;
    }
    default:
      return;
  }
}
