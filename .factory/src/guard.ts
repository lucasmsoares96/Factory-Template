import { issueBranch, type FactoryConfig } from "./config.ts";
import type { CodeHost } from "./seams/code-host.ts";
import { isMarked } from "./marker.ts";
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
  if (!(await hasSeams(issue, config, tracker))) return refuse("missing-seams");
  const waitingOn = (await tracker.blockers(number)).filter((b) => !b.done).map((b) => b.number);
  if (waitingOn.length > 0) return { ok: false, reason: "blocked", issue, waitingOn };
  return { ok: true, issue };
}

/** Seams come from the parent's Testing Decisions or from the Factory's Triage comment. */
async function hasSeams(issue: Issue, config: FactoryConfig, tracker: Tracker): Promise<boolean> {
  if (issue.parent && heading("Testing Decisions").test(issue.parent.body)) return true;
  return anyFactoryComment(tracker, issue.comments, TRIAGE_MARKER);
}

/**
 * A comment of the Factory carrying `marker`: it has the Factory marker and a topic marker, and its author has `write`+.
 * The Factory writes as the owner, so the author alone proves nothing; the `write` check is what keeps a stranger's
 * forged marker out (a writer could apply the labels by hand anyway, so forging it gives no new power).
 */
export async function isFactoryComment(tracker: Tracker, comment: { author: string; body: string }, marker: string): Promise<boolean> {
  return isMarked(comment.body) && comment.body.includes(marker) && (await tracker.canWrite(comment.author));
}

async function anyFactoryComment(tracker: Tracker, comments: { author: string; body: string }[], marker: string): Promise<boolean> {
  for (const comment of comments) if (await isFactoryComment(tracker, comment, marker)) return true;
  return false;
}
