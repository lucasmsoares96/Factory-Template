import { issueBranch, type FactoryConfig } from "./config.ts";
import type { CodeHost } from "./seams/code-host.ts";
import type { Issue, Tracker } from "./seams/tracker.ts";

export type Refusal =
  | "not-open"
  | "not-ready"
  | "label-actor-cannot-write"
  | "parent-spec"
  | "open-pr"
  | "missing-acceptance-criteria"
  | "missing-seams"
  | "blocked";

export type GuardDecision =
  | { ok: true; issue: Issue }
  | { ok: false; reason: Exclude<Refusal, "blocked">; issue: Issue }
  | { ok: false; reason: "blocked"; issue: Issue; waitingOn: number[] };

export const TRIAGE_MARKER = "<!-- factory:triage -->";

const heading = (title: string) => new RegExp(`^##\\s+${title}\\s*$`, "im");

/**
 * Deterministic check that the Factory may start work on an issue, read from
 * current forge state. An open draft pull request on the issue branch is the
 * draft of an Escalation: the retry replaces it, so it does not refuse.
 */
export async function guard(
  seams: { tracker: Tracker; codeHost: CodeHost },
  config: FactoryConfig,
  number: number,
): Promise<GuardDecision> {
  const { tracker, codeHost } = seams;
  const issue = await tracker.issue(number);
  const refuse = (reason: Exclude<Refusal, "blocked">): GuardDecision => ({ ok: false, reason, issue });

  if (issue.state !== "open") return refuse("not-open");
  if (!issue.labels.includes(config.labels.readyForAgent)) return refuse("not-ready");
  const actor = await tracker.labelActor(number, config.labels.readyForAgent);
  if (actor === null || !(await tracker.canWrite(actor))) return refuse("label-actor-cannot-write");
  if (issue.children.length > 0) return refuse("parent-spec");
  const pr = await codeHost.openPrFor(issueBranch(config, number));
  if (pr && !pr.draft) return refuse("open-pr");
  if (!heading("Acceptance criteria").test(issue.body)) return refuse("missing-acceptance-criteria");
  if (!hasSeams(issue, config)) return refuse("missing-seams");
  const waitingOn = (await tracker.blockers(number)).filter((b) => !b.done).map((b) => b.number);
  if (waitingOn.length > 0) return { ok: false, reason: "blocked", issue, waitingOn };
  return { ok: true, issue };
}

/** Seams come from the parent's Testing Decisions or from the machine user's Triage comment. */
function hasSeams(issue: Issue, config: FactoryConfig): boolean {
  if (issue.parent && heading("Testing Decisions").test(issue.parent.body)) return true;
  return issue.comments.some((c) => isFactoryComment(c, config, TRIAGE_MARKER));
}

/** A comment the machine user wrote carrying `marker`. */
export function isFactoryComment(comment: { author: string; body: string }, config: FactoryConfig, marker: string): boolean {
  return config.machineUser !== "" && comment.author === config.machineUser && comment.body.includes(marker);
}
