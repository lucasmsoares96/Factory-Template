import { join } from "node:path";
import { issueBranch } from "../config.ts";
import { diffLines, filterToDiff, type DiffLines } from "../diff.ts";
import { Git } from "../git.ts";
import { isHarnessPath, isSensitivePath } from "../paths.ts";
import { attemptLine, costFooter, escalationComment, fence, followUpComment, lastFailure, waitingComment, type EscalationReason, type FollowUpRef } from "../report.ts";
import { BUNDLE_FILE, EVIDENCE_DIR, RESULT_FILE, readResult, type FactoryResult } from "../result.ts";
import { gapsSection, SKELETON_PATH, skeletonCommit } from "../scope.ts";
import { fromTouchedSpecs, isSpecPath, shownIn, withEvidence, type TouchedSpec } from "../pull-request-evidence.ts";
import type { EvidenceImage, PullRequest } from "../seams/code-host.ts";
import type { Issue } from "../seams/tracker.ts";
import { WAITING_MARKER } from "./claim.ts";
import type { CommandContext } from "./context.ts";

export type PublishResult =
  | { issue: number; outcome: "ready"; pr: number; url: string }
  | { issue: number; outcome: "escalated"; reason: EscalationReason; pr: number | null; url: string | null }
  | { issue: number; outcome: "discarded"; reason: string }
  | { issue: number; outcome: "waiting"; blockedBy: number[] };

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
   * Puts `factory:working` on the pull request this run opens, with the job token: a label written with the forge
   * token would start `pull_request_target: labeled` workflows. Best effort; the run's last step takes it off.
   */
  markWorking?: (pr: number) => Promise<void>;
  /**
   * Dispatches the automatic Retro of an Escalation with the job token (`actions: write`): the forge token may not
   * dispatch workflows. Without it, the run's code host dispatches.
   */
  dispatchRetro?: (inputs: { issue: string; pr: string }) => Promise<void>;
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

  const state = await recheck(ctx, number, branch, options);
  if (!state.ok) return discard(ctx, number, state.reason);
  const { issue, openPr } = state;

  let result: FactoryResult;
  try {
    result = await loadArtifacts(git, number, branch, options.in);
  } catch (error) {
    return escalate(ctx, issue, { reason: "infra", result: null, detail: (error as Error).message, pr: null, runUrl: options.runUrl }, options.pr, options.dispatchRetro);
  }
  // Built before anything is written: a patch that cannot be the Skeleton pull request stops the run.
  let skeletonSha: string | null;
  try {
    skeletonSha = await skeletonChange(git, issue, result, options.in);
  } catch (error) {
    return escalate(ctx, issue, { reason: "infra", result, detail: (error as Error).message, pr: null, runUrl: options.runUrl }, options.pr, options.dispatchRetro);
  }
  if (result.outcome === "waiting" && options.pr === null) return waitOnSkeleton(ctx, issue, await openFollowUps(ctx, issue, result, skeletonSha));

  const head = result.head;
  const changed = head ? await changedFiles(git, result.base, head) : [];
  if (!head) {
    const followUps = await openFollowUps(ctx, issue, result, skeletonSha);
    return escalate(ctx, issue, { reason: escalationReason(result), result, pr: null, runUrl: options.runUrl, followUps }, options.pr, options.dispatchRetro);
  }

  const push = await ctx.codeHost.push({ branch, sha: head, expectedSha: options.startSha });
  if (!push.ok) return discard(ctx, number, `branch ${branch} moved since the run started`);

  const followUps = await openFollowUps(ctx, issue, result, skeletonSha);
  const lines = await diffLines(git, result.base, head);
  const sensitivePaths = changed.filter(isSensitivePath);
  const harnessPaths = changed.filter((path) => isHarnessPath(path) && !isSensitivePath(path));
  const escalated = result.outcome === "ready" ? null : escalationReason(result);
  const pr = await pullRequest(ctx, issue, { branch, openPr, continues: options.pr !== null, sensitivePaths, harnessPaths, escalated, followUps, text: result.pullRequestBody, images: evidenceImages(result, options.in), appendable: fromTouchedSpecs(await touchedSpecs(git, head, changed)), markWorking: options.markWorking });
  if (!escalated || result.review.summary !== "") {
    // A PR round without a Review (update-branch, a round that only answers) leaves no empty review behind.
    if (options.pr === null || result.review.summary !== "") await submitReview(ctx, pr.number, result, lines);
  }
  if (options.pr !== null) await postReplies(ctx, pr.number, result.threadReplies);

  if (escalated) return escalate(ctx, issue, { reason: escalated, result, pr, runUrl: options.runUrl, followUps }, options.pr, options.dispatchRetro);
  if (followUps.length > 0) await ctx.tracker.comment(number, followUpComment(followUps));
  if (pr.draft) await ctx.codeHost.markReady(pr.number);
  return { issue: number, outcome: "ready", pr: pr.number, url: pr.url };
}

export type PrUpdateResult =
  | { pr: number; outcome: "updated"; url: string }
  | { pr: number; outcome: "up-to-date" | "stopped" | "discarded"; reason: string };

/**
 * `publish` of an update keyed by the pull request alone (`publish --pr N` without an issue): it never runs as an
 * issue flow. It changes no label, opens no PR and comments only on this one: what was merged, or why it stopped.
 * The push leases against the head of the claim; a run that did not pass Verify pushes nothing.
 */
export async function publishPrUpdate(ctx: CommandContext, number: number, options: Omit<PublishOptions, "pr">): Promise<PrUpdateResult> {
  const { codeHost, config } = ctx;
  const git = new Git(options.repo);
  const stop = async (outcome: "stopped" | "discarded", reason: string, comment: string): Promise<PrUpdateResult> => {
    await codeHost.commentPr(number, comment);
    return { pr: number, outcome, reason };
  };
  const pr = await codeHost.pullRequest(number);
  if (!pr || pr.state !== "open" || pr.fork) return { pr: number, outcome: "discarded", reason: `pull request #${number} is no longer open on this repository` };
  const moved = `branch ${pr.branch} moved since the run started`;
  const discarded = () => stop("discarded", moved, `Run discarded: ${moved}. Nothing was pushed.`);
  if ((await codeHost.branchHead(pr.branch)) !== options.startSha) return discarded();

  let result: FactoryResult;
  try {
    result = await loadArtifacts(git, number, pr.branch, options.in);
  } catch (error) {
    const detail = (error as Error).message;
    return stop("stopped", "infra", `The Factory could not update this branch with \`${config.baseBranch}\`: the work job left no valid result (${detail}). Nothing was pushed.${runLine(options.runUrl)}`);
  }
  if (result.outcome === "escalated") {
    return stop("stopped", result.reason ?? "infra", prUpdateStopped(result, config.baseBranch, options.runUrl));
  }
  if (result.head === null || result.head === options.startSha) return { pr: number, outcome: "up-to-date", reason: `already contains ${config.baseBranch}` };

  const push = await codeHost.push({ branch: pr.branch, sha: result.head, expectedSha: options.startSha });
  if (!push.ok) return discarded();
  const fixes = result.attempts.length > 1 ? ` The merge broke \`verify\`; the Factory fixed it on this branch:\n\n${result.attempts.map((a) => `- ${attemptLine(a)}`).join("\n")}` : " `verify` passed.";
  await codeHost.commentPr(number, `Merged \`${config.baseBranch}\` (\`${result.base.slice(0, 7)}\`) into this branch and pushed \`${result.head.slice(0, 7)}\`.${fixes}${runLine(options.runUrl)}`);
  return { pr: number, outcome: "updated", url: pr.url };
}

/** Why the update of a person's PR stopped, with the attempts: the branch is left as it was. */
function prUpdateStopped(result: FactoryResult, base: string, runUrl: string | null): string {
  const lines = [`The Factory could not update this branch with \`${base}\` (\`${result.reason ?? "infra"}\`), so it pushed nothing and stopped.`];
  if (result.question) lines.push("", result.question);
  if (result.attempts.length > 0) {
    lines.push("", "**Attempts**", ...result.attempts.map((a) => `- ${attemptLine(a)}`));
    const failure = lastFailure(result);
    if (failure?.output) lines.push("", `**Last output**${failure.failedCommand ? ` (\`${failure.failedCommand}\`)` : ""}, truncated:`, fence(failure.output, "text"));
  }
  return lines.join("\n") + runLine(runUrl);
}

function runLine(runUrl: string | null): string {
  return runUrl ? `\n\n**Workflow run:** ${runUrl}` : "";
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
  input: { branch: string; openPr: PullRequest | null; continues: boolean; sensitivePaths: string[]; harnessPaths: string[]; escalated: EscalationReason | null; followUps: FollowUpRef[]; text: string | null; images: EvidenceImage[]; appendable: (image: EvidenceImage) => boolean; markWorking?: PublishOptions["markWorking"] },
): Promise<PullRequest> {
  const { codeHost, config } = ctx;
  let pr: PullRequest;
  if (input.continues && input.openPr) {
    pr = input.openPr;
    // The run may have changed the PR: its body is written again.
    if (input.text !== null) {
      const body = prBody(issue, input);
      await codeHost.updatePrBody(pr.number, body, shownIn(body, input.images));
    }
  } else {
    if (input.openPr) {
      await codeHost.closePr(
        input.openPr.number,
        `Superseded by a new Factory run for #${issue.number}, which starts over from \`${config.baseBranch}\`.`,
      );
    }
    const body = prBody(issue, input);
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
 * The body in three parts (the print references swapped by `withEvidence`): the warnings and the follow-up note (deterministic),
 * the Pull Request Stage text (or the minimal sentence), `Closes #N`. The agent
 * never writes the first and last parts; a closing keyword in its text is dropped.
 */
function prBody(
  issue: Issue,
  input: { continues: boolean; sensitivePaths: string[]; harnessPaths: string[]; escalated: EscalationReason | null; followUps: FollowUpRef[]; text: string | null; images: EvidenceImage[]; appendable: (image: EvidenceImage) => boolean },
): string {
  const warnings: string[] = [];
  // A round on a ready PR leaves it as it is (the comment on the PR and the issue say so): only a draft "holds progress".
  if (input.escalated && !input.continues) {
    warnings.push(
      "> [!WARNING]",
      `> The Factory escalated this work (\`${input.escalated}\`): this draft holds its progress. See the comment on #${issue.number}.`,
      "",
    );
  }
  if (input.sensitivePaths.length > 0) {
    warnings.push(
      "> [!WARNING]",
      `> This pull request changes sensitive files: ${input.sensitivePaths.map((p) => `\`${p}\``).join(", ")}. A workflow runs with the repository's secrets, and skills, \`.claude/\` and \`.mcp.json\` steer every agent: read them line by line before merging.`,
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
  const text = input.text ? withoutAttribution(withoutClosingKeywords(input.text)) : "Implemented by the Factory.";
  const middle = withEvidence(text, input.images, input.appendable);
  return [...warnings, middle, "", `Closes #${issue.number}`].join("\n");
}

/** The `pr` skill's template ends with a tool attribution line; the Factory's body is the harness's, not the tool's. */
function withoutAttribution(text: string): string {
  return text.replace(/^[ \t]*(?:🤖[ \t]*)?Generated with \[?Claude Code\]?.*$\n?|^[ \t]*Co-Authored-By:.*$\n?/gim, "").trim();
}

const REF = String.raw`(?:[\w.-]+\/[\w.-]+)?#\d+`;
const CLOSING = new RegExp(String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+${REF}(?:[ \t]*(?:,|\band\b)[ \t]*${REF})*`, "gi");

/**
 * `Closes #9` written by the agent would close the wrong issue: only `publish` writes it. A line that is only a closing
 * reference goes; one inside a sentence becomes a placeholder so the rest still reads.
 */
function withoutClosingKeywords(text: string): string {
  const alone = new RegExp(String.raw`^[ \t>*-]*${CLOSING.source}\.?[ \t]*$\n?`, "gim");
  return text.replace(alone, "").replace(CLOSING, "[closing reference removed]").trim();
}

/** The review of every attempt, inline comments filtered to the diff, tokens and cost in the footer. */
async function submitReview(ctx: CommandContext, pr: number, result: FactoryResult, lines: DiffLines): Promise<void> {
  await ctx.codeHost.submitReview(pr, {
    event: "COMMENT",
    body: `${result.review.summary || "No findings."}\n\n---\n${costFooter(result, ctx.config.pricing)}`,
    comments: filterToDiff(result.review.inline, lines),
  });
}

/** Why a run that is not ready escalates. `waiting` only comes from an issue run; anywhere else it is a needs-human Escalation. */
function escalationReason(result: FactoryResult): EscalationReason {
  return result.reason ?? (result.outcome === "waiting" ? "needs-human" : "infra");
}

/** The commit of the reverted Skeleton change on the base, or null when the run reverted none. Throws on a bad patch. */
async function skeletonChange(git: Git, issue: Issue, result: FactoryResult, dir: string): Promise<string | null> {
  const patch = result.followUps.find((f) => f.patch !== null)?.patch;
  if (!patch) return null;
  return skeletonCommit(git, result.base, join(dir, patch), `feat: grow the Skeleton for Product issue #${issue.number}`);
}

/**
 * Opens the Skeleton tickets the run asked for, linked to the issue. One with the reverted change (`skeletonSha`) is
 * `ready-for-human` and gets the pull request that makes it; a gap alone waits for triage.
 */
async function openFollowUps(ctx: CommandContext, issue: Issue, result: FactoryResult, skeletonSha: string | null): Promise<FollowUpRef[]> {
  const { labels } = ctx.config;
  const refs: FollowUpRef[] = [];
  for (const followUp of result.followUps) {
    const withChange = skeletonSha !== null && followUp.patch !== null;
    const created = await ctx.tracker.createIssue({
      title: followUp.title,
      body: followUp.body,
      labels: [withChange ? labels.readyForHuman : labels.needsTriage],
      relatedTo: issue.number,
    });
    const pr = withChange ? await skeletonPullRequest(ctx, issue, followUp, created.number, skeletonSha) : null;
    refs.push({ number: created.number, title: followUp.title, pr });
  }
  return refs;
}

/**
 * The Skeleton pull request: `sha` (the base plus the reverted change, nothing else) on a new branch, opened ready for
 * review, closing the Skeleton issue. A branch that already exists is never overwritten: the issue stays without one.
 */
async function skeletonPullRequest(
  ctx: CommandContext,
  issue: Issue,
  followUp: FactoryResult["followUps"][number],
  skeletonIssue: number,
  sha: string,
): Promise<{ number: number; url: string } | null> {
  const { codeHost, config } = ctx;
  const branch = issueBranch(config, skeletonIssue);
  const push = await codeHost.push({ branch, sha, expectedSha: null });
  if (!push.ok) {
    ctx.log(`The Skeleton pull request for #${skeletonIssue} was not opened: branch ${branch} already exists.`);
    return null;
  }
  const body = [
    `Product issue #${issue.number} (${issue.title}) needs this change in \`${SKELETON_PATH}\`. A Product issue never changes the Skeleton, so the Factory took it out of that run and opened it here, from \`${config.baseBranch}\`, as the run wrote it. Review it as a change to the Skeleton.`,
    ...gapsSection(followUp.gaps),
    "",
    "## Files",
    "",
    ...followUp.files.map((f) => `- \`${f}\``),
    "",
    `Closes #${skeletonIssue}`,
  ].join("\n");
  const pr = await codeHost.openDraftPr({ branch, base: config.baseBranch, title: followUp.title, body });
  await codeHost.markReady(pr.number);
  return { number: pr.number, url: pr.url };
}

/**
 * A Product issue that cannot finish without its Skeleton issues: blocked by them and back in `ready-for-agent`, with no
 * Escalation and no Product pull request. The blockers go first, so the run the label starts finds it blocked; when
 * they close, `factory-unblock.yml` queues it again and the new run starts from the base that has the new Skeleton.
 */
async function waitOnSkeleton(ctx: CommandContext, issue: Issue, followUps: FollowUpRef[]): Promise<PublishResult> {
  const { tracker, config } = ctx;
  for (const followUp of followUps) await tracker.addBlocker(issue.number, followUp.number);
  await tracker.comment(issue.number, waitingComment(followUps, config, WAITING_MARKER));
  await tracker.swapLabel(issue.number, config.labels.inProgress, config.labels.readyForAgent);
  return { issue: issue.number, outcome: "waiting", blockedBy: followUps.map((f) => f.number) };
}

const DECISION_LABEL = { address: "Address", decline: "Decline", defer: "Defer", answer: "Answer" } as const;

/**
 * The agent's answers, posted in their threads. A thread that is gone, or that is not open any more, gets nothing.
 * The Conversation requests get one comment for the whole round, each request quoted above its answer.
 */
async function postReplies(ctx: CommandContext, pr: number, threadReplies: FactoryResult["threadReplies"]): Promise<void> {
  if (threadReplies.length === 0) return;
  const known = new Set((await ctx.codeHost.threads(pr)).map((t) => t.id));
  for (const reply of threadReplies) {
    if (known.has(reply.threadId)) await ctx.codeHost.replyToThread(pr, reply.threadId, `${DECISION_LABEL[reply.decision]}: ${reply.body}`);
  }
  const answers = (await ctx.codeHost.conversation(pr)).flatMap((request) => {
    const reply = threadReplies.find((r) => r.threadId === request.id);
    if (!reply) return [];
    const quote = request.body.trim().split("\n").map((line) => `> ${line}`.trimEnd());
    return [[`**${request.author}** ${request.kind === "review" ? "reviewed" : "wrote"}:`, ...quote, "", `${DECISION_LABEL[reply.decision]}: ${reply.body}`].join("\n")];
  });
  if (answers.length > 0) await ctx.codeHost.commentPr(pr, answers.join("\n\n---\n\n"));
}

/** Escalation: the report on the issue, then in-progress → ready-for-human. */
async function escalate(
  ctx: CommandContext,
  issue: Issue,
  report: Parameters<typeof escalationComment>[0],
  /** The PR this run continues: it gets a short note too, and stays as it is (never turned back into a draft). */
  continuing: number | null = null,
  dispatchRetro?: PublishOptions["dispatchRetro"],
): Promise<PublishResult> {
  const { tracker, config } = ctx;
  await tracker.comment(issue.number, escalationComment(report, config));
  await tracker.swapLabel(issue.number, config.labels.inProgress, config.labels.readyForHuman);
  if (continuing !== null) {
    await ctx.codeHost.commentPr(
      continuing,
      `The Factory could not finish this round (\`${report.reason}\`). Issue #${issue.number} is now \`${config.labels.readyForHuman}\`: the comment there has the attempts. This pull request stays as it is.`,
    );
  }
  await startRetro(ctx, issue.number, report.pr?.number ?? continuing, dispatchRetro);
  return { issue: issue.number, outcome: "escalated", reason: report.reason, pr: report.pr?.number ?? null, url: report.pr?.url ?? null };
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
