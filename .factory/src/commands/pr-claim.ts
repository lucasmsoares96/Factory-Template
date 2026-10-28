import { issueBranch } from "../config.ts";
import type { CommandContext } from "./context.ts";
import { isMarked } from "../marker.ts";
import type { PullRequest, ReactionTarget } from "../seams/code-host.ts";
import { ACTIONS_BOT, issueOfBranch, openThreads } from "./pr-threads.ts";
import { releaseOrphans, startWorking, type WorkingChange } from "./working.ts";

/** `issue` is null for an update keyed by the pull request alone (one that is not a Factory PR in progress). */
export type PrClaim =
  | { claimed: true; issue: number | null; pr: number; branch: string; startSha: string }
  | { claimed: false; reason: string };

/**
 * The guard of a comment on a pull request. It reads the forge, not the event: the only thing taken from the event
 * is who acted (`actor`), which PR, and the comment or review that started the round (`comment`). Refuses authors
 * without `write`+, branches that are not `factory/issue-N`, closed PRs, issues no longer `in-progress`, and PRs with
 * nothing to answer. An accepted round marks the PR and the issue `factory:working` and puts 👀 on `comment`, so its
 * author knows the Factory saw it (best effort: a refused reaction is logged).
 */
export async function claimPrFeedback(ctx: CommandContext, input: { pr: number; actor: string; comment?: Omit<ReactionTarget, "pr"> }): Promise<PrClaim> {
  const { tracker, codeHost, config } = ctx;
  const no = (reason: string): PrClaim => ({ claimed: false, reason });
  if (input.actor === "") return no("no-actor");
  if (!(await tracker.canWrite(input.actor))) return no("actor-cannot-write");
  const pr = await codeHost.pullRequest(input.pr);
  if (!pr || pr.state !== "open") return no("pr-not-open");
  const issue = issueOfBranch(config, pr.branch);
  if (issue === null) return no("not-factory-branch");
  const claim = await claimOpenPr(ctx, issue, pr.number, pr.branch, true);
  if (claim.claimed && input.comment) {
    await codeHost.react({ pr: pr.number, ...input.comment }, "eyes").catch((error: Error) => ctx.log(`The ${input.comment!.kind} ${input.comment!.id} got no reaction: ${error.message}`));
  }
  return claim;
}

/** The guard of `update-branch`: the issue is `in-progress` and its PR is open. Both get `factory:working`. */
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
  await startWorking(ctx, { issues: [issue], prs: [pr] });
  return { claimed: true, issue, pr, branch, startSha };
}

/**
 * The guard of the update of any other open pull request, keyed by its number: open, into the base branch, from
 * this repository (the Factory never pushes to a fork nor runs its code). It touches no issue; the PR gets `factory:working`.
 */
export async function claimPrUpdate(ctx: CommandContext, number: number): Promise<PrClaim> {
  const no = (reason: string): PrClaim => ({ claimed: false, reason });
  const pr = await ctx.codeHost.pullRequest(number);
  if (!pr || pr.state !== "open") return no("pr-not-open");
  if (pr.fork) return no("fork");
  if (pr.base !== ctx.config.baseBranch) return no("other-base");
  const startSha = await ctx.codeHost.branchHead(pr.branch);
  if (startSha === null) return no("no-branch");
  await startWorking(ctx, { issues: [], prs: [pr.number] });
  return { claimed: true, issue: null, pr: pr.number, branch: pr.branch, startSha };
}

/** Hidden tag of the one comment a fork's PR gets when it is behind. */
export const FORK_UPDATE_TAG = "<!-- factory:update-fork -->";

type ScanResult = { dispatched: number[]; upToDate: number[]; forks: number[] };
type IsAncestor = { isAncestor(ancestor: string, commit: string): Promise<boolean> };

/**
 * After a push to the base branch: every open PR into it whose head does not contain the base head is behind and gets
 * `update-branch` dispatched, Factory PRs and people's PRs alike, clean or conflicting. A Factory PR whose issue is
 * `in-progress` runs in the issue's flow (`issue`); any other one is keyed by the PR (`pr`). A fork's PR is never
 * pushed to: it gets one comment asking its author to update the branch. Last, `factory:working` comes off every issue
 * and PR with no Factory run queued or going: a cancelled run never reached its own end.
 */
export async function scanBranches(ctx: CommandContext, git: IsAncestor, base: string): Promise<ScanResult & { released: WorkingChange }> {
  const { codeHost, config } = ctx;
  const result: ScanResult = { dispatched: [], upToDate: [], forks: [] };
  const prs = (await codeHost.openPullRequests()).filter((pr) => pr.base === config.baseBranch).sort((a, b) => a.number - b.number);
  for (const pr of prs) await scanOne(ctx, git, base, pr, result);
  let released: WorkingChange = { issues: [], prs: [] };
  try {
    released = (await releaseOrphans(ctx)).released;
  } catch (error) {
    ctx.log(`${config.labels.working} was not cleaned up: ${(error as Error).message}`);
  }
  return { ...result, released };
}

/**
 * When PR `number` is opened or reopened: the scan of that one PR, so a PR born behind the base branch does not wait
 * for the next push to it. A PR that is missing, closed or into another base is skipped. No `factory:working` cleanup.
 */
export async function scanBranch(ctx: CommandContext, git: IsAncestor, base: string, number: number): Promise<ScanResult> {
  const result: ScanResult = { dispatched: [], upToDate: [], forks: [] };
  const pr = await ctx.codeHost.pullRequest(number);
  if (!pr || pr.state !== "open" || pr.base !== ctx.config.baseBranch) {
    ctx.log(`PR #${number}: not an open pull request into ${ctx.config.baseBranch}; skipped.`);
    return result;
  }
  await scanOne(ctx, git, base, pr, result);
  return result;
}

/** One open PR of the scan: up to date, a fork's (one comment), or dispatched. */
async function scanOne(ctx: CommandContext, git: IsAncestor, base: string, pr: PullRequest, result: ScanResult): Promise<void> {
  const { codeHost, config } = ctx;
  let behind: boolean;
  try {
    behind = !(await git.isAncestor(base, pr.headSha));
  } catch (error) {
    ctx.log(`PR #${pr.number}: could not compare its head with ${config.baseBranch} (${(error as Error).message.split("\n")[0]}); skipped.`);
    return;
  }
  if (!behind) {
    result.upToDate.push(pr.number);
    return;
  }
  if (pr.fork) {
    result.forks.push(pr.number);
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
    return;
  }
  const issue = await inProgressIssue(ctx, pr.branch);
  await codeHost.dispatch("update-branches", issue === null ? { pr: String(pr.number) } : { issue: String(issue) });
  result.dispatched.push(pr.number);
}

/** The issue of a Factory branch while it is open and `in-progress`; null for any other branch or state. */
async function inProgressIssue(ctx: CommandContext, branch: string): Promise<number | null> {
  const issue = issueOfBranch(ctx.config, branch);
  if (issue === null) return null;
  const current = await ctx.tracker.issue(issue).catch(() => null);
  return current?.state === "open" && current.labels.includes(ctx.config.labels.inProgress) ? issue : null;
}
