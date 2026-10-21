import { issueBranch } from "../config.ts";
import type { CommandContext } from "./context.ts";
import { issueOfBranch, openThreads } from "./pr-threads.ts";

export type PrClaim =
  | { claimed: true; issue: number; pr: number; branch: string; startSha: string }
  | { claimed: false; reason: string };

/**
 * The guard of a comment on a pull request. It reads the forge, not the event: the only thing taken from the event
 * is who acted (`actor`) and which PR. Refuses the machine user's own comments, authors without `write`+, branches
 * that are not `factory/issue-N`, closed PRs, issues no longer `in-progress`, and PRs with nothing to answer.
 */
export async function claimPrFeedback(ctx: CommandContext, input: { pr: number; actor: string }): Promise<PrClaim> {
  const { tracker, codeHost, config } = ctx;
  const no = (reason: string): PrClaim => ({ claimed: false, reason });
  if (input.actor === "" || input.actor === config.machineUser) return no("machine-user");
  if (!(await tracker.canWrite(input.actor))) return no("actor-cannot-write");
  const pr = await codeHost.pullRequest(input.pr);
  if (!pr || pr.state !== "open") return no("pr-not-open");
  const issue = issueOfBranch(config, pr.branch);
  if (issue === null) return no("not-factory-branch");
  return await claimOpenPr(ctx, issue, pr.number, pr.branch, true);
}

/** The guard of `update-branch`: the issue is `in-progress` and its PR is open. */
export async function claimUpdateBranch(ctx: CommandContext, issue: number): Promise<PrClaim> {
  const pr = await ctx.codeHost.openPrFor(issueBranch(ctx.config, issue));
  if (!pr) return { claimed: false, reason: "no-open-pr" };
  return await claimOpenPr(ctx, issue, pr.number, pr.branch, false);
}

async function claimOpenPr(ctx: CommandContext, issue: number, pr: number, branch: string, needThreads: boolean): Promise<PrClaim> {
  const { tracker, codeHost, config } = ctx;
  const current = await tracker.issue(issue);
  if (current.state !== "open" || !current.labels.includes(config.labels.inProgress)) return { claimed: false, reason: "not-in-progress" };
  if (needThreads && (await openThreads(ctx, config, pr)).length === 0) return { claimed: false, reason: "no-open-threads" };
  const startSha = await codeHost.branchHead(branch);
  if (startSha === null) return { claimed: false, reason: "no-branch" };
  return { claimed: true, issue, pr, branch, startSha };
}

/**
 * After a push to the base branch: every `in-progress` issue with an open Factory PR whose branch no longer merges
 * cleanly gets `update-branch` dispatched. Clean ones are left alone.
 */
export async function scanBranches(
  ctx: CommandContext,
  git: { mergeConflicts(a: string, b: string): Promise<string[]> },
  base: string,
): Promise<{ dispatched: number[]; clean: number[] }> {
  const { tracker, codeHost, config } = ctx;
  const dispatched: number[] = [];
  const clean: number[] = [];
  for (const issue of (await tracker.labeled(config.labels.inProgress)).sort((a, b) => a - b)) {
    const branch = issueBranch(config, issue);
    if (!(await codeHost.openPrFor(branch))) continue;
    const head = await codeHost.branchHead(branch);
    if (head === null) continue;
    if ((await git.mergeConflicts(base, head)).length === 0) {
      clean.push(issue);
      continue;
    }
    await codeHost.dispatch("factory-update-branches.yml", { issue: String(issue) });
    dispatched.push(issue);
  }
  return { dispatched, clean };
}
