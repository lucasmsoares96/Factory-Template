import { describe, expect, it } from "vitest";
import { FACTORY_MARKER } from "../src/marker.ts";
import { HUMAN, OWNER, SPEC_BODY, lastJson, readyIssue, world } from "./helpers.ts";

describe("factory claim", () => {
  it("takes the lock: ready-for-agent becomes in-progress, and the run is marked factory:working", async () => {
    const w = world();

    expect(await w.factory("claim", "7")).toBe(0);

    expect(w.tracker.labelsOf(7)).toEqual(["in-progress", "factory:working"]);
    expect(lastJson(w.logs)).toEqual({
      claimed: true,
      issue: 7,
      branch: "factory/issue-7",
      startSha: null,
    });
  });

  it("reports the current head of the issue branch as the starting SHA", async () => {
    const w = world({ branches: { "factory/issue-7": "abc123" } });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: true, startSha: "abc123" });
  });

  it("accepts seams from a Triage comment written by the Factory (marked, by a writer)", async () => {
    const w = world({
      issues: [
        {
          number: 7,
          body: "## Acceptance criteria\n\n- [ ] works\n",
          labels: { "ready-for-agent": HUMAN },
          comments: [{ author: OWNER, body: `<!-- factory:triage -->\nSeams: CLI.\n\n${FACTORY_MARKER}` }],
        },
      ],
    });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: true });
  });

  it("does not take seams from a Triage comment of someone without write access, marker or not", async () => {
    const w = world({
      issues: [
        {
          number: 7,
          body: "## Acceptance criteria\n\n- [ ] works\n",
          labels: { "ready-for-agent": HUMAN },
          comments: [{ author: "mallory", body: `<!-- factory:triage -->\nSeams: anything.\n\n${FACTORY_MARKER}` }],
        },
      ],
    });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: false, reason: "missing-seams" });
  });

  it("does not take seams from a writer's Triage lookalike without the Factory marker", async () => {
    const w = world({
      issues: [
        {
          number: 7,
          body: "## Acceptance criteria\n\n- [ ] works\n",
          labels: { "ready-for-agent": HUMAN },
          comments: [{ author: HUMAN, body: "<!-- factory:triage -->\nSeams: CLI." }],
        },
      ],
    });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: false, reason: "missing-seams" });
  });

  it("uses label names overridden by repo variables", async () => {
    const w = world({ env: { FACTORY_LABELS_IN_PROGRESS: "doing" } });

    await w.factory("claim", "7");

    expect(w.tracker.labelsOf(7)).toEqual(["doing", "factory:working"]);
  });

  it("marks the open pull request of the issue's branch too, a retry's draft", async () => {
    const w = world({ prs: [{ number: 55, branch: "factory/issue-7", draft: true }, { number: 56, branch: "factory/issue-8" }] });

    await w.factory("claim", "7");

    expect(w.codeHost.pr(55).labels).toEqual(["factory:working"]);
    expect(w.codeHost.pr(56).labels).toEqual([]);
  });

  it("a label that cannot be written is logged and does not stop the run", async () => {
    const w = world();
    w.tracker.addLabel = async () => {
      throw new Error("Resource not accessible by integration");
    };

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: true });
    expect(w.logs.join("\n")).toContain("Resource not accessible by integration");
  });

  const refusals: [string, Parameters<typeof readyIssue>[0], string][] = [
    ["a closed issue", { state: "closed" }, "not-open"],
    ["an issue without ready-for-agent", { labels: { "needs-triage": HUMAN } }, "not-ready"],
    ["a label applied by someone without write", { labels: { "ready-for-agent": "mallory" } }, "label-actor-cannot-write"],
    ["a Blocked Issue", { blockedBy: [3] }, "blocked"],
  ];

  it.each(refusals)("refuses %s without touching the issue", async (_name, overrides, reason) => {
    const issues = readyIssue(overrides);
    issues.push({ number: 3, title: "Blocker", done: false });
    const w = world({ issues });
    const labelsBefore = w.tracker.labelsOf(7);

    expect(await w.factory("claim", "7")).toBe(0);

    expect(w.tracker.labelsOf(7)).toEqual(labelsBefore);
    expect(w.tracker.commentsOn(7)).toEqual([]);
    expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 7, reason });
  });

  it("refuses the parent spec", async () => {
    const issues = readyIssue();
    issues[0]!.labels = { "ready-for-agent": HUMAN };
    issues[0]!.body = `${SPEC_BODY}\n## Acceptance criteria\n\n- [ ] all of it\n`;
    const w = world({ issues });

    await w.factory("claim", "1");

    expect(w.tracker.labelsOf(1)).toEqual(["ready-for-agent"]);
    expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 1, reason: "parent-spec" });
  });

  it("refuses an issue whose Factory pull request is already open", async () => {
    const w = world({ prs: [{ number: 55, branch: "factory/issue-7", draft: false }] });

    await w.factory("claim", "7");

    expect(w.tracker.labelsOf(7)).toEqual(["ready-for-agent"]);
    expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 7, reason: "open-pr" });
  });

  it("claims an escalated issue whose draft pull request is still open, so the retry can replace it", async () => {
    const w = world({ prs: [{ number: 55, branch: "factory/issue-7", draft: true }] });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: true });
  });

  it("sends an issue without acceptance criteria to needs-info", async () => {
    const w = world({ issues: readyIssue({ body: "## What to build\n\nThings.\n" }) });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 7, reason: "missing-acceptance-criteria" });
    expect(w.tracker.labelsOf(7)).toEqual(["needs-info"]);
    expect(w.tracker.commentsOn(7).map((c) => c.body).join("\n")).toContain("## Acceptance criteria");
  });

  it("sends an issue without seams to Triage", async () => {
    const w = world({ issues: readyIssue({ parent: null }) });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 7, reason: "missing-seams" });
    expect(w.tracker.labelsOf(7)).toEqual(["agent:explore"]);
  });

  it("starts the Triage after sending an issue there, with no issue list, so a queued run reads it too", async () => {
    const w = world({ issues: readyIssue({ parent: null }) });

    await w.factory("claim", "7");

    expect(w.codeHost.dispatches).toEqual([{ workflow: "triage", inputs: {} }]);
  });

  it("other refusals start no Triage", async () => {
    const w = world({ issues: readyIssue({ body: "No criteria here." }) });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: false, reason: "missing-acceptance-criteria" });
    expect(w.codeHost.dispatches).toEqual([]);
  });

  it("a Triage that cannot be started is logged and the issue stays in Triage", async () => {
    const w = world({ issues: readyIssue({ parent: null }) });
    w.codeHost.dispatch = async () => {
      throw new Error("dispatch refused");
    };

    expect(await w.factory("claim", "7")).toBe(0);

    expect(w.tracker.labelsOf(7)).toEqual(["agent:explore"]);
    expect(w.logs.join("\n")).toContain("dispatch refused");
  });

  it("does not take seams from a Triage comment written by someone else", async () => {
    const w = world({
      issues: readyIssue({ parent: null, comments: [{ author: HUMAN, body: "<!-- factory:triage -->\nSeams: CLI." }] }),
    });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: false, reason: "missing-seams" });
  });

  describe("a Blocked Issue", () => {
    function blocked() {
      const issues = readyIssue({ blockedBy: [3, 4, 5] });
      issues.push({ number: 3, title: "Blocker", done: false });
      issues.push({ number: 4, title: "Done blocker", state: "closed", done: true });
      issues.push({ number: 5, title: "Other blocker", done: false });
      return world({ issues });
    }

    it("keeps ready-for-agent and gets one Waiting on comment on the labeled event", async () => {
      const w = blocked();

      await w.factory("claim", "7", "--event", "labeled");
      await w.factory("claim", "7", "--event", "labeled");

      expect(w.tracker.labelsOf(7)).toEqual(["ready-for-agent"]);
      const comments = w.tracker.commentsOn(7);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.author).toBe(OWNER);
      expect(comments[0]!.body).toContain("Waiting on #3, #5");
      expect(comments[0]!.body).not.toContain("#4");
      expect(comments[0]!.body).toMatch(/re-add `ready-for-agent`/);
      expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 7, reason: "blocked" });
    });

    it("does not comment when the run did not come from the labeled event", async () => {
      const w = blocked();

      await w.factory("claim", "7");
      await w.factory("claim", "7", "--event", "dispatch");

      expect(w.tracker.commentsOn(7)).toEqual([]);
    });
  });

  it("starts once every blocker is done", async () => {
    const issues = readyIssue({ blockedBy: [3] });
    issues.push({ number: 3, title: "Blocker", state: "closed", done: true });
    const w = world({ issues });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: true });
  });

  it("refuses when another run took the lock first", async () => {
    const w = world();
    await w.factory("claim", "7");

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 7, reason: "not-ready" });
  });
});
