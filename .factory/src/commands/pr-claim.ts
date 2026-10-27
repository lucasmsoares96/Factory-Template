import { issueBranch } from "../config.ts";
import type { CommandContext } from "./context.ts";
import { isMarked } from "../marker.ts";
import { ACTIONS_BOT, issueOfBranch, openThreads } from "./pr-threads.ts";

/** `issue` is null for an update keyed by the pull request alone (one that is not a Factory PR in progress). */
export type PrClaim =
  | { claimed: true; issue: number | null; pr: number; branch: string; startSha: string }
  | { claimed: false; reason: string };

/**
 * The guard of a comment on a pull request. It reads the forge, not the event: the only thing taken from the event
 * is who acted (`actor`) and which PR. Refuses authors without `write`+, branches
 * that are not `factory/issue-N`, closed PRs, issues no longer `in-progress`, and PRs with nothing to answer.
 */
export async function claimPrFeedback(ctx: CommandContext, input: { pr: number; actor: string }): Promise<PrClaim> {
  const { tracker, codeHost, config } = ctx;
  const no = (reason: string): PrClaim => ({ claimed: false, reason });
  if (input.actor === "") return no("no-actor");
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
 * The guard of the update of any other open pull request, keyed by its number: open, into the base branch, from
 * this repository (the Factory never pushes to a fork nor runs its code). It touches no issue.
 */
export async function claimPrUpdate(ctx: CommandContext, number: number): Promise<PrClaim> {
  const no = (reason: string): PrClaim => ({ claimed: false, reason });
  const pr = await ctx.codeHost.pullRequest(number);
  if (!pr || pr.state !== "open") return no("pr-not-open");
  if (pr.fork) return no("fork");
  if (pr.base !== ctx.config.baseBranch) return no("other-base");
  const startSha = await ctx.codeHost.branchHead(pr.branch);
  if (startSha === null) return no("no-branch");
  return { claimed: true, issue: null, pr: pr.number, branch: pr.branch, startSha };
}

/** Hidden tag of the one comment a fork's PR gets when it is behind. */
export const FORK_UPDATE_TAG = "<!-- factory:update-fork -->";

/**
 * After a push to the base branch: every open PR into it whose head does not contain the base head is behind and gets
 * `update-branch` dispatched, Factory PRs and people's PRs alike, clean or conflicting. A Factory PR whose issue is
 * `in-progress` runs in the issue's flow (`issue`); any other one is keyed by the PR (`pr`). A fork's PR is never
 * pushed to: it gets one comment asking its author to update the branch.
 */
export async function scanBranches(
  ctx: CommandContext,
  git: { isAncestor(ancestor: string, commit: string): Promise<boolean> },
  base: string,
): Promise<{ dispatched: number[]; upToDate: number[]; forks: number[] }> {
  const { codeHost, config } = ctx;
  const dispatched: number[] = [];
  const upToDate: number[] = [];
  const forks: number[] = [];
  const prs = (await codeHost.openPullRequests()).filter((pr) => pr.base === config.baseBranch).sort((a, b) => a.number - b.number);
  for (const pr of prs) {
    let behind: boolean;
    try {
      behind = !(await git.isAncestor(base, pr.headSha));
    } catch (error) {
      ctx.log(`PR #${pr.number}: could not compare its head with ${config.baseBranch} (${(error as Error).message.split("\n")[0]}); skipped.`);
      continue;
    }
    if (!behind) {
      upToDate.push(pr.number);
      continue;
    }
    if (pr.fork) {
      forks.push(pr.number);
      // Marker plus a trusted author: the scan writes with the job token, so as the Actions bot (not a collaborator,
      // `canWrite` says no), and a writer's copy counts too. A stranger's forged copy does not silence it.
      let asked = false;
      for (const e of await codeHost.conversation(pr.number)) {
        if (isMarked(e.body) && e.body.includes(FORK_UPDATE_TAG) && (e.author === ACTIONS_BOT || (await ctx.tracker.canWrite(e.author)))) asked = true;
      }
      if (!asked) {
        await codeHost.commentPr(
          pr.number,
          `${FORK_UPDATE_TAG}\nThis branch is behind \`${config.baseBranch}\`, which must be merged in before this pull request can merge. The Factory does not push to forks: please update the branch (merge \`${config.baseBranch}\` into it, or use "Update branch") and push.`,
        );
      }
      continue;
    }
    const issue = await inProgressIssue(ctx, pr.branch);
    await codeHost.dispatch("factory-update-branches.yml", issue === null ? { pr: String(pr.number) } : { issue: String(issue) });
    dispatched.push(pr.number);
  }
  return { dispatched, upToDate, forks };
}

/** The issue of a Factory branch while it is open and `in-progress`; null for any other branch or state. */
async function inProgressIssue(ctx: CommandContext, branch: string): Promise<number | null> {
  const issue = issueOfBranch(ctx.config, branch);
  if (issue === null) return null;
  const current = await ctx.tracker.issue(issue).catch(() => null);
  return current?.state === "open" && current.labels.includes(ctx.config.labels.inProgress) ? issue : null;
}
