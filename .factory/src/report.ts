import type { FactoryConfig } from "./config.ts";
import type { FactoryResult, StageRecord } from "./result.ts";
import { messages, type Language } from "./messages.ts";
import type { Usage } from "./seams/agent.ts";

/**
 * Human-readable reports of a run: the job summary, the attempt lines of an
 * Escalation and the token/cost footer of the review and the Escalation.
 */

const STAGE: Record<StageRecord["stage"], string> = { development: "Development", review: "Review", e2e: "E2E" };

export function stageOutcome(stage: StageRecord, language: Language): string {
  const m = messages(language);
  switch (stage.outcome) {
    case "failed":
      return m.outcomeFailed(stage.failedCommand ?? "factory:verify");
    case "no-commits":
      return m.outcomeNoCommits();
    case "needs-human":
      return m.outcomeNeedsHuman();
    default:
      return stage.outcome;
  }
}

/** `Attempt 2: Development ok (1 commit) → Review ok → E2E failed: \`cmd\`` */
export function attemptLine(attempt: FactoryResult["attempts"][number], language: Language): string {
  const m = messages(language);
  const stages = attempt.stages.map((s) => {
    const commits = s.stage === "development" && s.commits ? ` (${m.commits(s.commits)})` : "";
    return `${STAGE[s.stage]} ${stageOutcome(s, language)}${commits}`;
  });
  return m.attemptLine(attempt.number, stages.join(" → "));
}

/** The last failed Stage that has output, for the "truncated output" of an Escalation. */
export function lastFailure(result: FactoryResult): StageRecord | null {
  const stages = result.attempts.flatMap((a) => a.stages);
  return stages.findLast((s) => s.output !== undefined && s.output !== "") ?? null;
}

/** `Tokens: 30,000 in / 3,000 out. Estimated cost: $0.18.` */
export function usageLine(usage: FactoryResult["usage"], pricing: FactoryConfig["pricing"], language: Language): string {
  const stages = [usage.development, usage.review, usage.pullRequest];
  const input = stages.reduce((sum, u) => sum + u.inputTokens, 0);
  const output = stages.reduce((sum, u) => sum + u.outputTokens, 0);
  return tokensLine(input, output, pricing, language);
}

/** The usage line of any session: `Tokens: 200,000 in / 10,000 out. Estimated cost: $1.00.` */
export function tokensLine(input: number, output: number, pricing: FactoryConfig["pricing"], language: Language): string {
  const cost = (input * pricing.inputPerMTok + output * pricing.outputPerMTok) / 1_000_000;
  return messages(language).usage(count(input), count(output), cost.toFixed(2));
}

/**
 * The usage line, plus why the Pull Request Stage left the PR with the
 * minimal body when it did not write one.
 */
export function costFooter(result: FactoryResult, pricing: FactoryConfig["pricing"], language: Language): string {
  const m = messages(language);
  const stage = result.pullRequestStage;
  const note = stage && stage.outcome !== "ok" ? m.pullRequestStageNote(stage.outcome, stage.reason ?? m.noReason()) : "";
  return usageLine(result.usage, pricing, language) + note;
}

/** Job summary: one row per attempt and Stage, then the token/cost line. It is the run's page, not public text: always English. */
export function summaryMarkdown(result: FactoryResult, config: FactoryConfig): string {
  const verdict = result.outcome === "escalated" ? `escalated (${result.reason})` : result.outcome === "waiting" ? "waiting on the Skeleton" : "ready";
  const rows = result.attempts.flatMap((a) =>
    a.stages.map((s) =>
      [a.number, STAGE[s.stage], stageOutcome(s, "en"), duration(s.durationMs), s.commits ?? "", s.usage ? tokens(s.usage) : ""].join(" | "),
    ),
  );
  return [
    `### Factory #${result.issue}: ${verdict}`,
    "",
    "| Attempt | Stage | Outcome | Duration | Commits | Tokens (in / out) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r} |`),
    ...(result.pullRequestStage ? [`| – | Pull Request | ${pullRequestOutcome(result.pullRequestStage)} | ${duration(result.pullRequestStage.durationMs)} | | ${tokens(result.pullRequestStage.usage)} |`] : []),
    "",
    costFooter(result, config.pricing, "en"),
    "",
  ].join("\n");
}

function pullRequestOutcome(stage: NonNullable<FactoryResult["pullRequestStage"]>): string {
  return stage.reason ? `${stage.outcome}: ${stage.reason}` : stage.outcome;
}

function tokens(usage: Usage): string {
  return `${count(usage.inputTokens)} / ${count(usage.outputTokens)}`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export type EscalationReason = NonNullable<FactoryResult["reason"]>;

export const ESCALATION_MARKER = "<!-- factory:escalation -->";

export interface EscalationReport {
  reason: EscalationReason;
  /** Null when the work job left no valid result (infra). */
  result: FactoryResult | null;
  /** Why the result could not be read, for infra. */
  detail?: string;
  pr: { number: number; url: string } | null;
  runUrl: string | null;
  /** Skeleton tickets opened for this run. */
  followUps?: FollowUpRef[];
}

export interface FollowUpRef {
  number: number;
  title: string;
  /** The pull request that makes the Skeleton change; null when there was no file to put in one. */
  pr: { number: number; url: string } | null;
}

/** Tells the issue (and the PR) that the Skeleton change it needs was split into other tickets and pull requests. */
export function followUpComment(followUps: FollowUpRef[], language: Language): string {
  const m = messages(language);
  return [m.followUpIntro(), ...followUps.map((f) => m.followUpItem(f.number, f.title, f.pr?.number ?? null))].join("\n");
}

/**
 * The one comment of a Product issue that waits on its Skeleton issues: it is back in the queue, blocked by them.
 * `marker` is the guard's "Waiting on" marker, so the run the label starts does not say it again.
 */
export function waitingComment(followUps: FollowUpRef[], config: FactoryConfig, marker: string): string {
  const blockers = followUps.map((f) => `#${f.number}`).join(", ");
  return [
    marker,
    followUpComment(followUps, config.language),
    "",
    messages(config.language).waitingOnSkeleton(blockers, config.labels.readyForAgent, config.baseBranch, followUps.length === 1),
  ].join("\n");
}

/** The comment an Escalation leaves on the issue. */
export function escalationComment(report: EscalationReport, config: FactoryConfig): string {
  const { result } = report;
  const { language } = config;
  const m = messages(language);
  const lines = [ESCALATION_MARKER, m.escalationTitle(report.reason, headline(report, config))];
  if (result?.question) lines.push("", m.question(result.question));
  if (report.followUps?.length) lines.push("", followUpComment(report.followUps, language));
  if (report.detail) lines.push("", fence(report.detail, "text"));
  if (result && result.attempts.length > 0) {
    lines.push("", m.attempts(), ...result.attempts.map((a) => `- ${attemptLine(a, language)}`));
    if (result.pullRequestStage) lines.push(m.pullRequestStageLine(pullRequestOutcome(result.pullRequestStage)));
    const failure = lastFailure(result);
    if (failure?.output) lines.push("", m.lastOutput(failure.failedCommand ?? null), fence(failure.output, "text"));
  }
  lines.push("");
  if (report.pr) lines.push(m.draftPullRequest(report.pr.number));
  else lines.push(m.noPullRequest());
  if (report.runUrl) lines.push(m.workflowRun(report.runUrl));
  lines.push("", m.retry(config.labels.readyForAgent, config.baseBranch));
  if (result) lines.push("", costFooter(result, config.pricing, language));
  return lines.join("\n");
}

function headline(report: EscalationReport, config: FactoryConfig): string {
  const m = messages(config.language);
  switch (report.reason) {
    case "e2e-failures":
      return attemptsHeadline(report.result, config.language);
    case "time":
      return m.headlineTime(config.timeouts.total);
    case "needs-human":
      return m.headlineNeedsHuman();
    case "infra":
      return m.headlineInfra();
  }
}

/**
 * Every attempt that does not reach a passing E2E counts toward the limit
 * (Stage timeouts and the "made commits" gate included), so the headline names
 * where the last attempt stopped instead of always blaming E2E.
 */
function attemptsHeadline(result: FactoryResult | null, language: Language): string {
  const m = messages(language);
  const count = result?.attempts.length ?? 0;
  const last = result?.attempts.at(-1)?.stages.at(-1);
  if (!last || last.stage === "e2e") return m.headlineE2e(count);
  return m.headlineAttempts(count, STAGE[last.stage], last.outcome === "no-commits", last.outcome === "timeout" ? m.outcomeTimeout() : last.outcome);
}

/** A fenced code block that the content cannot close. */
export function fence(content: string, lang: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${content}\n${ticks}`;
}
