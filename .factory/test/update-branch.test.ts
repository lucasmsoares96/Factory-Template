import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { FORK_UPDATE_TAG } from "../src/commands/pr-claim.ts";
import { marked } from "../src/marker.ts";
import { SessionLimitError } from "../src/seams/agent.ts";
import { commitFile, git, HUMAN, lastJson, OWNER, unmarked } from "./helpers.ts";
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
      { workflow: "update-branches", inputs: { issue: "7" } },
      { workflow: "update-branches", inputs: { issue: "8" } },
      { workflow: "update-branches", inputs: { pr: "109" } },
      { workflow: "update-branches", inputs: { pr: "202" } },
    ]);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [101, 108, 109, 202], upToDate: [203], forks: [], released: { issues: [], prs: [] } });
  });

  it("takes factory:working off what no Factory run is queued or going on, and keeps it where one is", async () => {
    const p = await prWorld({ main: "none" });
    const working = { "factory:working": "github-actions[bot]" };
    // #7 and its PR #101: a cancelled run left the label. #8: the issue flow is running. #10: the Triage is running and
    // #10 is still in Triage. #11: left behind by a Triage that ended. #202: a feedback run is queued on it; #203: orphan.
    p.w.tracker.issues.get(7)!.labels.set("factory:working", "github-actions[bot]");
    p.w.codeHost.pr(PR).labels.push("factory:working");
    p.w.tracker.add({ number: 8, labels: { "in-progress": OWNER, ...working } });
    p.w.tracker.add({ number: 10, labels: { "agent:explore": HUMAN, ...working } });
    p.w.tracker.add({ number: 11, labels: { "ready-for-agent": OWNER, ...working } });
    p.w.tracker.add({ number: 12, state: "closed", labels: working });
    p.w.codeHost.add({ number: 108, branch: "factory/issue-8", headSha: await git(p.workRepo, "rev-parse", "main"), labels: ["factory:working"] });
    p.w.codeHost.add({ number: 202, branch: "feature/thing", headSha: await git(p.workRepo, "rev-parse", "main"), labels: ["factory:working"] });
    p.w.codeHost.add({ number: 203, branch: "feature/other", headSha: await git(p.workRepo, "rev-parse", "main"), labels: ["factory:working"] });
    p.w.codeHost.pr(PR).headSha = await git(p.workRepo, "rev-parse", "main");
    p.w.codeHost.runs.push(
      { id: 1, workflow: "factory-issue.yml", issue: 8, pr: null },
      { id: 2, workflow: "factory-triage.yml", issue: null, pr: null },
      { id: 3, workflow: "factory-pr-feedback.yml", issue: null, pr: 202 },
      { id: 4, workflow: "factory-update-branches.yml", issue: null, pr: null },
    );

    expect(await p.w.factory("update-branch", "--scan", "--repo", p.workRepo)).toBe(0);

    expect(lastJson(p.w.logs)).toMatchObject({ released: { issues: [7, 11], prs: [101, 203] } });
    expect(p.w.tracker.labelsOf(7)).toEqual(["in-progress"]);
    expect(p.w.codeHost.pr(PR).labels).toEqual([]);
    expect(p.w.tracker.labelsOf(8)).toContain("factory:working");
    expect(p.w.codeHost.pr(108).labels).toEqual(["factory:working"]);
    expect(p.w.tracker.labelsOf(10)).toContain("factory:working");
    expect(p.w.tracker.labelsOf(11)).toEqual(["ready-for-agent"]);
    expect(p.w.codeHost.pr(202).labels).toEqual(["factory:working"]);
    expect(p.w.codeHost.pr(203).labels).toEqual([]);
  });

  it("touches no label when the Factory runs cannot be listed", async () => {
    const p = await prWorld({ main: "none" });
    p.w.tracker.issues.get(7)!.labels.set("factory:working", "github-actions[bot]");
    p.w.codeHost.activeRuns = async () => {
      throw new Error("Resource not accessible by integration");
    };

    expect(await p.w.factory("update-branch", "--scan", "--repo", p.workRepo)).toBe(0);

    expect(p.w.tracker.labelsOf(7)).toContain("factory:working");
    expect(p.w.logs.join("\n")).toContain("Resource not accessible by integration");
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
    expect(lastJson(p.w.logs)).toMatchObject({ dispatched: [], upToDate: [PR], forks: [204] });
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

describe("factory update-branch --scan --pr: the PR just opened or reopened", () => {
  it("dispatches a person's PR that is behind by the PR, and touches no other PR nor any label", async () => {
    const p = await prWorld({ main: "conflict" });
    p.w.tracker.issues.get(7)!.labels.set("factory:working", "github-actions[bot]");
    await pullRequestOn(p, 202, "feature/thing", "main~1");

    expect(await p.w.factory("update-branch", "--scan", "--pr", "202", "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.dispatches).toEqual([{ workflow: "update-branches", inputs: { pr: "202" } }]);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [202], upToDate: [], forks: [] });
    expect(p.w.tracker.labelsOf(7)).toContain("factory:working");
  });

  it("dispatches a Factory PR in progress that is behind in its issue's flow", async () => {
    const p = await prWorld({ main: "conflict" });

    expect(await p.w.factory("update-branch", "--scan", "--pr", String(PR), "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.dispatches).toEqual([{ workflow: "update-branches", inputs: { issue: "7" } }]);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [PR], upToDate: [], forks: [] });
  });

  it("does nothing for a PR that is up to date", async () => {
    const p = await prWorld({ main: "conflict" });
    await pullRequestOn(p, 203, "feature/fresh", "main");

    expect(await p.w.factory("update-branch", "--scan", "--pr", "203", "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.dispatches).toEqual([]);
    expect(p.w.codeHost.writes).toEqual([]);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [], upToDate: [203], forks: [] });
  });

  it("leaves one comment on a fork's PR that is behind, and dispatches and pushes nothing", async () => {
    const p = await prWorld({ main: "clean" });
    await pullRequestOn(p, 204, "patch-1", "main~1", { fork: true });

    for (let open = 0; open < 2; open++) expect(await p.w.factory("update-branch", "--scan", "--pr", "204", "--repo", p.workRepo)).toBe(0);

    expect(p.w.codeHost.dispatches).toEqual([]);
    expect(p.w.codeHost.pushes).toEqual([]);
    const comments = p.w.codeHost.pr(204).comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatch(/update the branch/i);
    expect(lastJson(p.w.logs)).toEqual({ dispatched: [], upToDate: [], forks: [204] });
  });

  it("ignores a PR that is closed, into another base, or missing", async () => {
    const p = await prWorld({ main: "clean" });
    await pullRequestOn(p, 205, "feature/closed", "main~1", { state: "closed" });
    await pullRequestOn(p, 206, "feature/other", "main~1", { base: "release" });

    for (const pr of ["205", "206", "999"]) {
      expect(await p.w.factory("update-branch", "--scan", "--pr", pr, "--repo", p.workRepo)).toBe(0);
      expect(lastJson(p.w.logs)).toEqual({ dispatched: [], upToDate: [], forks: [] });
    }
    expect(p.w.codeHost.dispatches).toEqual([]);
    expect(p.w.codeHost.writes).toEqual([]);
  });
});

/** A person's PR on `branch`, cut from `from` with one commit of its own (line 20), in both checkouts. */
async function pullRequestOn(p: PrWorld, number: number, branch: string, from: string, extra: { draft?: boolean; fork?: boolean; state?: "open" | "closed"; base?: string } = {}) {
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

/** claim → work → publish → working off of the update of a person's PR, keyed by the PR alone. */
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
  const publish = lastJson(p.w.logs) as { outcome: string };
  expect(await p.w.factory("working", "off", "--pr", String(HUMAN_PR))).toBe(0);
  return { p, branch, publish, untouched: () => expect(labels()).toEqual(before) };
}

describe("factory update-branch: the failed checks are a pr-feedback matter", () => {
  it("a failing Verify after the merge reads no failed checks and gives the Development no `<checks>` block", async () => {
    const p = await updateRound("clean", {
      agent: { development: [commits()], review: [reviewOk] },
      verify: [{ ok: false, failedCommand: "pnpm test", output: "merge broke it" }, { ok: true }],
    });

    expect(p.w.agent.calls[0]!.prompt).toContain("merge broke it");
    expect(p.w.agent.calls[0]!.prompt).not.toContain("<checks>");
    expect(p.w.codeHost.checkReads).toEqual([]);
  });
});

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
    expect(p.w.codeHost.writes).toEqual([`labelPr #${HUMAN_PR} factory:working`, `push ${branch}`, `commentPr #${HUMAN_PR}`, `unlabelPr #${HUMAN_PR} factory:working`]);
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

  it("discards the run when the branch moved, in the log only: a newer update of the PR is on its way", async () => {
    const { p, publish, untouched } = await humanRound("clean", { verify: [{ ok: true }] }, (q) => void q.w.codeHost.branches.set("feature/thing", "f".repeat(40)));
    expect(p.w.codeHost.pushes).toEqual([]);
    expect(publish).toEqual({ pr: HUMAN_PR, outcome: "discarded", reason: "branch feature/thing moved since the run started" });
    expect(p.w.codeHost.pr(HUMAN_PR).comments).toEqual([]);
    expect(p.w.logs.some((line) => line.includes("Run discarded: branch feature/thing moved since the run started"))).toBe(true);
    untouched();
  });

  it("keeps a lease refused at the push in the log only, when the branch moved after the check", async () => {
    const { p, publish, untouched } = await humanRound("clean", { verify: [{ ok: true }] }, (q) => {
      const codeHost = q.w.codeHost;
      const head = codeHost.branches.get("feature/thing")!;
      // The check still sees the claim's head; the branch moves before the push.
      codeHost.branchHead = async () => {
        codeHost.branches.set("feature/thing", "f".repeat(40));
        return head;
      };
    });
    expect(p.w.codeHost.pushes).toHaveLength(1);
    expect(publish).toEqual({ pr: HUMAN_PR, outcome: "discarded", reason: "branch feature/thing moved since the run started" });
    expect(p.w.codeHost.pr(HUMAN_PR).comments).toEqual([]);
    expect(p.w.logs.some((line) => line.includes("Run discarded: branch feature/thing moved since the run started"))).toBe(true);
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

  it("pushes the fix of a failing Verify even when the Review finds a criterion not met: the merge is not judged on the criteria", async () => {
    const unmet = { criterion: "`greet()` returns a greeting.", met: false, proof: "No test proves it." };
    const reviewUnmet: AgentStep = () => ({ output: `<review>${JSON.stringify({ summary: "Fine.", inline: [], criteria: [unmet] })}</review>` });
    const p = await updateRound("clean", {
      agent: { development: [commits()], review: [reviewUnmet] },
      verify: [{ ok: false, failedCommand: "pnpm test", output: "merge broke it" }, { ok: true }],
    });

    expect(await git(p.publishRepo, "show", `${p.w.codeHost.branches.get(BRANCH)!}:src/greet.ts`)).toContain("hi");
    expect(p.w.tracker.labelsOf(7)).toEqual(["in-progress"]);
    expect(p.w.codeHost.pr(PR).body).toBe("Original body\n\nCloses #7");
  });

  it("escalates when the agent leaves the merge unresolved", async () => {
    const p = await updateRound("conflict", { agent: { development: [() => ({ output: "gave up" })] } });

    expect(p.w.verify.runs).toBe(0);
    expect(p.w.tracker.labelsOf(7)).toEqual(["ready-for-human"]);
    expect(p.w.codeHost.pr(PR).comments).toHaveLength(1);
    // The round's PR is cited and kept: no "no pull request", no restart from main.
    const comment = p.w.tracker.commentsOn(7).at(-1)!.body;
    expect(comment).toContain(`#${PR}`);
    expect(comment).not.toContain("No pull request");
    expect(comment).not.toContain("ready-for-agent");
    expect(p.w.codeHost.pr(PR).state).toBe("open");
  });

  it("discards the run when the branch moved since the claim", async () => {
    const q = await prWorld({ main: "clean", verify: [{ ok: true }] });
    await q.w.factory("update-branch", "7");
    const claim = lastJson(q.w.logs) as { startSha: string };
    await finishRound(q, ["--flow", "update-branch"], claim.startSha, () => void q.w.codeHost.branches.set(BRANCH, "f".repeat(40)));

    expect(q.w.codeHost.pushes).toEqual([]);
    expect(q.w.logs).toContain(JSON.stringify({ issue: 7, outcome: "discarded", reason: `branch ${BRANCH} moved since the run started` }));
    expect(q.w.logs.some((line) => line.includes(`Run discarded: branch ${BRANCH} moved since the run started`))).toBe(true);
    expect(q.w.tracker.issues.get(7)!.comments.map((c) => c.body).join("\n")).not.toContain("Run discarded");
    expect(q.w.codeHost.pr(PR).comments.join("\n")).not.toContain("Run discarded");
  });

  it("keeps a lease refused at the push in the log too, when the branch moved after the re-check", async () => {
    const q = await prWorld({ main: "clean", verify: [{ ok: true }] });
    await q.w.factory("update-branch", "7");
    const claim = lastJson(q.w.logs) as { startSha: string };
    await finishRound(q, ["--flow", "update-branch"], claim.startSha, () => {
      // The re-check still sees the claim's head; the branch moves before the push.
      const codeHost = q.w.codeHost;
      codeHost.branchHead = async () => {
        codeHost.branches.set(BRANCH, "f".repeat(40));
        return claim.startSha;
      };
    });

    expect(q.w.codeHost.pushes).toHaveLength(1);
    expect(q.w.codeHost.branches.get(BRANCH)).toBe("f".repeat(40));
    expect(q.w.logs).toContain(JSON.stringify({ issue: 7, outcome: "discarded", reason: `branch ${BRANCH} moved since the run started` }));
    expect(q.w.logs.some((line) => line.includes(`Run discarded: branch ${BRANCH} moved since the run started`))).toBe(true);
    expect(q.w.tracker.issues.get(7)!.comments.map((c) => c.body).join("\n")).not.toContain("Run discarded");
    expect(q.w.codeHost.pr(PR).comments.join("\n")).not.toContain("Run discarded");
  });

  it("still comments a discard for any other reason, such as the issue closed since the claim", async () => {
    const q = await prWorld({ main: "clean", verify: [{ ok: true }] });
    await q.w.factory("update-branch", "7");
    const claim = lastJson(q.w.logs) as { startSha: string };
    await finishRound(q, ["--flow", "update-branch"], claim.startSha, () => void (q.w.tracker.issues.get(7)!.state = "closed"));

    expect(q.w.codeHost.pushes).toEqual([]);
    expect(q.w.tracker.issues.get(7)!.comments.at(-1)!.body).toContain("Run discarded");
  });

  it("`publish` refuses an unknown --flow before touching the forge", async () => {
    const p = await prWorld({ main: "clean" });
    await expect(p.w.factory("publish", "7", "--flow", "elsewhere", "--pr", String(PR), "--in", p.out, "--repo", p.publishRepo)).rejects.toThrow("Unknown --flow: elsewhere");
    expect(p.w.codeHost.writes).toEqual([]);
    expect(p.w.tracker.issues.get(7)!.comments).toEqual([]);
  });

  it("marks the issue and its PR factory:working while the update runs, and the end of the run clears both", async () => {
    const p = await prWorld({ main: "clean", verify: [{ ok: true }] });

    expect(await p.w.factory("update-branch", "7")).toBe(0);
    const claim = lastJson(p.w.logs) as { startSha: string };
    expect(p.w.tracker.labelsOf(7)).toEqual(["in-progress", "factory:working"]);
    expect(p.w.codeHost.pr(PR).labels).toEqual(["factory:working"]);

    await finishRound(p, ["--flow", "update-branch"], claim.startSha);
    expect(p.w.tracker.labelsOf(7)).toEqual(["in-progress"]);
    expect(p.w.codeHost.pr(PR).labels).toEqual([]);
  });

  it("refuses an issue that is not in-progress or has no open PR", async () => {
    const p = await prWorld({ main: "clean" });
    p.w.codeHost.pr(PR).state = "closed";
    await p.w.factory("update-branch", "7");
    expect(lastJson(p.w.logs)).toEqual({ claimed: false, reason: "no-open-pr" });
  });
});

describe("factory update-branch: paused at the agent's usage limit", () => {
  const limitHit: AgentStep = () => {
    throw new SessionLimitError("Agent session 01-development failed: claude-code exited with code 1:\nYou've hit your session limit · resets 3:20pm (UTC)", "3:20pm (UTC)");
  };

  it("an issue's update pushes nothing, keeps the lock and waits to run the same update again", async () => {
    const p = await updateRound("conflict", { agent: { development: [limitHit] } });

    expect(p.w.codeHost.pushes).toEqual([]);
    expect(p.w.tracker.labelsOf(7).sort()).toEqual(["factory:session-limit", "in-progress"]);
    const wait = p.w.tracker.commentsOn(7).at(-1)!.body;
    expect(wait).toContain('"flow":"update-branch"');
    expect(wait).toContain("The update of pull request #101 with `main` starts again; nothing was pushed.");
    expect(p.w.codeHost.dispatches).toEqual([]);
  });

  it("a person's PR gets the wait on itself, labelled, and no issue is touched", async () => {
    const { p, publish, untouched } = await humanRound("clean", { agent: { development: [limitHit] }, verify: [{ ok: false, failedCommand: "pnpm test", output: "broken" }] });

    expect(publish).toMatchObject({ pr: HUMAN_PR, outcome: "paused", reason: "session-limit" });
    expect(p.w.codeHost.pushes).toEqual([]);
    const pr = p.w.codeHost.pr(HUMAN_PR);
    expect(pr.labels).toEqual(["factory:session-limit"]);
    expect(pr.comments.at(-1)).toContain('"flow":"update-pr"');
    untouched();

    // A push to main before the reset finds the PR still behind: its update waits for `resume`, never runs early.
    expect(await p.w.factory("update-branch", "--pr", String(HUMAN_PR))).toBe(0);
    expect(lastJson(p.w.logs)).toEqual({ claimed: false, reason: "session-limit" });
    expect(pr.labels).toEqual(["factory:session-limit"]);
  });
});
