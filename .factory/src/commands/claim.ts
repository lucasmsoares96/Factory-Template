import { issueBranch } from "../config.ts";
import { guard, type Refusal } from "../guard.ts";
import type { CommandContext } from "./context.ts";

export type ClaimResult =
  | { claimed: true; issue: number; branch: string; startSha: string | null }
  | { claimed: false; issue: number; reason: Refusal };

/**
 * Guard + lock. On success the issue moves from ready-for-agent to
 * in-progress and the run learns the branch head it must lease against.
 */
export async function claim(ctx: CommandContext, number: number): Promise<ClaimResult> {
  const { tracker, codeHost, config } = ctx;
  const decision = await guard(tracker, config, number);
  if (!decision.ok) return { claimed: false, issue: number, reason: decision.reason };

  const branch = issueBranch(config, number);
  const startSha = await codeHost.branchHead(branch);
  if (!(await tracker.swapLabel(number, config.labels.readyForAgent, config.labels.inProgress))) {
    return { claimed: false, issue: number, reason: "not-ready" };
  }
  return { claimed: true, issue: number, branch, startSha };
}
