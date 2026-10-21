import type { FactoryConfig } from "../config.ts";
import type { CodeHost, ReviewThread } from "../seams/code-host.ts";
import type { Tracker } from "../seams/tracker.ts";

/**
 * Threads still waiting for the Factory: the last comment is not the machine user's and was written by someone
 * with `write`+. The forge has no "resolved" flag in the seam; the Factory never resolves a thread, so a thread is
 * open until the Factory has had the last word.
 */
export async function openThreads(
  seams: { tracker: Tracker; codeHost: CodeHost },
  config: FactoryConfig,
  pr: number,
): Promise<ReviewThread[]> {
  const open: ReviewThread[] = [];
  for (const thread of await seams.codeHost.threads(pr)) {
    const last = thread.replies.at(-1) ?? thread;
    if (last.author === config.machineUser) continue;
    if (!(await seams.tracker.canWrite(last.author))) continue;
    open.push(thread);
  }
  return open;
}

/** The issue number of a Factory branch (`factory/issue-N`), or null for any other branch. */
export function issueOfBranch(config: FactoryConfig, branch: string): number | null {
  if (!branch.startsWith(config.branchPrefix)) return null;
  const rest = branch.slice(config.branchPrefix.length);
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : null;
}
