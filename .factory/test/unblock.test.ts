import { describe, expect, it } from "vitest";
import { HUMAN, ISSUE_BODY, SPEC_BODY, lastJson, world } from "./helpers.ts";

const ready = { "ready-for-agent": HUMAN };

describe("factory unblock", () => {
  it("dispatches the ready issues whose blockers are all done, and only those", async () => {
    const w = world({
      issues: [
        { number: 1, body: SPEC_BODY },
        { number: 2, title: "Done blocker", state: "closed", done: true, parent: 1 },
        { number: 3, title: "Open blocker", parent: 1 },
        { number: 10, body: ISSUE_BODY, parent: 1, labels: ready, blockedBy: [2] },
        { number: 11, body: ISSUE_BODY, parent: 1, labels: ready, blockedBy: [2, 3] },
        { number: 12, body: ISSUE_BODY, parent: 1, labels: ready },
        { number: 13, body: ISSUE_BODY, parent: 1, labels: { "in-progress": HUMAN }, blockedBy: [2] },
      ],
    });

    expect(await w.factory("unblock")).toBe(0);

    expect(w.codeHost.dispatches).toEqual([
      { workflow: "issue", inputs: { issue: "10" } },
      { workflow: "issue", inputs: { issue: "12" } },
    ]);
    expect(lastJson(w.logs)).toMatchObject({ dispatched: [10, 12], waiting: [11] });
  });

  it("says nothing on the issues that are still blocked", async () => {
    const w = world({
      issues: [
        { number: 1, body: SPEC_BODY },
        { number: 3, parent: 1 },
        { number: 11, body: ISSUE_BODY, parent: 1, labels: ready, blockedBy: [3] },
      ],
    });

    await w.factory("unblock");

    expect(w.tracker.commentsOn(11)).toEqual([]);
    expect(w.tracker.labelsOf(11)).toEqual(["ready-for-agent"]);
    expect(w.codeHost.dispatches).toEqual([]);
  });

  it("does not dispatch an issue the guard would refuse for another reason", async () => {
    const w = world({
      issues: [
        { number: 1, body: SPEC_BODY },
        { number: 10, body: "no criteria here", parent: 1, labels: ready },
        { number: 11, body: ISSUE_BODY, parent: 1, labels: { "ready-for-agent": "mallory" } },
      ],
    });

    await w.factory("unblock");

    expect(w.codeHost.dispatches).toEqual([]);
  });

  it("keeps going when one dispatch fails, and exits non-zero", async () => {
    const w = world({
      issues: [
        { number: 1, body: SPEC_BODY },
        { number: 10, body: ISSUE_BODY, parent: 1, labels: ready },
        { number: 12, body: ISSUE_BODY, parent: 1, labels: ready },
      ],
    });
    const dispatch = w.codeHost.dispatch.bind(w.codeHost);
    w.codeHost.dispatch = async (workflow, inputs) => {
      if (inputs.issue === "10") throw new Error("boom");
      await dispatch(workflow, inputs);
    };

    expect(await w.factory("unblock")).toBe(1);

    expect(w.codeHost.dispatches.map((d) => d.inputs.issue)).toEqual(["12"]);
    expect(lastJson(w.logs)).toMatchObject({ dispatched: [12], failed: [10] });
  });
});
