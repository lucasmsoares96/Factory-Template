import type { FactoryConfig } from "./config.ts";
import type { FactoryResult, StageRecord } from "./result.ts";
import type { Usage } from "./seams/agent.ts";

/**
 * Human-readable reports of a run: the job summary, the attempt lines of an
 * Escalation and the token/cost footer of the review and the Escalation.
 */

const STAGE: Record<StageRecord["stage"], string> = { development: "Development", review: "Review", e2e: "E2E" };

export function stageOutcome(stage: StageRecord): string {
  switch (stage.outcome) {
    case "failed":
      return `failed: \`${stage.failedCommand ?? "factory:verify"}\``;
    case "no-commits":
      return "no commits";
    case "needs-human":
      return "needs a human";
    default:
      return stage.outcome;
  }
}

/** `Attempt 2: Development ok (1 commit) → Review ok → E2E failed: \`cmd\`` */
export function attemptLine(attempt: FactoryResult["attempts"][number]): string {
  const stages = attempt.stages.map((s) => {
    const commits = s.stage === "development" && s.commits ? ` (${s.commits} ${s.commits === 1 ? "commit" : "commits"})` : "";
    return `${STAGE[s.stage]} ${stageOutcome(s)}${commits}`;
  });
  return `Attempt ${attempt.number}: ${stages.join(" → ")}`;
}

/** The last failed Stage that has output, for the "truncated output" of an Escalation. */
export function lastFailure(result: FactoryResult): StageRecord | null {
  const stages = result.attempts.flatMap((a) => a.stages);
  return stages.findLast((s) => s.output !== undefined && s.output !== "") ?? null;
}

/** `Tokens: 30,000 in / 3,000 out. Estimated cost: $0.18.` */
export function usageLine(usage: FactoryResult["usage"], pricing: FactoryConfig["pricing"]): string {
  const stages = [usage.development, usage.review, usage.pullRequest];
  const input = stages.reduce((sum, u) => sum + u.inputTokens, 0);
  const output = stages.reduce((sum, u) => sum + u.outputTokens, 0);
  const cost = (input * pricing.inputPerMTok + output * pricing.outputPerMTok) / 1_000_000;
  return `Tokens: ${count(input)} in / ${count(output)} out. Estimated cost: $${cost.toFixed(2)}.`;
}

/**
 * The usage line, plus why the Pull Request Stage left the PR with the
 * minimal body when it did not write one.
 */
export function costFooter(result: FactoryResult, pricing: FactoryConfig["pricing"]): string {
  const stage = result.pullRequestStage;
  const note = stage && stage.outcome !== "ok" ? ` The Pull Request Stage ${stage.outcome === "skipped" ? "did not run" : stage.outcome === "timeout" ? "timed out" : "failed"}: ${stage.reason ?? "no reason recorded"}; the pull request has the minimal body.` : "";
  return usageLine(result.usage, pricing) + note;
}

/** Job summary: one row per attempt and Stage, then the token/cost line. */
export function summaryMarkdown(result: FactoryResult, config: FactoryConfig): string {
  const verdict = result.outcome === "ready" ? "ready" : `escalated (${result.reason})`;
  const rows = result.attempts.flatMap((a) =>
    a.stages.map((s) =>
      [a.number, STAGE[s.stage], stageOutcome(s), duration(s.durationMs), s.commits ?? "", s.usage ? tokens(s.usage) : ""].join(" | "),
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
    costFooter(result, config.pricing),
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
}

/** Tells the issue (and the PR) that the Skeleton change it needs was split into other tickets. */
export function followUpComment(followUps: FollowUpRef[]): string {
  return [
    "**The Skeleton must grow.** A Product issue never changes `packages/skeleton/`, so the Factory removed that change from this work and opened:",
    ...followUps.map((f) => `- #${f.number} ${f.title}`),
  ].join("\n");
}

/** The comment an Escalation leaves on the issue. */
export function escalationComment(report: EscalationReport, config: FactoryConfig): string {
  const { result } = report;
  const lines = [ESCALATION_MARKER, `**Factory escalation (\`${report.reason}\`):** ${headline(report, config)}`];
  if (result?.question) lines.push("", `**Question:** ${result.question}`);
  if (report.followUps?.length) lines.push("", followUpComment(report.followUps));
  if (report.detail) lines.push("", fence(report.detail, "text"));
  if (result && result.attempts.length > 0) {
    lines.push("", "**Attempts**", ...result.attempts.map((a) => `- ${attemptLine(a)}`));
    if (result.pullRequestStage) lines.push(`- Pull Request Stage (not an attempt): ${pullRequestOutcome(result.pullRequestStage)}`);
    const failure = lastFailure(result);
    if (failure?.output) {
      const label = failure.failedCommand ? ` (\`${failure.failedCommand}\`)` : "";
      lines.push("", `**Last output**${label}, truncated:`, fence(failure.output, "text"));
    }
  }
  lines.push("");
  if (report.pr) lines.push(`**Pull request:** #${report.pr.number} (draft)`);
  else lines.push("**Pull request:** No pull request: the run made no commits.");
  if (report.runUrl) lines.push(`**Workflow run:** ${report.runUrl}`);
  lines.push(
    "",
    `To try again, re-add the \`${config.labels.readyForAgent}\` label: the Factory closes the draft pull request and starts over from \`${config.baseBranch}\`.`,
  );
  if (result) lines.push("", costFooter(result, config.pricing));
  return lines.join("\n");
}

function headline(report: EscalationReport, config: FactoryConfig): string {
  switch (report.reason) {
    case "e2e-failures":
      return attemptsHeadline(report.result);
    case "time":
      return `The run hit the global time limit of ${config.timeouts.total} min.`;
    case "needs-human":
      return "Development needs a human decision.";
    case "infra":
      return "The work job left no valid result (infrastructure failure).";
  }
}

/**
 * Every attempt that does not reach a passing E2E counts toward the limit
 * (Stage timeouts and the "made commits" gate included), so the headline names
 * where the last attempt stopped instead of always blaming E2E.
 */
function attemptsHeadline(result: FactoryResult | null): string {
  const count = result?.attempts.length ?? 0;
  const last = result?.attempts.at(-1)?.stages.at(-1);
  if (!last || last.stage === "e2e") return `E2E did not pass in ${count} attempts.`;
  const what = last.outcome === "no-commits" ? "made no commits" : `ended with ${last.outcome}`;
  return `The attempt limit was reached after ${count} attempts without a passing E2E; the last one stopped at ${last.stage === "development" ? "Development" : "Review"}, which ${what}.`;
}

/** A fenced code block that the content cannot close. */
export function fence(content: string, lang: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${content}\n${ticks}`;
}
