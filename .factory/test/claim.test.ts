import { describe, expect, it } from "vitest";
import { HUMAN, MACHINE_USER, lastJson, readyIssue, world } from "./helpers.ts";

describe("factory claim", () => {
  it("takes the lock: ready-for-agent becomes in-progress", async () => {
    const w = world();

    expect(await w.factory("claim", "7")).toBe(0);

    expect(w.tracker.labelsOf(7)).toEqual(["in-progress"]);
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

  it("accepts seams from a Triage comment written by the machine user", async () => {
    const w = world({
      issues: [
        {
          number: 7,
          body: "## Acceptance criteria\n\n- [ ] works\n",
          labels: { "ready-for-agent": HUMAN },
          comments: [{ author: MACHINE_USER, body: "<!-- factory:triage -->\nSeams: CLI." }],
        },
      ],
    });

    await w.factory("claim", "7");

    expect(lastJson(w.logs)).toMatchObject({ claimed: true });
  });

  it("uses label names overridden by repo variables", async () => {
    const w = world({ env: { FACTORY_LABELS_IN_PROGRESS: "doing" } });

    await w.factory("claim", "7");

    expect(w.tracker.labelsOf(7)).toEqual(["doing"]);
  });

  const refusals: [string, Parameters<typeof readyIssue>[0], string][] = [
    ["a closed issue", { state: "closed" }, "not-open"],
    ["an issue without ready-for-agent", { labels: { "needs-triage": HUMAN } }, "not-ready"],
    ["a label applied by someone without write", { labels: { "ready-for-agent": "mallory" } }, "label-actor-cannot-write"],
    ["an issue without acceptance criteria", { body: "## What to build\n\nThings.\n" }, "missing-acceptance-criteria"],
    ["an issue without seams", { parent: null }, "missing-seams"],
    ["a Blocked Issue", { blockedBy: [3] }, "blocked"],
  ];

  it.each(refusals)("refuses %s without taking the lock", async (_name, overrides, reason) => {
    const issues = readyIssue(overrides);
    issues.push({ number: 3, title: "Blocker", done: false });
    const w = world({ issues });
    const labelsBefore = w.tracker.labelsOf(7);

    expect(await w.factory("claim", "7")).toBe(0);

    expect(w.tracker.labelsOf(7)).toEqual(labelsBefore);
    expect(lastJson(w.logs)).toEqual({ claimed: false, issue: 7, reason });
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
