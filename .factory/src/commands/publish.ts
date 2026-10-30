import { join } from "node:path";
import { issueBranch } from "../config.ts";
import { diffLines, filterToDiff, type DiffLines } from "../diff.ts";
import { forForge } from "../forge-text.ts";
import { Git } from "../git.ts";
import { messages, type Language, type Messages } from "../messages.ts";
import { isHarnessPath, isSensitivePath } from "../paths.ts";
import { attemptLine, costFooter, escalationComment, fence, lastFailure, verdictsSection, type EscalationReason } from "../report.ts";
import { BUNDLE_FILE, EVIDENCE_DIR, RESULT_FILE, readResult, type CriterionVerdict, type FactoryResult } from "../result.ts";
import { skeletonPaths } from "../scope.ts";
import { fromTouchedSpecs, isSpecPath, shownIn, withEvidence, type TouchedSpec } from "../pull-request-evidence.ts";
import type { EvidenceImage, PullRequest } from "../seams/code-host.ts";
import type { Issue } from "../seams/tracker.ts";
import { armResumeSweep, sessionLimitComment, utcMinute, type Wait } from "../session-limit.ts";
import type { CommandContext } from "./context.ts";

export type PublishResult =
  | { issue: number; outcome: "ready"; pr: number; url: string }
  | { issue: number; outcome: "escalated"; reason: EscalationReason; pr: number | null; url: string | null }
  | { issue: number; outcome: "discarded"; reason: string }
  | { issue: number; outcome: "paused"; reason: "session-limit"; resetsAt: string | null; resumeAt: string };

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
  /**
   * The update of a branch: a run discarded because the branch moved says so in the log only, for the newer update
   * that moved it (or cancelled it) is on its way. Any other discard, and the other flows, comment on the issue.
   */
  flow?: "update-branch";
  /**
   * Puts `factory:working` on the pull request this run opens, with the job token: a label written with the forge
   * token would start `pull_request_target: labeled` workflows. Best effort; the run's last step takes it off.
   */
  markWorking?: (pr: number) => Promise<void>;
  /**
   * Dispatches the automatic Retro of an Escalation with the job token (`actions: write`): the forge token may not
   * dispatch workflows. Without it, the run's code host dispatches.
   */
  dispatchRetro?: (inputs: { issue: string; pr: string }) => Promise<void>;
  /**
   * Result of the workflow's `work` job (`needs.work.result`). A PR round (or update-branch) whose `work` was
   * cancelled and left no result.json publishes nothing: it only says so in the log.
   */
  workResult?: string | null;
  /** This run is the pr-feedback round started again after a discard: a second discard comments on the PR instead. */
  retry?: boolean;
  /**
   * Dispatches the pr-feedback round again with the job token (`actions: write`) after a discard because the branch
   * moved. Without it, the run's code host dispatches.
   */
  redispatchRound?: (inputs: { pr: string; retry: string }) => Promise<void>;
  /** Switches the resume sweep on with the job token (`actions: write`) when a run pauses; without it, the run's code host does. */
  armResume?: () => Promise<void>;
}

/**
 * The `publish` job: the only one with the forge token. Re-reads forge state
 * and discards the run if it changed, validates the artifacts of `work` (none
 * or invalid: Escalation "infra"), then pushes with a lease and either delivers
 * a ready PR or escalates. A diff in a sensitive or harness path is flagged on
 * the PR, never refused. A Skeleton change a Product run reverted becomes a
 * pull request of its own; a Product issue that cannot finish without it waits
 * on it, blocked and back in the queue.
 */
export async function publish(ctx: CommandContext, number: number, options: PublishOptions): Promise<PublishResult> {
  const { config } = ctx;
  const branch = issueBranch(config, number);
  const git = new Git(options.repo);

  const quietMoved = options.flow === "update-branch";
  const state = await recheck(ctx, number, branch, options);
  if (!state.ok) return discard(ctx, number, state.reason, quietMoved && state.moved, state.moved ? options : undefined);
  const { issue, openPr } = state;
  // recheck holds the continued PR to `options.pr`: it is `openPr` in a PR round.
  const round = options.pr !== null ? openPr : null;

  let result: FactoryResult;
  try {
    result = forForge(await loadArtifacts(git, number, branch, options.in));
  } catch (error) {
    if (options.workResult === "cancelled" && (options.pr !== null || quietMoved)) {
      const reason = `work was cancelled: nothing to publish for #${number}`;
      ctx.log(messages("en").discarded(reason));
      return { issue: number, outcome: "discarded", reason };
    }
    if (options.workResult === "cancelled") ctx.log(messages("en").cancelledWorkEscalates(number));
    return escalate(ctx, issue, { reason: "infra", result: null, detail: (error as Error).message, pr: null, runUrl: options.runUrl }, round, options.dispatchRetro);
  }
  if (result.outcome === "paused") return pause(ctx, issue, result, options);

  const head = result.head;
  const changed = head ? await changedFiles(git, result.base, head) : [];
  if (!head) return escalate(ctx, issue, { reason: escalationReason(result), result, pr: null, runUrl: options.runUrl }, round, options.dispatchRetro);

  const push = await ctx.codeHost.push({ branch, sha: head, expectedSha: options.startSha });
  if (!push.ok) return discard(ctx, number, (m) => m.branchMoved(branch), quietMoved, options);

  const lines = await diffLines(git, result.base, head);
  const sensitivePaths = changed.filter(isSensitivePath);
  const harnessPaths = changed.filter((path) => isHarnessPath(path) && !isSensitivePath(path));
  const escalated = result.outcome === "ready" ? null : escalationReason(result);
  const pr = await pullRequest(ctx, issue, { branch, openPr, continues: options.pr !== null, sensitivePaths, harnessPaths, skeletonFiles: skeletonPaths(changed), escalated, text: result.pullRequestBody, criteria: result.review.criteria, images: evidenceImages(result, options.in), appendable: fromTouchedSpecs(await touchedSpecs(git, head, changed)), markWorking: options.markWorking });
  if (!escalated || result.review.summary !== "") {
    // A PR round without a Review (update-branch, a round that only answers) leaves no empty review behind.
    if (options.pr === null || result.review.summary !== "") await submitReview(ctx, pr.number, result, lines);
  }
  if (options.pr !== null) await postReplies(ctx, pr.number, result.threadReplies);

  if (escalated) return escalate(ctx, issue, { reason: escalated, result, pr, runUrl: options.runUrl }, round, options.dispatchRetro);
  if (pr.draft) await ctx.codeHost.markReady(pr.number);
  return { issue: number, outcome: "ready", pr: pr.number, url: pr.url };
}

export type PrUpdateResult =
  | { pr: number; outcome: "updated"; url: string }
  | { pr: number; outcome: "up-to-date" | "stopped" | "discarded" | "paused"; reason: string };

/**
 * `publish` of an update keyed by the pull request alone (`publish --pr N` without an issue): it never runs as an
 * issue flow. It changes no label, opens no PR and comments only on this one: what was merged, or why it stopped.
 * The push leases against the head of the claim; a run that did not pass Verify pushes nothing. A run discarded
 * because the branch moved only logs it: a newer update of the PR is on its way.
 */
export async function publishPrUpdate(ctx: CommandContext, number: number, options: Omit<PublishOptions, "pr">): Promise<PrUpdateResult> {
  const { codeHost, config } = ctx;
  const m = messages(config.language);
  const git = new Git(options.repo);
  const stop = async (reason: string, comment: string): Promise<PrUpdateResult> => {
    await codeHost.commentPr(number, comment);
    return { pr: number, outcome: "stopped", reason };
  };
  const pr = await codeHost.pullRequest(number);
  if (!pr || pr.state !== "open" || pr.fork) return { pr: number, outcome: "discarded", reason: `pull request #${number} is no longer open on this repository` };
  const moved = messages("en").branchMoved(pr.branch);
  const discarded = (): PrUpdateResult => {
    ctx.log(messages("en").discarded(moved));
    return { pr: number, outcome: "discarded", reason: moved };
  };
  if ((await codeHost.branchHead(pr.branch)) !== options.startSha) return discarded();

  let result: FactoryResult;
  try {
    result = forForge(await loadArtifacts(git, number, pr.branch, options.in));
  } catch (error) {
    if (options.workResult === "cancelled") {
      const reason = `work was cancelled: nothing to publish for pull request #${number}`;
      ctx.log(messages("en").discarded(reason));
      return { pr: number, outcome: "discarded", reason };
    }
    const detail = (error as Error).message;
    return stop("infra", m.updateNoResult(config.baseBranch, detail) + runLine(options.runUrl, config.language));
  }
  if (result.outcome === "paused") {
    // The wait lives on the PR itself: no issue holds this update. `resume` starts it again after the reset.
    const failure = result.session!;
    const wait: Wait = { flow: "update-pr", resumeAt: failure.limit!.resumeAt, head: null, pr: number };
    await codeHost.labelPr(number, config.labels.sessionLimit);
    const armed = await armResumeSweep(ctx, options.armResume);
    await codeHost.commentPr(number, sessionLimitComment({ wait, failure, next: m.sessionLimitUpdate(number, config.baseBranch), runUrl: options.runUrl, armed }, config));
    return { pr: number, outcome: "paused", reason: "session-limit" };
  }
  if (result.outcome === "escalated") {
    return stop(result.reason ?? "infra", prUpdateStopped(result, config.baseBranch, options.runUrl, config.language));
  }
  if (result.head === null || result.head === options.startSha) return { pr: number, outcome: "up-to-date", reason: `already contains ${config.baseBranch}` };

  const push = await codeHost.push({ branch: pr.branch, sha: result.head, expectedSha: options.startSha });
  if (!push.ok) return discarded();
  const fixes = result.attempts.length > 1 ? `${m.updateFixed()}\n\n${result.attempts.map((a) => `- ${attemptLine(a, config.language)}`).join("\n")}` : m.updateVerified();
  await codeHost.commentPr(number, `${m.updated(config.baseBranch, result.base.slice(0, 7), result.head.slice(0, 7))}${fixes}${runLine(options.runUrl, config.language)}`);
  return { pr: number, outcome: "updated", url: pr.url };
}

/** Why the update of a person's PR stopped, with the attempts: the branch is left as it was. */
function prUpdateStopped(result: FactoryResult, base: string, runUrl: string | null, language: Language): string {
  const m = messages(language);
  const lines = [m.updateStopped(base, result.reason ?? "infra")];
  if (result.question) lines.push("", result.question);
  if (result.attempts.length > 0) {
    lines.push("", m.attempts(), ...result.attempts.map((a) => `- ${attemptLine(a, language)}`));
    const failure = lastFailure(result);
    if (failure?.output) lines.push("", m.lastOutput(failure.failedCommand ?? null), fence(failure.output, "text"));
  }
  return lines.join("\n") + runLine(runUrl, language);
}

function runLine(runUrl: string | null, language: Language): string {
  return runUrl ? `\n\n${messages(language).workflowRun(runUrl)}` : "";
}

/** Why a run is discarded, in any language: the result keeps the English one, the comment the configured one. */
type DiscardReason = (m: Messages) => string;

type Recheck = { ok: true; issue: Issue; openPr: PullRequest | null } | { ok: false; reason: DiscardReason; moved?: true };

/** Forge state must still match the claim: issue open and locked, PR as expected, branch where it was. */
async function recheck(ctx: CommandContext, number: number, branch: string, options: PublishOptions): Promise<Recheck> {
  const { tracker, codeHost, config } = ctx;
  const issue = await tracker.issue(number);
  if (issue.state !== "open") return { ok: false, reason: (m) => m.issueClosed(number) };
  if (!issue.labels.includes(config.labels.inProgress)) {
    return { ok: false, reason: (m) => m.issueUnlocked(number, config.labels.inProgress) };
  }
  const openPr = await codeHost.openPrFor(branch);
  const continued = options.pr;
  if (continued !== null && openPr?.number !== continued) {
    return { ok: false, reason: (m) => m.pullRequestGone(continued) };
  }
  if (options.pr === null && openPr && !openPr.draft) {
    return { ok: false, reason: (m) => m.pullRequestOpen(openPr.number) };
  }
  if ((await codeHost.branchHead(branch)) !== options.startSha) {
    return { ok: false, reason: (m) => m.branchMoved(branch), moved: true };
  }
  return { ok: true, issue, openPr };
}

/**
 * Comments why the run was discarded on the issue; a quiet discard writes it to the log alone. A round on a pull request
 * (not an update-branch) discarded because the branch moved is dispatched again once, from the new head; if that one is
 * discarded too, the pull request says so. `moved` runs pass their options: only they may start the round again.
 */
async function discard(ctx: CommandContext, number: number, reason: DiscardReason, quiet = false, moved?: PublishOptions): Promise<PublishResult> {
  const m = messages(ctx.config.language);
  if (quiet) ctx.log(messages("en").discarded(reason(messages("en"))));
  else await ctx.tracker.comment(number, m.discarded(reason(m)));
  if (moved && moved.pr !== null && moved.flow !== "update-branch") {
    if (moved.retry) await ctx.codeHost.commentPr(moved.pr, m.discardedTwice(reason(m)));
    else {
      const inputs = { pr: String(moved.pr), retry: "true" };
      try {
        await (moved.redispatchRound ? moved.redispatchRound(inputs) : ctx.codeHost.dispatch("pr-feedback", inputs));
      } catch (error) {
        ctx.log(`The round of PR #${moved.pr} was not started again: ${(error as Error).message}`);
        await ctx.codeHost.commentPr(moved.pr, m.discarded(reason(m)));
      }
    }
  }
  return { issue: number, outcome: "discarded", reason: reason(messages("en")) };
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

/** The spec files the change touched, with their content at `head` (a deleted one has none and is left out). */
async function touchedSpecs(git: Git, head: string, changed: string[]): Promise<TouchedSpec[]> {
  const specs: TouchedSpec[] = [];
  for (const path of changed.filter(isSpecPath)) {
    const content = await git.run("show", `${head}:${path}`).catch(() => null);
    if (content !== null) specs.push({ path, content });
  }
  return specs;
}

/**
 * The pull request the run lands on. Issue flow: a stale Escalation draft is
 * closed and a new draft opened. PR flow: the open pull request it continues.
 */
async function pullRequest(
  ctx: CommandContext,
  issue: Issue,
  input: { branch: string; openPr: PullRequest | null; continues: boolean; sensitivePaths: string[]; harnessPaths: string[]; skeletonFiles: string[]; escalated: EscalationReason | null; text: string | null; criteria: CriterionVerdict[]; images: EvidenceImage[]; appendable: (image: EvidenceImage) => boolean; markWorking?: PublishOptions["markWorking"] },
): Promise<PullRequest> {
  const { codeHost, config } = ctx;
  let pr: PullRequest;
  if (input.continues && input.openPr) {
    pr = input.openPr;
    // The run may have changed the PR: its body is written again.
    if (input.text !== null) {
      const body = prBody(issue, input, config.language);
      await codeHost.updatePrBody(pr.number, body, shownIn(body, input.images));
    }
  } else {
    if (input.openPr) {
      await codeHost.closePr(input.openPr.number, messages(config.language).superseded(issue.number, config.baseBranch));
    }
    const body = prBody(issue, input, config.language);
    pr = await codeHost.openDraftPr({
      branch: input.branch,
      base: config.baseBranch,
      title: `Fix #${issue.number}: ${issue.title}`,
      body,
      images: shownIn(body, input.images),
    });
    // A continued PR got `factory:working` at the claim; this one exists only now.
    await input.markWorking?.(pr.number).catch((error: Error) => ctx.log(`${config.labels.working} on PR #${pr.number} could not be put on: ${error.message}`));
  }
  if (input.sensitivePaths.length + input.harnessPaths.length > 0) await codeHost.labelPr(pr.number, config.labels.harnessChange);
  return pr;
}

/**
 * The body in four parts (the print references swapped by `withEvidence`): the warnings (deterministic),
 * the Pull Request Stage text (or the minimal sentence), the final Review's verdict on each acceptance criterion, `Closes #N`.
 * The agent never writes the first and last parts; its text and verdicts come cleaned by `forForge`.
 */
function prBody(
  issue: Issue,
  input: { continues: boolean; sensitivePaths: string[]; harnessPaths: string[]; skeletonFiles: string[]; escalated: EscalationReason | null; text: string | null; criteria: CriterionVerdict[]; images: EvidenceImage[]; appendable: (image: EvidenceImage) => boolean },
  language: Language,
): string {
  const m = messages(language);
  const warnings: string[] = [];
  // A round on a ready PR leaves it as it is (the comment on the PR and the issue say so): only a draft "holds progress".
  if (input.escalated && !input.continues) {
    warnings.push("> [!WARNING]", `> ${m.escalatedDraft(input.escalated, issue.number)}`, "");
  }
  if (input.sensitivePaths.length > 0) {
    warnings.push("> [!WARNING]", `> ${m.sensitiveFiles(input.sensitivePaths)}`, "");
  }
  if (input.harnessPaths.length > 0) {
    warnings.push("> [!CAUTION]", `> ${m.harnessFiles(input.harnessPaths)}`, "");
  }
  if (input.skeletonFiles.length > 0) warnings.push("> [!WARNING]", `> ${m.skeletonFiles(input.skeletonFiles)}`, "");
  const middle = withEvidence(input.text || m.minimalBody(), input.images, input.appendable);
  const verdicts = verdictsSection(input.criteria, language);
  return [...warnings, middle, ...(verdicts.length > 0 ? ["", ...verdicts] : []), "", `Closes #${issue.number}`].join("\n");
}

/** The review of every attempt, inline comments filtered to the diff, tokens and cost in the footer. */
async function submitReview(ctx: CommandContext, pr: number, result: FactoryResult, lines: DiffLines): Promise<void> {
  await ctx.codeHost.submitReview(pr, {
    event: "COMMENT",
    body: `${result.review.summary || messages(ctx.config.language).noFindings()}\n\n---\n${costFooter(result, ctx.config.pricing, ctx.config.language)}`,
    comments: filterToDiff(result.review.inline, lines),
  });
}

/** Why a run that is not ready escalates. */
function escalationReason(result: FactoryResult): EscalationReason {
  return result.reason ?? "infra";
}

/**
 * A run that stopped at the agent's usage limit: no Escalation, no Retro. The commits are pushed (never an
 * update-branch round's: its next round would find the branch up to date and skip Verify), the issue gets
 * `sessionLimit` before anything else (the guard refuses it while it waits) and the marked comment `resume` reads.
 * An issue run goes back to `ready-for-agent`; a round on a pull request keeps the lock and leaves a note on the PR.
 */
async function pause(ctx: CommandContext, issue: Issue, result: FactoryResult, options: PublishOptions): Promise<PublishResult> {
  const { tracker, codeHost, config } = ctx;
  const m = messages(config.language);
  const failure = result.session!;
  const limit = failure.limit!;
  let pushed = false;
  if (result.head !== null && result.flow !== "update-branch") {
    const push = await codeHost.push({ branch: result.branch, sha: result.head, expectedSha: options.startSha });
    if (!push.ok) return discard(ctx, issue.number, (m) => m.branchMoved(result.branch), false, options);
    pushed = true;
  }
  const flow = options.pr === null ? "issue" : result.flow === "issue" ? "pr-feedback" : result.flow;
  const wait: Wait = { flow, resumeAt: limit.resumeAt, head: flow === "issue" && pushed ? result.head : null, pr: options.pr };
  const next =
    flow === "issue"
      ? m.sessionLimitIssue(pushed ? result.branch : null, config.baseBranch)
      : flow === "update-branch"
        ? m.sessionLimitUpdate(options.pr!, config.baseBranch)
        : m.sessionLimitRound(options.pr!, pushed);
  await tracker.addLabel(issue.number, config.labels.sessionLimit);
  const armed = await armResumeSweep(ctx, options.armResume);
  await tracker.comment(issue.number, sessionLimitComment({ wait, failure, next, runUrl: options.runUrl, armed }, config));
  if (options.pr === null) await tracker.swapLabel(issue.number, config.labels.inProgress, config.labels.readyForAgent);
  else await codeHost.commentPr(options.pr, m.roundPaused(issue.number, utcMinute(limit.resumeAt)));
  ctx.log(`#${issue.number} paused at the agent's usage limit (resets ${limit.resetsAt ?? "at an unknown time"}); it starts again after ${limit.resumeAt}.`);
  return { issue: issue.number, outcome: "paused", reason: "session-limit", resetsAt: limit.resetsAt, resumeAt: limit.resumeAt };
}

/**
 * The agent's answers, posted in their threads. A thread that is gone, or that is not open any more, gets nothing.
 * The Conversation requests get one comment for the whole round, each request quoted above its answer.
 */
async function postReplies(ctx: CommandContext, pr: number, threadReplies: FactoryResult["threadReplies"]): Promise<void> {
  if (threadReplies.length === 0) return;
  const m = messages(ctx.config.language);
  const known = await ctx.codeHost.threads(pr);
  for (const reply of threadReplies) {
    const thread = known.find((t) => t.id === reply.threadId);
    if (thread) await ctx.codeHost.replyToThread(pr, thread.id, `${m.decision(reply.decision)}: ${reply.body}`);
  }
  const answers = (await ctx.codeHost.conversation(pr)).flatMap((request) => {
    const reply = threadReplies.find((r) => r.threadId === request.id);
    if (!reply) return [];
    const quote = request.body.trim().split("\n").map((line) => `> ${line}`.trimEnd());
    return [[m.quoted(request.author, request.kind === "review"), ...quote, "", `${m.decision(reply.decision)}: ${reply.body}`].join("\n")];
  });
  if (answers.length > 0) await ctx.codeHost.commentPr(pr, answers.join("\n\n---\n\n"));
}

/** Escalation: the report on the issue, then in-progress → ready-for-human. */
async function escalate(
  ctx: CommandContext,
  issue: Issue,
  report: Omit<Parameters<typeof escalationComment>[0], "round">,
  /** The PR this run continues: the report cites it, it gets a short note too, and stays as it is (never turned back into a draft). */
  continuing: PullRequest | null = null,
  dispatchRetro?: PublishOptions["dispatchRetro"],
): Promise<PublishResult> {
  const { tracker, config } = ctx;
  await tracker.comment(issue.number, escalationComment({ ...report, round: continuing }, config));
  await tracker.swapLabel(issue.number, config.labels.inProgress, config.labels.readyForHuman);
  if (continuing !== null) {
    await ctx.codeHost.commentPr(continuing.number, messages(config.language).roundEscalated(report.reason, issue.number, config.labels.readyForHuman));
  }
  const pr = report.pr ?? continuing;
  await startRetro(ctx, issue.number, pr?.number ?? null, dispatchRetro);
  return { issue: issue.number, outcome: "escalated", reason: report.reason, pr: pr?.number ?? null, url: pr?.url ?? null };
}

/**
 * Every Escalation gets an automatic Retro (`factory-retro.yml`), unless `FACTORY_RETRO_ENABLED=false`. It must never
 * fail the Escalation: where it cannot be started (local mode, a refused dispatch), the run says so and goes on.
 */
async function startRetro(ctx: CommandContext, issue: number, pr: number | null, dispatchRetro?: PublishOptions["dispatchRetro"]): Promise<void> {
  if (!ctx.config.retro.enabled) return;
  const inputs = { issue: String(issue), pr: pr === null ? "" : String(pr) };
  try {
    await (dispatchRetro ? dispatchRetro(inputs) : ctx.codeHost.dispatch("retro", inputs));
  } catch (error) {
    ctx.log(`The automatic Retro of #${issue} did not start: ${(error as Error).message}`);
  }
}

/** The prints of the run, in the order `work` listed them, at their place in the downloaded artifacts. */
function evidenceImages(result: FactoryResult, dir: string): EvidenceImage[] {
  return result.evidence.map(({ product, name }) => ({ product, name, path: join(dir, EVIDENCE_DIR, product, name) }));
}
