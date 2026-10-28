import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { checkout, commitFile, git, manualClock, tempDir, world, type WorldOptions } from "./helpers.ts";

let edits = 0;
const develop: AgentStep = async ({ cwd }) => {
  edits++;
  await commitFile(cwd, "src/greet.ts", `export const greet = () => "hi ${edits}";\n`, `feat: greet the user #7 (${edits})`);
  return { usage: { inputTokens: 10_000, outputTokens: 1_000 } };
};
const reviewOk: AgentStep = () => ({
  output: `<review>${JSON.stringify({ summary: "ok", inline: [] })}</review>`,
  usage: { inputTokens: 5_000, outputTokens: 500 },
});
const usage = { inputTokens: 2_000, outputTokens: 300 };
const body = "## Summary\n\n```text\ngreet\n```\n\n## Merge Danger\n\n**Door:** two-way";
const writes = (text = body): AgentStep => () => ({ output: `Done.\n<pull-request>${text}</pull-request>`, usage });
const e2eFails = { ok: false, failedCommand: "pnpm --filter example test:e2e", output: "expected 200, got 500" };

async function setup(options: Pick<WorldOptions, "agent" | "verify" | "env" | "now">) {
  const repo = await checkout();
  const out = await tempDir("factory-out-");
  const w = world({ repo, ...options });
  await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
  const run = async () => {
    expect(await w.factory("work", "7", "--out", out, "--repo", repo)).toBe(0);
    return JSON.parse(await readFile(join(out, "result.json"), "utf8"));
  };
  return { repo, out, w, run };
}

const prCalls = (w: Awaited<ReturnType<typeof setup>>["w"]) => w.agent.calls.filter((c) => c.stage === "pull-request");

describe("Pull Request Stage in the work job", () => {
  it("runs once after a green E2E, with the issue, log, result and prints in the prompt", async () => {
    const { repo, w, run } = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [writes()] },
      verify: [{ ok: true, evidence: [{ product: "example", name: "home.png" }] }],
    });

    const result = await run();

    expect(w.agent.calls.map((c) => c.stage)).toEqual(["development", "review", "pull-request"]);
    const [call] = prCalls(w);
    expect(call).toMatchObject({ model: "claude-haiku-5-5", timeoutMs: 15 * 60_000 });
    expect(call!.prompt).toContain("`pr` skill");
    expect(call!.prompt).toContain("Greet the user");
    expect(call!.prompt).toContain("feat: greet the user #7");
    expect(call!.prompt).toContain("E2E passed on attempt 1");
    expect(call!.prompt).toContain("test-results/evidence/example/home.png");
    expect(call!.prompt).toMatch(/Do not write `Closes`/);
    expect(w.verify.runs).toBe(1);
    expect(result.pullRequestBody).toBe(body);
    expect(result.pullRequestStage).toMatchObject({ outcome: "ok", retries: 0 });
    expect(result.head).toBe(await git(repo, "rev-parse", "factory/issue-7"));
  });

  it("is outside the attempts and its tokens add to the usage", async () => {
    const { run } = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [writes()] },
      verify: [{ ok: true }],
    });

    const result = await run();

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].stages.map((s: { stage: string }) => s.stage)).toEqual(["development", "review", "e2e"]);
    expect(result.usage.pullRequest).toEqual(usage);
    expect(result.pullRequestStage.usage).toEqual(usage);
  });

  it("discards a commit of the session: the branch is what the E2E validated", async () => {
    const sneaky: AgentStep = async ({ cwd }) => {
      await commitFile(cwd, "src/extra.ts", "export {};\n", "chore: sneak #7");
      return { output: `<pull-request>${body}</pull-request>`, usage };
    };
    const { repo, w, run } = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [sneaky] },
      verify: [{ ok: true }],
    });

    const result = await run();

    expect(result.pullRequestBody).toBe(body);
    expect(await git(repo, "log", "--format=%s", "main..factory/issue-7")).not.toContain("sneak");
    expect(result.head).toBe(await git(repo, "rev-parse", "factory/issue-7"));
    expect(await git(repo, "ls-tree", "-r", "--name-only", "factory/issue-7")).not.toContain("src/extra.ts");
    expect(w.verify.runs).toBe(1);
  });

  it("runs on an Escalation with commits, with the reason and the last E2E output", async () => {
    const { w, run } = await setup({
      agent: { development: Array(2).fill(develop), review: Array(2).fill(reviewOk), "pull-request": [writes()] },
      verify: [e2eFails, e2eFails],
      env: { FACTORY_MAX_ATTEMPTS: "2" },
    });

    const result = await run();

    expect(result).toMatchObject({ outcome: "escalated", reason: "e2e-failures", pullRequestBody: body });
    const prompt = prCalls(w)[0]!.prompt;
    expect(prompt).toContain("escalated");
    expect(prompt).toContain("e2e-failures");
    expect(prompt).toContain("pnpm --filter example test:e2e");
    expect(prompt).toContain("expected 200, got 500");
  });

  it("runs on a needs-human Escalation that left commits", async () => {
    const asks: AgentStep = async (call) => ({
      ...(await develop(call)),
      output: "Stuck.\n<needs-human>Which locale?</needs-human>",
    });
    const { w, run } = await setup({ agent: { development: [asks], "pull-request": [writes()] } });

    const result = await run();

    expect(result).toMatchObject({ reason: "needs-human", pullRequestBody: body });
    expect(prCalls(w)[0]!.prompt).toContain("Which locale?");
  });

  it("does not run without commits", async () => {
    const idle: AgentStep = () => ({ output: "Nothing to do." });
    const { w, run } = await setup({ agent: { development: Array(5).fill(idle) } });

    const result = await run();

    expect(result).toMatchObject({ head: null, pullRequestBody: null, pullRequestStage: null });
    expect(prCalls(w)).toHaveLength(0);
  });

  it("does not run, and says so, when the global limit is already spent", async () => {
    const clock = manualClock();
    const slow: AgentStep = async (call) => {
      clock.advance(100);
      return develop(call);
    };
    const { w, run } = await setup({
      now: clock.now,
      env: { FACTORY_TIMEOUTS_TOTAL: "100" },
      agent: { development: [slow] },
    });

    const result = await run();

    expect(result).toMatchObject({ reason: "time", pullRequestBody: null });
    expect(result.pullRequestStage).toMatchObject({ outcome: "skipped" });
    expect(prCalls(w)).toHaveLength(0);
  });

  it("cuts its timeout to what is left of the global limit", async () => {
    const clock = manualClock();
    const slow = (minutes: number, step: AgentStep): AgentStep => async (call) => {
      clock.advance(minutes);
      return step(call);
    };
    const { w, run } = await setup({
      now: clock.now,
      env: { FACTORY_TIMEOUTS_TOTAL: "100" },
      agent: { development: [slow(60, develop)], review: [slow(30, reviewOk)], "pull-request": [writes()] },
      verify: [{ ok: true }],
    });

    await run();

    expect(prCalls(w)[0]!.timeoutMs).toBe(10 * 60_000);
  });

  it("takes its model and timeout from repo variables", async () => {
    const { w, run } = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [writes()] },
      verify: [{ ok: true }],
      env: { FACTORY_MODELS_PULL_REQUEST: "claude-haiku-9", FACTORY_TIMEOUTS_PULL_REQUEST: "5" },
    });

    await run();

    expect(prCalls(w)[0]).toMatchObject({ model: "claude-haiku-9", timeoutMs: 5 * 60_000 });
  });

  it("leaves no body and a reason when the session never emits the block", async () => {
    const no: AgentStep = () => ({ output: "I wrote it above.", usage, resumes: [{ output: "no", usage }, { output: "still no", usage }] });
    const { w, run } = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [no] },
      verify: [{ ok: true }],
    });

    const result = await run();

    expect(result.outcome).toBe("ready");
    expect(result.pullRequestBody).toBeNull();
    expect(result.pullRequestStage).toMatchObject({ outcome: "failed", retries: 2, reason: expect.stringContaining("<pull-request>") });
    expect(result.usage.pullRequest).toEqual({ inputTokens: 6_000, outputTokens: 900 });
    expect(prCalls(w)[0]!.resumes).toHaveLength(2);
  });

  it("resumes the session to extract the body", async () => {
    const late: AgentStep = () => ({ output: "No block.", usage, resumes: [{ output: `<pull-request>${body}</pull-request>`, usage }] });
    const { run } = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [late] },
      verify: [{ ok: true }],
    });

    const result = await run();

    expect(result).toMatchObject({ pullRequestBody: body });
    expect(result.pullRequestStage.retries).toBe(1);
  });

  it("records a timeout, and a crash, as a failed Stage without body", async () => {
    const timesOut: AgentStep = () => ({ output: `<pull-request>${body}</pull-request>`, usage, timedOut: true });
    const { run } = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [timesOut] },
      verify: [{ ok: true }],
    });
    const result = await run();
    expect(result.pullRequestBody).toBeNull();
    expect(result.pullRequestStage).toMatchObject({ outcome: "timeout", reason: expect.stringContaining("15 min") });

    const crash = await setup({
      agent: { development: [develop], review: [reviewOk], "pull-request": [() => { throw new Error("sandbox died"); }] },
      verify: [{ ok: true }],
    });
    const crashed = await crash.run();
    expect(crashed.outcome).toBe("ready");
    expect(crashed.pullRequestStage).toMatchObject({ outcome: "failed", reason: "sandbox died" });
  });
});
