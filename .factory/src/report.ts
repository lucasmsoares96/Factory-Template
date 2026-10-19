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
  const input = usage.development.inputTokens + usage.review.inputTokens;
  const output = usage.development.outputTokens + usage.review.outputTokens;
  const cost = (input * pricing.inputPerMTok + output * pricing.outputPerMTok) / 1_000_000;
  return `Tokens: ${count(input)} in / ${count(output)} out. Estimated cost: $${cost.toFixed(2)}.`;
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
    "",
    usageLine(result.usage, config.pricing),
    "",
  ].join("\n");
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

export type EscalationReason = NonNullable<FactoryResult["reason"]> | "protected-paths";

export const ESCALATION_MARKER = "<!-- factory:escalation -->";
const PATCH_LIMIT = 50_000;

export interface EscalationReport {
  reason: EscalationReason;
  /** Null when the work job left no valid result (infra). */
  result: FactoryResult | null;
  /** Why the result could not be read, for infra. */
  detail?: string;
  protectedPaths?: string[];
  patch?: string;
  pr: { number: number; url: string } | null;
  runUrl: string | null;
}

/** The comment an Escalation leaves on the issue. */
export function escalationComment(report: EscalationReport, config: FactoryConfig): string {
  const { result } = report;
  const lines = [ESCALATION_MARKER, `**Factory escalation (\`${report.reason}\`):** ${headline(report, config)}`];
  if (result?.question) lines.push("", `**Question:** ${result.question}`);
  if (report.detail) lines.push("", fence(report.detail, "text"));
  if (report.protectedPaths?.length) {
    lines.push("", `**Protected paths:** ${report.protectedPaths.map((p) => `\`${p}\``).join(", ")}`);
    if (report.patch !== undefined) {
      const patch = report.patch.length > PATCH_LIMIT ? `${report.patch.slice(0, PATCH_LIMIT)}\n… (patch truncated)` : report.patch;
      lines.push("", "<details><summary>Patch</summary>", "", fence(patch, "diff"), "", "</details>");
    }
  }
  if (result && result.attempts.length > 0) {
    lines.push("", "**Attempts**", ...result.attempts.map((a) => `- ${attemptLine(a)}`));
    const failure = lastFailure(result);
    if (failure?.output) {
      const label = failure.failedCommand ? ` (\`${failure.failedCommand}\`)` : "";
      lines.push("", `**Last output**${label}, truncated:`, fence(failure.output, "text"));
    }
  }
  lines.push("");
  if (report.pr) lines.push(`**Pull request:** #${report.pr.number} (draft)`);
  else if (report.reason === "protected-paths") lines.push("**Pull request:** none, because the diff touches protected paths.");
  else lines.push("**Pull request:** No pull request: the run made no commits.");
  if (report.runUrl) lines.push(`**Workflow run:** ${report.runUrl}`);
  lines.push(
    "",
    `To try again, re-add the \`${config.labels.readyForAgent}\` label: the Factory closes the draft pull request and starts over from \`${config.baseBranch}\`.`,
  );
  if (result) lines.push("", usageLine(result.usage, config.pricing));
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
    case "protected-paths":
      return "The diff touches protected paths, so the Factory opened no pull request.";
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
