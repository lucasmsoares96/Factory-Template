import { join } from "node:path";
import { issueBranch } from "../config.ts";
import { diffLines, filterToDiff, type DiffLines } from "../diff.ts";
import { Git } from "../git.ts";
import { isHarnessPath, isProtectedPath } from "../paths.ts";
import { escalationComment, followUpComment, usageLine, type EscalationReason, type FollowUpRef } from "../report.ts";
import { BUNDLE_FILE, EVIDENCE_DIR, RESULT_FILE, readResult, type FactoryResult } from "../result.ts";
import type { EvidenceGroup, PullRequest } from "../seams/code-host.ts";
import type { Issue } from "../seams/tracker.ts";
import type { CommandContext } from "./context.ts";

export type PublishResult =
  | { issue: number; outcome: "ready"; pr: number; url: string }
  | { issue: number; outcome: "escalated"; reason: EscalationReason; pr: number | null; url: string | null }
  | { issue: number; outcome: "discarded"; reason: string };

export interface PublishOptions {
  /** Checkout the bundle is fetched into. */
  repo: string;
  /** Artifacts of the `work` job: result.json, the branch bundle and the prints. */
  in: string;
  /** Head of the issue branch when the run was claimed; the push leases against it. */
  startSha: string | null;
  /** Link to the workflow run, for the Escalation comment. */
  runUrl: string | null;
  /** The open pull request this run continues (PR flows); null in the issue flow. */
  pr: number | null;
}

/**
 * The `publish` job: the only one with the forge token. Re-reads forge state
 * and discards the run if it changed, validates the artifacts of `work` (none
 * or invalid: Escalation "infra"), refuses protected paths, then pushes with a
 * lease and either delivers a ready PR or escalates.
 */
export async function publish(ctx: CommandContext, number: number, options: PublishOptions): Promise<PublishResult> {
  const { config } = ctx;
  const branch = issueBranch(config, number);
  const git = new Git(options.repo);

  const state = await recheck(ctx, number, branch, options);
  if (!state.ok) return discard(ctx, number, state.reason);
  const { issue, openPr } = state;

  let result: FactoryResult;
  try {
    result = await loadArtifacts(git, number, branch, options.in);
  } catch (error) {
    return escalate(ctx, issue, { reason: "infra", result: null, detail: (error as Error).message, pr: null, runUrl: options.runUrl });
  }

  const head = result.head;
  const changed = head ? await changedFiles(git, result.base, head) : [];
  const protectedPaths = changed.filter(isProtectedPath);
  if (head && protectedPaths.length > 0) {
    const patch = await git.run("diff", "--no-color", "--no-ext-diff", `${result.base}...${head}`);
    return escalate(ctx, issue, { reason: "protected-paths", result, protectedPaths, patch, pr: null, runUrl: options.runUrl });
  }
  if (!head) {
    const followUps = await openFollowUps(ctx, issue, result);
    return escalate(ctx, issue, { reason: result.reason ?? "infra", result, pr: null, runUrl: options.runUrl, followUps });
  }

  const push = await ctx.codeHost.push({ branch, sha: head, expectedSha: options.startSha });
  if (!push.ok) return discard(ctx, number, `branch ${branch} moved since the run started`);

  const followUps = await openFollowUps(ctx, issue, result);
  const lines = await diffLines(git, result.base, head);
  const harnessPaths = changed.filter(isHarnessPath);
  const escalated = result.outcome === "escalated" ? (result.reason ?? "infra") : null;
  const pr = await pullRequest(ctx, issue, { branch, openPr, continues: options.pr !== null, harnessPaths, escalated, followUps });
  if (!escalated || result.review.summary !== "") await submitReview(ctx, pr.number, result, lines);

  if (escalated) return escalate(ctx, issue, { reason: escalated, result, pr, runUrl: options.runUrl, followUps });
  if (followUps.length > 0) await ctx.tracker.comment(number, followUpComment(followUps));
  if (result.evidence.length > 0) await ctx.codeHost.postEvidence(pr.number, evidenceGroups(result, options.in));
  await ctx.codeHost.markReady(pr.number);
  return { issue: number, outcome: "ready", pr: pr.number, url: pr.url };
}

type Recheck = { ok: true; issue: Issue; openPr: PullRequest | null } | { ok: false; reason: string };

/** Forge state must still match the claim: issue open and locked, PR as expected, branch where it was. */
async function recheck(ctx: CommandContext, number: number, branch: string, options: PublishOptions): Promise<Recheck> {
  const { tracker, codeHost, config } = ctx;
  const issue = await tracker.issue(number);
  if (issue.state !== "open") return { ok: false, reason: `issue #${number} is closed` };
  if (!issue.labels.includes(config.labels.inProgress)) {
    return { ok: false, reason: `issue #${number} no longer has \`${config.labels.inProgress}\`` };
  }
  const openPr = await codeHost.openPrFor(branch);
  if (options.pr !== null && openPr?.number !== options.pr) {
    return { ok: false, reason: `pull request #${options.pr} is no longer open` };
  }
  if (options.pr === null && openPr && !openPr.draft) {
    return { ok: false, reason: `pull request #${openPr.number} is already open for this issue` };
  }
  if ((await codeHost.branchHead(branch)) !== options.startSha) {
    return { ok: false, reason: `branch ${branch} moved since the run started` };
  }
  return { ok: true, issue, openPr };
}

async function discard(ctx: CommandContext, number: number, reason: string): Promise<PublishResult> {
  await ctx.tracker.comment(number, `Run discarded: ${reason}. Nothing was pushed.`);
  return { issue: number, outcome: "discarded", reason };
}

/** result.json plus the branch from the bundle; any mismatch is an infra failure. */
async function loadArtifacts(git: Git, number: number, branch: string, dir: string): Promise<FactoryResult> {
  const result = await readResult(join(dir, RESULT_FILE));
  if (result.issue !== number) throw new Error(`result.json is for #${result.issue}, not #${number}`);
  if (result.branch !== branch) throw new Error(`result.json names branch ${result.branch}, not ${branch}`);
  if (result.outcome === "ready" && result.head === null) throw new Error("result.json is ready but has no commits");
  if (result.head !== null) {
    await git.run("fetch", "--quiet", join(dir, BUNDLE_FILE), `+refs/heads/${branch}:refs/heads/${branch}`);
    const head = await git.revParse(branch);
    if (head !== result.head) throw new Error(`Bundle head ${head} does not match result.json head ${result.head}`);
  }
  return result;
}

async function changedFiles(git: Git, base: string, head: string): Promise<string[]> {
  const names = await git.run("-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", `${base}...${head}`);
  return names.split("\n").filter(Boolean);
}

/**
 * The pull request the run lands on. Issue flow: a stale Escalation draft is
 * closed and a new draft opened. PR flow: the open pull request it continues.
 */
async function pullRequest(
  ctx: CommandContext,
  issue: Issue,
  input: { branch: string; openPr: PullRequest | null; continues: boolean; harnessPaths: string[]; escalated: EscalationReason | null; followUps: FollowUpRef[] },
): Promise<PullRequest> {
  const { codeHost, config } = ctx;
  let pr: PullRequest;
  if (input.continues && input.openPr) {
    pr = input.openPr;
  } else {
    if (input.openPr) {
      await codeHost.closePr(
        input.openPr.number,
        `Superseded by a new Factory run for #${issue.number}, which starts over from \`${config.baseBranch}\`.`,
      );
    }
    const warnings: string[] = [];
    if (input.escalated) {
      warnings.push(
        "> [!WARNING]",
        `> The Factory escalated this work (\`${input.escalated}\`): this draft holds its progress. See the comment on #${issue.number}.`,
        "",
      );
    }
    if (input.harnessPaths.length > 0) {
      warnings.push(
        "> [!CAUTION]",
        `> This pull request changes files that steer the Factory: ${input.harnessPaths.map((p) => `\`${p}\``).join(", ")}. Review them with care.`,
        "",
      );
    }
    if (input.followUps.length > 0) warnings.push("> [!NOTE]", `> ${followUpComment(input.followUps).replaceAll("\n", "\n> ")}`, "");
    pr = await codeHost.openDraftPr({
      branch: input.branch,
      base: config.baseBranch,
      title: `Fix #${issue.number}: ${issue.title}`,
      body: [...warnings, `Closes #${issue.number}`, "", "Implemented by the Factory."].join("\n"),
    });
  }
  if (input.harnessPaths.length > 0) await codeHost.labelPr(pr.number, config.labels.harnessChange);
  return pr;
}

/** The review of every attempt, inline comments filtered to the diff, tokens and cost in the footer. */
async function submitReview(ctx: CommandContext, pr: number, result: FactoryResult, lines: DiffLines): Promise<void> {
  await ctx.codeHost.submitReview(pr, {
    event: "COMMENT",
    body: `${result.review.summary || "No findings."}\n\n---\n${usageLine(result.usage, ctx.config.pricing)}`,
    comments: filterToDiff(result.review.inline, lines),
  });
}

/** Opens the Skeleton tickets the run asked for, linked to the issue; they wait for triage. */
async function openFollowUps(ctx: CommandContext, issue: Issue, result: FactoryResult): Promise<FollowUpRef[]> {
  const refs: FollowUpRef[] = [];
  for (const followUp of result.followUps) {
    const created = await ctx.tracker.createIssue({
      title: followUp.title,
      body: followUp.body,
      labels: [ctx.config.labels.needsTriage],
      relatedTo: issue.number,
    });
    refs.push({ number: created.number, title: followUp.title });
  }
  return refs;
}

/** Escalation: the report on the issue, then in-progress → ready-for-human. */
async function escalate(
  ctx: CommandContext,
  issue: Issue,
  report: Parameters<typeof escalationComment>[0],
): Promise<PublishResult> {
  const { tracker, config } = ctx;
  await tracker.comment(issue.number, escalationComment(report, config));
  await tracker.swapLabel(issue.number, config.labels.inProgress, config.labels.readyForHuman);
  return { issue: issue.number, outcome: "escalated", reason: report.reason, pr: report.pr?.number ?? null, url: report.pr?.url ?? null };
}

/** Prints grouped by Product, in the order `work` listed them. */
function evidenceGroups(result: FactoryResult, dir: string): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();
  for (const { product, name } of result.evidence) {
    const group = groups.get(product) ?? { product, images: [] };
    group.images.push({ name, path: join(dir, EVIDENCE_DIR, product, name) });
    groups.set(product, group);
  }
  return [...groups.values()];
}
