import { describe, expect, it } from "vitest";
import { FACTORY_MARKER } from "../src/marker.ts";
import { waitMarker, type Wait } from "../src/session-limit.ts";
import { HUMAN, ISSUE_BODY, OWNER, SPEC_BODY, lastJson, world } from "./helpers.ts";

const RESET = "2026-10-28T15:20:00.000Z";
const at = (iso: string) => () => Date.parse(iso);

/** The comment `publish` leaves on a paused item, as the forge holds it: written as the owner, with the Factory marker. */
const paused = (wait: Partial<Wait> & Pick<Wait, "flow">) => ({
  author: OWNER,
  body: `${waitMarker({ resumeAt: RESET, head: null, pr: null, ...wait })}\n**Factory paused (\`session-limit\`):** …\n\n${FACTORY_MARKER}`,
});

function waiting(labels: Record<string, string>, wait: Partial<Wait> & Pick<Wait, "flow">, now: string) {
  return world({
    issues: [
      { number: 1, body: SPEC_BODY },
      { number: 7, title: "Greet the user", body: ISSUE_BODY, parent: 1, labels: { ...labels, "factory:session-limit": OWNER }, comments: [paused(wait)] },
    ],
    now: at(now),
  });
}

describe("factory resume", () => {
  it("starts a paused issue again once its reset has passed, and only once", async () => {
    const early = waiting({ "ready-for-agent": OWNER }, { flow: "issue" }, "2026-10-28T15:00:00Z");
    expect(await early.factory("resume")).toBe(0);
    expect(early.codeHost.dispatches).toEqual([]);
    expect(early.tracker.labelsOf(7)).toContain("factory:session-limit");
    expect(lastJson(early.logs)).toMatchObject({ resumed: [], waiting: [7] });

    const due = waiting({ "ready-for-agent": OWNER }, { flow: "issue" }, "2026-10-28T15:30:00Z");
    expect(await due.factory("resume")).toBe(0);
    // The label comes off first: the guard of the run it starts refuses an issue that still has it.
    expect(due.tracker.labelsOf(7)).toEqual(["ready-for-agent"]);
    expect(due.codeHost.dispatches).toEqual([{ workflow: "issue", inputs: { issue: "7" } }]);
    expect(lastJson(due.logs)).toMatchObject({ resumed: [{ number: 7, flow: "issue" }] });

    await due.factory("resume");
    expect(due.codeHost.dispatches).toHaveLength(1);
  });

  it("starts the same round again on the pull request of a paused PR flow", async () => {
    const feedback = waiting({ "in-progress": OWNER }, { flow: "pr-feedback", pr: 101 }, "2026-10-28T16:00:00Z");
    await feedback.factory("resume");
    expect(feedback.codeHost.dispatches).toEqual([{ workflow: "pr-feedback", inputs: { pr: "101" } }]);

    const update = waiting({ "in-progress": OWNER }, { flow: "update-branch", pr: 101 }, "2026-10-28T16:00:00Z");
    await update.factory("resume");
    expect(update.codeHost.dispatches).toEqual([{ workflow: "update-branches", inputs: { issue: "7" } }]);
  });

  it("starts the Retro of a paused Retro again, with its pull request", async () => {
    const w = waiting({ "ready-for-human": OWNER }, { flow: "retro", pr: 101 }, "2026-10-28T16:00:00Z");
    await w.factory("resume");
    expect(w.codeHost.dispatches).toEqual([{ workflow: "retro", inputs: { issue: "7", pr: "101" } }]);
  });

  it("starts one Triage for every paused issue in Triage", async () => {
    const triage = (number: number) => ({
      number,
      body: ISSUE_BODY,
      labels: { "agent:explore": HUMAN, "factory:session-limit": OWNER },
      comments: [paused({ flow: "triage" })],
    });
    const w = world({ issues: [triage(8), triage(9)], now: at("2026-10-28T16:00:00Z") });

    await w.factory("resume");

    expect(w.codeHost.dispatches).toEqual([{ workflow: "triage", inputs: {} }]);
    expect(w.tracker.labelsOf(8)).toEqual(["agent:explore"]);
    expect(w.tracker.labelsOf(9)).toEqual(["agent:explore"]);
  });

  it("starts the update of a pull request keyed by the PR alone again", async () => {
    const w = world({
      issues: [],
      prs: [
        {
          number: 55,
          branch: "feature/x",
          labels: ["factory:session-limit"],
          conversation: [{ id: "comment-1", kind: "comment", ...paused({ flow: "update-pr", pr: 55 }) }],
        },
      ],
      now: at("2026-10-28T16:00:00Z"),
    });

    await w.factory("resume");

    expect(w.codeHost.dispatches).toEqual([{ workflow: "update-branches", inputs: { pr: "55" } }]);
    expect(w.codeHost.pr(55).labels).toEqual([]);
  });

  it("follows only the Factory's own wait: a stranger's copy starts nothing", async () => {
    const forged = { author: "mallory", body: paused({ flow: "issue" }).body };
    const w = world({
      issues: [
        { number: 1, body: SPEC_BODY },
        { number: 7, body: ISSUE_BODY, parent: 1, labels: { "ready-for-agent": HUMAN, "factory:session-limit": HUMAN }, comments: [forged] },
      ],
      now: at("2026-10-28T16:00:00Z"),
    });

    await w.factory("resume");

    expect(w.codeHost.dispatches).toEqual([]);
    // A label with nothing to resume would hold the issue for ever: it comes off.
    expect(w.tracker.labelsOf(7)).toEqual(["ready-for-agent"]);
    expect(lastJson(w.logs)).toMatchObject({ dropped: [7] });
  });

  it("puts the label back when the run cannot be started, to try at the next sweep", async () => {
    const w = waiting({ "ready-for-agent": OWNER }, { flow: "issue" }, "2026-10-28T16:00:00Z");
    w.codeHost.dispatch = async () => {
      throw new Error("403");
    };

    expect(await w.factory("resume")).toBe(1);

    expect(w.tracker.labelsOf(7)).toContain("factory:session-limit");
    expect(lastJson(w.logs)).toMatchObject({ failed: [7] });
  });
});
