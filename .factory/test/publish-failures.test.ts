import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import type { VerifyStep } from "../src/adapters/fake/fake-verify.ts";
import { checkout, commitFile, commitFiles, git, lastJson, OWNER, tempDir, world, type WorldOptions } from "./helpers.ts";

const RUN_URL = "https://forge.test/actions/runs/42";
const OLD_SHA = "0123456789abcdef0123456789abcdef01234567";

const developFile =
  (path: string, content = "change\n"): AgentStep =>
  async ({ cwd }) => {
    await commitFile(cwd, path, content, `feat: touch ${path} #7`);
    return { usage: { inputTokens: 10_000, outputTokens: 1_000 } };
  };
const develop = developFile("src/greet.ts", 'export const greet = () => "hi";\n');
const review: AgentStep = () => ({
  output: `<review>${JSON.stringify({ summary: "Reviewed.", inline: [{ path: "src/greet.ts", line: 1, body: "Fine." }] })}</review>`,
  usage: { inputTokens: 5_000, outputTokens: 500 },
});
const e2eFails: VerifyStep = { ok: false, failedCommand: "pnpm --filter example test:e2e", output: "x".repeat(6000) + "\nexpected 200, got 500" };

/**
 * claim → work → publish through the CLI, each job on its own checkout.
 * `between` runs after work and before publish, to change forge state.
 */
async function pipeline(
  options: Pick<WorldOptions, "agent" | "verify" | "branches" | "prs" | "env"> & {
    between?: (w: ReturnType<typeof world>) => void | Promise<void>;
    publishArgs?: string[];
    /** PR flows do not run the issue claim: they take the lock on an issue whose PR is open. */
    skipClaim?: boolean;
  } = {},
) {
  const workCheckout = await checkout();
  const publishCheckout = await checkout();
  const artifacts = await tempDir("factory-artifacts-");
  const w = world({ repo: workCheckout, ...options });

  let claimed: { claimed: boolean; startSha: string | null };
  if (options.skipClaim) {
    await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
    claimed = { claimed: true, startSha: await w.codeHost.branchHead("factory/issue-7") };
  } else {
    expect(await w.factory("claim", "7")).toBe(0);
    claimed = lastJson(w.logs) as typeof claimed;
    expect(claimed.claimed).toBe(true);
  }
  expect(await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts)).toBe(0);
  await options.between?.(w);
  const head = await git(workCheckout, "rev-parse", "HEAD");
  const exitCode = await w.factory(
    "publish", "7", "--repo", publishCheckout, "--in", artifacts,
    "--start-sha", claimed.startSha ?? "", "--run-url", RUN_URL, ...(options.publishArgs ?? []),
  );
  const factoryComments = () => w.tracker.commentsOn(7).filter((c) => c.author === OWNER).map((c) => c.body);
  return { w, exitCode, head, publishCheckout, artifacts, output: lastJson(w.logs), factoryComments };
}

describe("factory publish: Escalation", () => {
  it("escalates repeated E2E failures with a draft PR and a full report on the issue", async () => {
    const { w, exitCode, head, output, factoryComments } = await pipeline({
      env: { FACTORY_MAX_ATTEMPTS: "2" },
      agent: { development: [develop, developFile("src/greet.ts", "again\n")], review: [review, review] },
      verify: [e2eFails, e2eFails],
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual({ issue: 7, outcome: "escalated", reason: "e2e-failures", pr: 101, url: "https://forge.test/pr/101" });
    expect(w.tracker.labelsOf(7)).toEqual(["ready-for-human"]);
    expect(w.codeHost.pushes).toEqual([{ branch: "factory/issue-7", sha: head, expectedSha: null }]);

    const pr = w.codeHost.pr(101);
    expect(pr).toMatchObject({ draft: true, state: "open", title: "Fix #7: Greet the user" });
    expect(pr.body.split("\n")[0]).toMatch(/^> \[!WARNING\]/);
    expect(pr.body).toMatch(/escalated/i);
    expect(pr.body).toMatch(/^Closes #7$/m);
    expect(pr.reviews[0]!.body).toMatch(/Estimated cost: \$/);

    const [comment] = factoryComments();
    expect(comment).toContain("E2E did not pass in 2 attempts");
    expect(comment).toContain("Attempt 1: Development ok (1 commit) → Review ok → E2E failed: `pnpm --filter example test:e2e`");
    expect(comment).toContain("Attempt 2: Development ok (1 commit) → Review ok → E2E failed: `pnpm --filter example test:e2e`");
    expect(comment).toContain("expected 200, got 500");
    expect(comment).not.toContain("x".repeat(5000));
    expect(comment).toContain("#101");
    expect(comment).toContain(RUN_URL);
    expect(comment).toMatch(/re-add the `ready-for-agent` label/);
    // 2 × (10k + 5k) in at $4/MTok + 2 × (1k + 500) out at $20/MTok.
    expect(comment).toContain("Tokens: 30,000 in / 3,000 out. Estimated cost: $0.18.");
  });

  it("does not blame E2E when the last attempt stopped at a Review timeout or a Development without commits", async () => {
    const reviewTimesOut: AgentStep = (call) => ({ ...(review(call) as object), timedOut: true });
    const reviewed = await pipeline({
      env: { FACTORY_MAX_ATTEMPTS: "2" },
      agent: { development: [develop, developFile("src/greet.ts", "again\n")], review: [review, reviewTimesOut] },
      verify: [e2eFails],
    });
    expect(reviewed.output).toMatchObject({ outcome: "escalated", reason: "e2e-failures" });
    const [reviewComment] = reviewed.factoryComments();
    expect(reviewComment).toContain("without a passing E2E; the last one stopped at Review, which ended with timeout");
    expect(reviewComment).not.toContain("E2E did not pass");

    const idle = await pipeline({
      env: { FACTORY_MAX_ATTEMPTS: "2" },
      agent: { development: [develop, () => ({})], review: [review] },
      verify: [e2eFails],
    });
    const [idleComment] = idle.factoryComments();
    expect(idleComment).toContain("the last one stopped at Development, which made no commits");
    expect(idleComment).not.toContain("E2E did not pass");
  });

  it("escalates a Development that needs a human at once, without a PR when it made no commits", async () => {
    const { w, output, factoryComments } = await pipeline({
      agent: { development: [() => ({ output: "<needs-human>Which locale should greet() use?</needs-human>" })] },
    });

    expect(output).toEqual({ issue: 7, outcome: "escalated", reason: "needs-human", pr: null, url: null });
    expect(w.codeHost.writes).toEqual(["dispatch retro"]);
    expect(w.tracker.labelsOf(7)).toEqual(["ready-for-human"]);
    const [comment] = factoryComments();
    expect(comment).toContain("Which locale should greet() use?");
    expect(comment).toMatch(/No pull request: the run made no commits/);
  });

  it("starts the automatic Retro of every Escalation, with the draft PR when there is one", async () => {
    const asks: AgentStep = async (call) => ({ ...(await develop(call)), output: "<needs-human>Which copy?</needs-human>" });
    const { w } = await pipeline({ agent: { development: [asks] } });

    expect(w.codeHost.dispatches).toEqual([{ workflow: "retro", inputs: { issue: "7", pr: "101" } }]);
  });

  it("starts no Retro when FACTORY_RETRO_ENABLED is false", async () => {
    const { w, output } = await pipeline({
      agent: { development: [() => ({ output: "<needs-human>Which locale?</needs-human>" })] },
      env: { FACTORY_RETRO_ENABLED: "false" },
    });

    expect(output).toMatchObject({ outcome: "escalated" });
    expect(w.codeHost.dispatches).toEqual([]);
  });

  it("an Escalation still lands when the Retro cannot be started", async () => {
    const repo = await checkout();
    const w = world({ repo });
    w.codeHost.dispatch = async () => {
      throw new Error("dispatch refused");
    };
    await w.factory("claim", "7");

    await w.factory("publish", "7", "--repo", repo, "--in", await tempDir("factory-empty-"), "--run-url", RUN_URL);

    expect(lastJson(w.logs)).toMatchObject({ outcome: "escalated", reason: "infra" });
    expect(w.tracker.labelsOf(7)).toEqual(["ready-for-human"]);
    expect(w.logs.join("\n")).toContain("The automatic Retro of #7 did not start: dispatch refused");
  });

  it("escalates a needs-human Development that made commits with a draft PR", async () => {
    const asks: AgentStep = async (call) => ({ ...(await develop(call)), output: "<needs-human>Which copy?</needs-human>" });
    const { w, output } = await pipeline({ agent: { development: [asks] } });

    expect(output).toMatchObject({ outcome: "escalated", reason: "needs-human", pr: 101 });
    expect(w.codeHost.pr(101).draft).toBe(true);
  });

  it("escalates with reason infra when the work job left no result.json", async () => {
    const repo = await checkout();
    const w = world({ repo });
    await w.factory("claim", "7");

    expect(await w.factory("publish", "7", "--repo", repo, "--in", await tempDir("factory-empty-"), "--run-url", RUN_URL)).toBe(0);

    expect(lastJson(w.logs)).toEqual({ issue: 7, outcome: "escalated", reason: "infra", pr: null, url: null });
    expect(w.codeHost.writes).toEqual(["dispatch retro"]);
    expect(w.tracker.labelsOf(7)).toEqual(["ready-for-human"]);
    const comment = w.tracker.commentsOn(7).at(-1)!.body;
    expect(comment).toMatch(/infra/);
    expect(comment).toContain(RUN_URL);
  });

  it("escalates with reason infra when result.json does not match the schema, pushing nothing", async () => {
    const artifacts = await tempDir("factory-artifacts-");
    await writeFile(join(artifacts, "result.json"), JSON.stringify({ version: 1, issue: 7, outcome: "merged" }));
    const repo = await checkout();
    const w = world({ repo });
    await w.factory("claim", "7");

    await w.factory("publish", "7", "--repo", repo, "--in", artifacts);

    expect(lastJson(w.logs)).toMatchObject({ outcome: "escalated", reason: "infra" });
    expect(w.codeHost.writes).toEqual(["dispatch retro"]);
    expect(w.tracker.commentsOn(7).at(-1)!.body).toMatch(/Invalid .*result\.json/);
  });
});

describe("factory publish: retry after Escalation", () => {
  it("closes the old draft and publishes a branch rebuilt from main", async () => {
    const { w, head, publishCheckout, output } = await pipeline({
      branches: { "factory/issue-7": OLD_SHA },
      prs: [{ number: 55, branch: "factory/issue-7", draft: true, headSha: OLD_SHA }],
      agent: { development: [develop], review: [review] },
      verify: [{ ok: true }],
    });

    expect(output).toMatchObject({ outcome: "ready", pr: 101 });
    expect(w.codeHost.pushes).toEqual([{ branch: "factory/issue-7", sha: head, expectedSha: OLD_SHA }]);
    expect(w.codeHost.writes.slice(0, 3)).toEqual(["push factory/issue-7", "closePr #55", "openDraftPr #101"]);
    expect(w.codeHost.pr(55).state).toBe("closed");
    expect(w.codeHost.pr(55).comments.join("\n")).toMatch(/superseded/i);
    expect(await git(publishCheckout, "merge-base", "main", head)).toBe(await git(publishCheckout, "rev-parse", "main"));
    expect(await git(publishCheckout, "log", "--format=%s", `main..${head}`)).toBe("feat: touch src/greet.ts #7");
  });
});

describe("factory publish: Run discarded", () => {
  const ready = { agent: { development: [develop], review: [review] }, verify: [{ ok: true }] };

  const cases: [string, (w: ReturnType<typeof world>) => void | Promise<void>, RegExp][] = [
    ["the issue was closed", (w) => void (w.tracker.issues.get(7)!.state = "closed"), /issue #7 is closed/],
    ["in-progress was removed", (w) => void w.tracker.issues.get(7)!.labels.delete("in-progress"), /no longer has `in-progress`/],
    ["the branch moved", (w) => void w.codeHost.branches.set("factory/issue-7", OLD_SHA), /branch factory\/issue-7 moved/],
    ["a ready PR was opened meanwhile", (w) => w.codeHost.add({ number: 60, branch: "factory/issue-7" }), /pull request #60 is already open/],
  ];

  it.each(cases)("discards the run when %s, pushing nothing", async (_name, change, message) => {
    let labels: string[] = [];
    const { w, output } = await pipeline({
      ...ready,
      between: async (w) => {
        await change(w);
        labels = w.tracker.labelsOf(7);
      },
    });

    expect(output).toMatchObject({ issue: 7, outcome: "discarded" });
    expect(w.codeHost.writes).toEqual([]);
    expect(w.tracker.labelsOf(7)).toEqual(labels);
    expect(w.tracker.commentsOn(7).at(-1)!.body).toMatch(/^Run discarded: /);
    expect(w.tracker.commentsOn(7).at(-1)!.body).toMatch(message);
  });

  it("discards a run that continues a pull request that was closed", async () => {
    const { w, output } = await pipeline({
      ...ready,
      branches: { "factory/issue-7": OLD_SHA },
      prs: [{ number: 55, branch: "factory/issue-7", draft: false, state: "closed" }],
      publishArgs: ["--pr", "55"],
      skipClaim: true,
    });

    expect(output).toMatchObject({ outcome: "discarded" });
    expect(w.codeHost.writes).toEqual([]);
    expect(w.tracker.commentsOn(7).at(-1)!.body).toMatch(/Run discarded: pull request #55 is no longer open/);
  });

  it("updates the pull request a run continues instead of opening another", async () => {
    const { w, head, output } = await pipeline({
      ...ready,
      branches: { "factory/issue-7": OLD_SHA },
      prs: [{ number: 55, branch: "factory/issue-7", draft: false, headSha: OLD_SHA }],
      publishArgs: ["--pr", "55"],
      skipClaim: true,
    });

    expect(output).toMatchObject({ outcome: "ready", pr: 55 });
    expect(w.codeHost.prs).toHaveLength(1);
    expect(w.codeHost.pr(55)).toMatchObject({ state: "open", headSha: head });
    expect(w.codeHost.pr(55).reviews).toHaveLength(1);
  });
});

describe("factory publish: sensitive and harness paths", () => {
  it("opens the PR for a diff in a sensitive path, labelled harness-change, with a warning that names the files", async () => {
    const paths = [".github/workflows/ci.yml", ".agents/skills/tdd/SKILL.md", ".claude/skills/tdd/SKILL.md", ".claude/settings.json", "skills-lock.json", ".mcp.json"];
    const touchesAll: AgentStep = async (call) => {
      await develop(call);
      await commitFiles(call.cwd, Object.fromEntries(paths.map((p) => [p, "change\n"])), "ci: touch sensitive files #7");
    };
    const { w, output } = await pipeline({ agent: { development: [touchesAll], review: [review] }, verify: [{ ok: true }] });

    expect(output).toMatchObject({ outcome: "ready", pr: 101 });
    expect(w.tracker.labelsOf(7)).toEqual(["in-progress"]);
    const pr = w.codeHost.pr(101);
    expect(pr.labels).toEqual(["harness-change"]);
    const [warning] = pr.body.split("\n\n");
    expect(warning).toMatch(/^> \[!WARNING\]/);
    expect(warning).toContain("secrets");
    for (const path of paths) expect(warning).toContain(`\`${path}\``);
    expect(pr.body).not.toMatch(/\[!CAUTION\]/);
  });

  it("labels a PR that changes harness paths as harness-change, with a warning on top", async () => {
    const paths = ["AGENTS.md", "apps/example/AGENTS.md", "docs/agents/triage-labels.md", "GLOSSARY.md", "docs/adr/0001-x.md", ".factory/src/config.ts"];
    const touchesAll: AgentStep = async (call) => {
      await develop(call);
      await commitFiles(call.cwd, Object.fromEntries(paths.map((p) => [p, "change\n"])), "docs: touch the harness #7");
    };
    const { w, output } = await pipeline({ agent: { development: [touchesAll], review: [review] }, verify: [{ ok: true }] });

    expect(output).toMatchObject({ outcome: "ready", pr: 101 });
    const pr = w.codeHost.pr(101);
    expect(pr.labels).toEqual(["harness-change"]);
    const [warning] = pr.body.split("\n\n");
    expect(warning).toMatch(/^> \[!CAUTION\]/);
    for (const path of paths) expect(warning).toContain(`\`${path}\``);
    expect(warning).not.toContain("src/greet.ts");
  });

  it("labels a PR that changes only CODING_STANDARDS.md as harness-change, with the warning", async () => {
    const touch: AgentStep = async (call) => {
      await develop(call);
      await commitFiles(call.cwd, { "CODING_STANDARDS.md": "# Coding Standards\n" }, "docs: add a rule #7");
    };
    const { w } = await pipeline({ agent: { development: [touch], review: [review] }, verify: [{ ok: true }] });

    const pr = w.codeHost.pr(101);
    expect(pr.labels).toEqual(["harness-change"]);
    expect(pr.body.split("\n\n")[0]).toMatch(/^> \[!CAUTION\][\s\S]*`CODING_STANDARDS.md`/);
  });

  it("does not label an ordinary change", async () => {
    const { w } = await pipeline({ agent: { development: [develop], review: [review] }, verify: [{ ok: true }] });

    expect(w.codeHost.pr(101).labels).toEqual([]);
    expect(w.codeHost.pr(101).body).toMatch(/^Closes #7$/m);
    expect(w.codeHost.pr(101).body).not.toContain("[!CAUTION]");
  });
});
