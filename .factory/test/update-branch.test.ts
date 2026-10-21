import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { git, lastJson, MACHINE_USER } from "./helpers.ts";
import { BRANCH, PR, finishRound, prCheckout, prWorld, reviewOk, commits, type MainChange } from "./pr-flow-helpers.ts";

/** Resolves the conflict on `src/app.ts` keeping both lines' values, and commits the merge. */
const resolve: AgentStep = async ({ cwd }) => {
  const resolved = (await git(cwd, "show", "HEAD:src/app.ts")).replace(/line5 = \d+;/, "line5 = 555;") + "\n";
  await writeFile(join(cwd, "src/app.ts"), resolved);
  await git(cwd, "add", "src/app.ts");
  await git(cwd, "commit", "--quiet", "--no-edit");
};

async function updateRound(main: MainChange, options: Pick<Parameters<typeof prWorld>[0], "agent" | "verify"> = {}, beforePublish?: () => void) {
  const p = await prWorld({ main, ...options });
  expect(await p.w.factory("update-branch", "7")).toBe(0);
  const claim = lastJson(p.w.logs) as { claimed: boolean; startSha: string };
  expect(claim.claimed).toBe(true);
  await finishRound(p, ["--flow", "update-branch"], claim.startSha, beforePublish);
  return p;
}

describe("factory update-branch --scan", () => {
  it("dispatches update-branch only for the Factory PRs that now conflict with main", async () => {
    const p = await prWorld({ main: "conflict" });
    // #8 sits on an old main commit (merges cleanly); #9 is in-progress but has no PR.
    const clean = await prCheckout("conflict");
    await git(clean, "checkout", "--quiet", "-b", "factory/issue-8", "main~1");
    const cleanSha = await git(clean, "rev-parse", "HEAD");
    p.w.tracker.add({ number: 8, labels: { "in-progress": MACHINE_USER } });
    p.w.tracker.add({ number: 9, labels: { "in-progress": MACHINE_USER } });
    p.w.codeHost.branches.set("factory/issue-8", cleanSha);
    p.w.codeHost.add({ number: 108, branch: "factory/issue-8", headSha: cleanSha });

    expect(await p.w.factory("update-branch", "--scan", "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.dispatches).toEqual([{ workflow: "factory-update-branches.yml", inputs: { issue: "7" } }]);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [7], clean: [8] });
  });
});

describe("factory update-branch", () => {
  it("merges main with no agent when it merges cleanly, then Verify, and leaves the PR body alone", async () => {
    const p = await updateRound("clean", { verify: [{ ok: true }] });

    expect(p.w.agent.calls).toEqual([]);
    expect(p.w.verify.runs).toBe(1);
    const pushed = p.w.codeHost.branches.get(BRANCH)!;
    expect((await git(p.publishRepo, "rev-list", "--parents", "-n", "1", pushed)).split(" ")).toHaveLength(3);
    expect(p.w.codeHost.pr(PR).body).toBe("Original body\n\nCloses #7");
    expect(p.w.codeHost.pr(PR).reviews).toEqual([]);
    expect(p.w.codeHost.pr(PR).draft).toBe(false);
    expect(p.w.tracker.labelsOf(7)).toEqual(["in-progress"]);
  });

  it("has the agent resolve a conflict, preserving both intents, then runs Verify", async () => {
    const p = await updateRound("conflict", { agent: { development: [resolve] }, verify: [{ ok: true }] });

    expect(p.w.agent.calls.map((c) => c.stage)).toEqual(["development"]);
    const prompt = p.w.agent.calls[0]!.prompt;
    expect(prompt).toContain("Preserve both intents, do not invent new behaviour");
    expect(prompt).toContain("`src/app.ts`");
    expect(p.w.verify.runs).toBe(1);
    const pushed = p.w.codeHost.branches.get(BRANCH)!;
    expect(await git(p.publishRepo, "show", `${pushed}:src/app.ts`)).toContain("line5 = 555;");
    expect(p.w.codeHost.pr(PR).body).toBe("Original body\n\nCloses #7");
  });

  it("falls back to the normal loop when Verify fails after the merge", async () => {
    const p = await updateRound("clean", {
      agent: { development: [commits()], review: [reviewOk] },
      verify: [{ ok: false, failedCommand: "pnpm test", output: "merge broke it" }, { ok: true }],
    });

    expect(p.w.agent.calls.map((c) => c.stage)).toEqual(["development", "review"]);
    expect(p.w.agent.calls[0]!.prompt).toContain("merge broke it");
    expect(p.w.verify.runs).toBe(2);
    expect(p.w.tracker.labelsOf(7)).toEqual(["in-progress"]);
  });

  it("escalates when the agent leaves the merge unresolved", async () => {
    const p = await updateRound("conflict", { agent: { development: [() => ({ output: "gave up" })] } });

    expect(p.w.verify.runs).toBe(0);
    expect(p.w.tracker.labelsOf(7)).toEqual(["ready-for-human"]);
    expect(p.w.codeHost.pr(PR).comments).toHaveLength(1);
  });

  it("discards the run when the branch moved since the claim", async () => {
    const q = await prWorld({ main: "clean", verify: [{ ok: true }] });
    await q.w.factory("update-branch", "7");
    const claim = lastJson(q.w.logs) as { startSha: string };
    await finishRound(q, ["--flow", "update-branch"], claim.startSha, () => void q.w.codeHost.branches.set(BRANCH, "f".repeat(40)));

    expect(q.w.codeHost.pushes).toEqual([]);
    expect(q.w.tracker.issues.get(7)!.comments.at(-1)!.body).toContain("Run discarded");
  });

  it("refuses an issue that is not in-progress or has no open PR", async () => {
    const p = await prWorld({ main: "clean" });
    p.w.codeHost.pr(PR).state = "closed";
    await p.w.factory("update-branch", "7");
    expect(lastJson(p.w.logs)).toEqual({ claimed: false, reason: "no-open-pr" });
  });
});
