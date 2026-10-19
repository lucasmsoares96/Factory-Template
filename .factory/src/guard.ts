import type { FactoryConfig } from "./config.ts";
import type { Issue, Tracker } from "./seams/tracker.ts";

export type Refusal =
  | "not-open"
  | "not-ready"
  | "label-actor-cannot-write"
  | "missing-acceptance-criteria"
  | "missing-seams"
  | "blocked";

export type GuardDecision = { ok: true; issue: Issue } | { ok: false; reason: Refusal; issue: Issue };

export const TRIAGE_MARKER = "<!-- factory:triage -->";

const heading = (title: string) => new RegExp(`^##\\s+${title}\\s*$`, "im");

/** Deterministic check that the Factory may start work on an issue, read from current Tracker state. */
export async function guard(tracker: Tracker, config: FactoryConfig, number: number): Promise<GuardDecision> {
  const issue = await tracker.issue(number);
  const refuse = (reason: Refusal): GuardDecision => ({ ok: false, reason, issue });

  if (issue.state !== "open") return refuse("not-open");
  if (!issue.labels.includes(config.labels.readyForAgent)) return refuse("not-ready");
  const actor = await tracker.labelActor(number, config.labels.readyForAgent);
  if (actor === null || !(await tracker.canWrite(actor))) return refuse("label-actor-cannot-write");
  if (!heading("Acceptance criteria").test(issue.body)) return refuse("missing-acceptance-criteria");
  if (!hasSeams(issue, config)) return refuse("missing-seams");
  const blockers = await tracker.blockers(number);
  if (blockers.some((b) => !b.done)) return refuse("blocked");
  return { ok: true, issue };
}

/** Seams come from the parent's Testing Decisions or from the machine user's Triage comment. */
function hasSeams(issue: Issue, config: FactoryConfig): boolean {
  if (issue.parent && heading("Testing Decisions").test(issue.parent.body)) return true;
  return issue.comments.some(
    (c) => config.machineUser !== "" && c.author === config.machineUser && c.body.includes(TRIAGE_MARKER),
  );
}
