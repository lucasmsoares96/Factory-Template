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

  describe("--issue <N> (the issue that closed)", () => {
    const world2 = (state: "open" | "closed") =>
      world({
        issues: [
          { number: 1, body: SPEC_BODY },
          { number: 12, body: ISSUE_BODY, parent: 1, state, labels: { "in-progress": HUMAN, "product:example": HUMAN } },
          { number: 13, body: ISSUE_BODY, parent: 1, labels: ready },
        ],
      });

    it("removes in-progress from a closed issue, keeps its other labels, then sweeps", async () => {
      const w = world2("closed");

      expect(await w.factory("unblock", "--issue", "12")).toBe(0);

      expect(w.tracker.labelsOf(12)).toEqual(["product:example"]);
      expect(w.codeHost.dispatches).toEqual([{ workflow: "issue", inputs: { issue: "13" } }]);
      expect(lastJson(w.logs)).toMatchObject({ released: [12], dispatched: [13] });
    });

    it("never touches an issue that is still open, whatever the event said", async () => {
      const w = world2("open");

      await w.factory("unblock", "--issue", "12");

      expect(w.tracker.labelsOf(12)).toContain("in-progress");
      expect(lastJson(w.logs)).toMatchObject({ released: [] });
    });

    it("is a no-op for a closed issue without the label", async () => {
      const w = world2("closed");
      await w.tracker.removeLabel(12, "in-progress");

      await w.factory("unblock", "--issue", "12");

      expect(lastJson(w.logs)).toMatchObject({ released: [] });
    });
  });
});
