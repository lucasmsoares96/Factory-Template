import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { FORK_UPDATE_TAG } from "../src/commands/pr-claim.ts";
import { marked } from "../src/marker.ts";
import { commitFile, git, lastJson, OWNER, unmarked } from "./helpers.ts";
import { BRANCH, PR, finishRound, prWorld, reviewOk, commits, type MainChange, type PrWorld } from "./pr-flow-helpers.ts";

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
  it("dispatches for every PR behind main, Factory and human, clean and conflicting, and for none that is up to date", async () => {
    const p = await prWorld({ main: "conflict" });
    // #108: a Factory PR in progress that merges cleanly but is behind; #202: a person's PR, behind;
    // #203: a person's PR cut from the newest main; #109: the Factory PR of an issue no longer in progress.
    p.w.tracker.add({ number: 8, labels: { "in-progress": OWNER } });
    p.w.tracker.add({ number: 9, labels: { "ready-for-human": OWNER } });
    await pullRequestOn(p, 108, "factory/issue-8", "main~1");
    await pullRequestOn(p, 109, "factory/issue-9", "main~1");
    await pullRequestOn(p, 202, "feature/thing", "main~1", { draft: true });
    await pullRequestOn(p, 203, "feature/fresh", "main");

    expect(await p.w.factory("update-branch", "--scan", "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.dispatches).toEqual([
      { workflow: "factory-update-branches.yml", inputs: { issue: "7" } },
      { workflow: "factory-update-branches.yml", inputs: { issue: "8" } },
      { workflow: "factory-update-branches.yml", inputs: { pr: "109" } },
      { workflow: "factory-update-branches.yml", inputs: { pr: "202" } },
    ]);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [101, 108, 109, 202], upToDate: [203], forks: [] });
  });

  it("leaves one comment on a fork's PR that is behind, asking its author to update it, and dispatches nothing", async () => {
    const p = await prWorld({ main: "clean" });
    p.w.codeHost.pr(PR).headSha = await git(p.workRepo, "rev-parse", "main");
    await pullRequestOn(p, 204, "patch-1", "main~1", { fork: true });

    for (let scan = 0; scan < 2; scan++) expect(await p.w.factory("update-branch", "--scan", "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.dispatches).toEqual([]);
    expect(p.w.codeHost.pushes).toEqual([]);
    const comments = p.w.codeHost.pr(204).comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatch(/update the branch/i);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [], upToDate: [PR], forks: [204] });
  });

  it("counts the scan's own comment, written as the Actions bot, and not a stranger's forged copy", async () => {
    const p = await prWorld({ main: "clean" });
    p.w.codeHost.pr(PR).headSha = await git(p.workRepo, "rev-parse", "main");
    await pullRequestOn(p, 204, "patch-1", "main~1", { fork: true });
    await pullRequestOn(p, 205, "patch-2", "main~1", { fork: true });
    const ask = marked(`${FORK_UPDATE_TAG}\nThis branch is behind \`main\`.`);
    // The job token writes as `github-actions[bot]`, who is no collaborator: `canWrite` says no for it.
    p.w.codeHost.pr(204).conversation.push({ id: "comment-1", kind: "comment", author: "github-actions[bot]", body: ask });
    p.w.codeHost.pr(205).conversation.push({ id: "comment-2", kind: "comment", author: "mallory", body: ask });

    expect(await p.w.factory("update-branch", "--scan", "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.pr(204).comments).toEqual([]);
    expect(p.w.codeHost.pr(205).comments).toHaveLength(1);
  });
});

/** A person's PR on `branch`, cut from `from` with one commit of its own (line 20), in both checkouts. */
async function pullRequestOn(p: PrWorld, number: number, branch: string, from: string, extra: { draft?: boolean; fork?: boolean } = {}) {
  await git(p.workRepo, "checkout", "--quiet", "-b", branch, from);
  await commitFile(p.workRepo, "src/person.ts", `export const person = "${branch}";\n`, `feat: work on ${branch}`);
  const sha = await git(p.workRepo, "rev-parse", "HEAD");
  await git(p.workRepo, "checkout", "--quiet", "main");
  await git(p.publishRepo, "fetch", "--quiet", p.workRepo, `${branch}:${branch}`);
  p.w.codeHost.branches.set(branch, sha);
  p.w.codeHost.add({ number, branch, headSha: sha, ...extra });
  return sha;
}

const HUMAN_PR = 202;

/** claim → work → publish of the update of a person's PR, keyed by the PR alone. */
async function humanRound(main: MainChange, options: Pick<Parameters<typeof prWorld>[0], "agent" | "verify"> = {}, beforePublish?: (p: PrWorld) => void, branch = "feature/thing") {
  const p = await prWorld({ main, ...options });
  if (branch === "feature/clash") {
    for (const repo of [p.workRepo, p.publishRepo]) {
      await git(repo, "checkout", "--quiet", "-b", branch, BRANCH);
      await git(repo, "checkout", "--quiet", "main");
    }
    const sha = await git(p.workRepo, "rev-parse", branch);
    p.w.codeHost.branches.set(branch, sha);
    p.w.codeHost.add({ number: HUMAN_PR, branch, headSha: sha });
  } else {
    await pullRequestOn(p, HUMAN_PR, branch, "main~1");
  }
  const labels = () => [...p.w.tracker.issues.values()].map((i) => [i.number, [...i.labels.keys()], i.comments.length]);
  const before = labels();
  expect(await p.w.factory("update-branch", "--pr", String(HUMAN_PR))).toBe(0);
  const claim = lastJson(p.w.logs) as { claimed: boolean; startSha: string };
  expect(claim).toMatchObject({ claimed: true, issue: null, pr: HUMAN_PR, branch });
  expect(await p.w.factory("work", "--flow", "update-branch", "--pr", String(HUMAN_PR), "--out", p.out, "--repo", p.workRepo)).toBe(0);
  beforePublish?.(p);
  expect(await p.w.factory("publish", "--pr", String(HUMAN_PR), "--in", p.out, "--repo", p.publishRepo, "--start-sha", claim.startSha)).toBe(0);
  return { p, branch, publish: lastJson(p.w.logs) as { outcome: string }, untouched: () => expect(labels()).toEqual(before) };
}

describe("factory update-branch --pr: a person's pull request", () => {
  it("merges main with no agent, runs Verify, pushes and says what it merged, only on the PR", async () => {
    const { p, branch, publish, untouched } = await humanRound("clean", { verify: [{ ok: true }] });

    expect(p.w.agent.calls).toEqual([]);
    expect(p.w.verify.runs).toBe(1);
    const pushed = p.w.codeHost.branches.get(branch)!;
    expect((await git(p.publishRepo, "rev-list", "--parents", "-n", "1", pushed)).split(" ")).toHaveLength(3);
    expect(publish.outcome).toBe("updated");
    const pr = p.w.codeHost.pr(HUMAN_PR);
    expect(pr.comments).toHaveLength(1);
    expect(unmarked(pr.comments[0]!)).toMatch(/Merged `main`/);
    expect(p.w.codeHost.writes).toEqual([`push ${branch}`, `commentPr #${HUMAN_PR}`]);
    untouched();
  });

  it("has the agent resolve a conflict, preserving both intents, then Verify", async () => {
    const { p, branch } = await humanRound("conflict", { agent: { development: [resolve] }, verify: [{ ok: true }] }, undefined, "feature/clash");

    expect(p.w.agent.calls.map((c) => c.stage)).toEqual(["development"]);
    expect(p.w.agent.calls[0]!.prompt).toContain("Preserve both intents, do not invent new behaviour");
    expect(p.w.agent.calls[0]!.prompt).toContain(`pull request #${HUMAN_PR}`);
    expect(await git(p.publishRepo, "show", `${p.w.codeHost.branches.get(branch)!}:src/app.ts`)).toContain("line5 = 555;");
  });

  it("fixes a failing Verify with the normal loop and commits the fix on the person's branch", async () => {
    const { p, branch, untouched } = await humanRound("clean", {
      agent: { development: [commits()], review: [reviewOk] },
      verify: [{ ok: false, failedCommand: "pnpm test", output: "merge broke it" }, { ok: true }],
    });

    expect(p.w.agent.calls.map((c) => c.stage)).toEqual(["development", "review"]);
    expect(p.w.agent.calls[0]!.prompt).toContain("merge broke it");
    expect(await git(p.publishRepo, "show", `${p.w.codeHost.branches.get(branch)!}:src/greet.ts`)).toContain("hi");
    untouched();
  });

  it("after five failed attempts comments the attempts on the PR and stops: no push, no label, no Escalation", async () => {
    const fail = { ok: false, failedCommand: "pnpm test", output: "still broken" };
    const { p, publish, untouched } = await humanRound("clean", {
      agent: { development: Array(4).fill(commits()), review: Array(4).fill(reviewOk) },
      verify: Array(5).fill(fail),
    });

    expect(p.w.verify.runs).toBe(5);
    expect(publish.outcome).toBe("stopped");
    expect(p.w.codeHost.pushes).toEqual([]);
    const comments = p.w.codeHost.pr(HUMAN_PR).comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain("Attempt 5");
    expect(comments[0]).toContain("still broken");
    expect(p.w.codeHost.dispatches).toEqual([]);
    untouched();
  });

  it("discards the run when the branch moved, saying so on the PR", async () => {
    const { p, untouched } = await humanRound("clean", { verify: [{ ok: true }] }, (q) => void q.w.codeHost.branches.set("feature/thing", "f".repeat(40)));
    expect(p.w.codeHost.pushes).toEqual([]);
    expect(p.w.codeHost.pr(HUMAN_PR).comments.at(-1)).toContain("Run discarded");
    untouched();
  });

  it("refuses a fork's PR, a closed PR and one that targets another branch", async () => {
    const p = await prWorld({ main: "clean" });
    await pullRequestOn(p, 204, "patch-1", "main~1", { fork: true });
    await pullRequestOn(p, 205, "old", "main~1");
    p.w.codeHost.pr(205).state = "closed";
    await pullRequestOn(p, 206, "on-release", "main~1");
    p.w.codeHost.pr(206).base = "release";

    const reasons = [];
    for (const pr of [204, 205, 206]) {
      expect(await p.w.factory("update-branch", "--pr", String(pr))).toBe(0);
      reasons.push((lastJson(p.w.logs) as { reason: string }).reason);
    }
    expect(reasons).toEqual(["fork", "pr-not-open", "other-base"]);
    expect(p.w.codeHost.writes).toEqual([]);
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
