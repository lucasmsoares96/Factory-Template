import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { cloneRepo, commitFile, createRepo, git, manualClock, tempDir, world, type WorldOptions } from "./helpers.ts";

let edits = 0;
/** A Development session that commits one change. */
const develop: AgentStep = async ({ cwd }) => {
  edits++;
  await commitFile(cwd, "src/greet.ts", `export const greet = () => "hi ${edits}";\n`, `feat: greet the user #7 (${edits})`);
  return { usage: { inputTokens: 10_000, outputTokens: 1_000 } };
};

const reviewSays =
  (summary: string, inline: { path: string; line: number; body: string }[] = []): AgentStep =>
  () => ({ output: `<review>${JSON.stringify({ summary, inline })}</review>`, usage: { inputTokens: 5_000, outputTokens: 500 } });

const e2eFails = { ok: false, failedCommand: "pnpm --filter example test:e2e", output: "boom" };

async function setup(options: Pick<WorldOptions, "agent" | "verify" | "env" | "now">) {
  const repo = await cloneRepo(await createRepo());
  const out = await tempDir("factory-out-");
  const w = world({ repo, ...options });
  await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
  const run = async () => {
    expect(await w.factory("work", "7", "--out", out, "--repo", repo)).toBe(0);
    return JSON.parse(await readFile(join(out, "result.json"), "utf8"));
  };
  return { repo, out, w, run };
}

type Attempt = { stages: { stage: string; outcome: string; output?: string; failedCommand?: string | null }[] };
const outline = (result: { attempts: Attempt[] }) =>
  result.attempts.map((a) => a.stages.map((s) => `${s.stage}:${s.outcome}`).join(" "));

describe("factory work, when things go wrong", () => {
  it("sends an E2E failure back to Development with the failed command and the tail of its output", async () => {
    const output = `HEAD-OF-LOG\n${"x".repeat(10_000)}\nexpected 200, got 500`;
    const { w, run } = await setup({
      agent: { development: [develop, develop], review: [reviewSays("ok"), reviewSays("ok")] },
      verify: [{ ...e2eFails, output }, { ok: true }],
    });

    const result = await run();

    expect(result.outcome).toBe("ready");
    expect(outline(result)).toEqual(["development:ok review:ok e2e:failed", "development:ok review:ok e2e:ok"]);
    const retry = w.agent.calls.filter((c) => c.stage === "development")[1]!.prompt;
    expect(retry).toContain("pnpm --filter example test:e2e");
    expect(retry).toContain("expected 200, got 500");
    expect(retry).not.toContain("HEAD-OF-LOG");
    const failed = result.attempts[0].stages[2];
    expect(failed.failedCommand).toBe("pnpm --filter example test:e2e");
    expect(failed.output.length).toBeLessThan(output.length);
  });

  it("escalates after five failed attempts", async () => {
    const { w, run } = await setup({
      agent: { development: Array(5).fill(develop), review: Array(5).fill(reviewSays("ok")) },
      verify: Array(5).fill(e2eFails),
    });

    const result = await run();

    expect(result).toMatchObject({ outcome: "escalated", reason: "e2e-failures", question: null });
    expect(result.attempts).toHaveLength(5);
    expect(w.verify.runs).toBe(5);
    expect(result.head).not.toBeNull();
  });

  it("respects a lower attempt limit from a repo variable", async () => {
    const { run } = await setup({
      agent: { development: [develop, develop], review: [reviewSays("ok"), reviewSays("ok")] },
      verify: [e2eFails, e2eFails],
      env: { FACTORY_MAX_ATTEMPTS: "2" },
    });

    expect((await run()).attempts).toHaveLength(2);
  });

  it("counts a Stage timeout as a failed attempt", async () => {
    const timesOut: AgentStep = async (call) => ({ ...(await develop(call)), timedOut: true, output: "still typing" });
    const { w, run } = await setup({
      agent: { development: [timesOut, develop, develop], review: [reviewSays("ok"), reviewSays("ok")] },
      verify: [{ timedOut: true, output: "hung" }, { ok: true }],
    });

    const result = await run();

    expect(outline(result)).toEqual([
      "development:timeout",
      "development:ok review:ok e2e:timeout",
      "development:ok review:ok e2e:ok",
    ]);
    const prompts = w.agent.calls.filter((c) => c.stage === "development").map((c) => c.prompt);
    expect(prompts[1]).toMatch(/Development session timed out after 60 min/);
    expect(prompts[2]).toMatch(/E2E timed out after 20 min/);
    expect(result.outcome).toBe("ready");
  });

  it("escalates with reason time at the global ceiling, shortening the last Stage to fit", async () => {
    const clock = manualClock();
    const slow =
      (minutes: number, step: AgentStep): AgentStep =>
      async (call) => {
        clock.advance(minutes);
        return step(call);
      };
    const { w, run } = await setup({
      now: clock.now,
      env: { FACTORY_TIMEOUTS_TOTAL: "100" },
      agent: {
        development: [slow(60, develop), slow(10, () => ({ timedOut: true }))],
        review: [slow(30, reviewSays("ok"))],
      },
      verify: [e2eFails],
    });

    const result = await run();

    expect(result).toMatchObject({ outcome: "escalated", reason: "time" });
    expect(outline(result)).toEqual(["development:ok review:ok e2e:failed", "development:timeout"]);
    expect(w.agent.calls.map((c) => c.timeoutMs)).toEqual([60 * 60_000, 30 * 60_000, 10 * 60_000]);
  });

  it("escalates at once when Development needs a human, without commits", async () => {
    const asks: AgentStep = () => ({ output: "I cannot pick.\n<needs-human>Should greet() use the user's locale?</needs-human>" });
    const { w, run } = await setup({ agent: { development: [asks] } });

    const result = await run();

    expect(result).toMatchObject({
      outcome: "escalated",
      reason: "needs-human",
      question: "Should greet() use the user's locale?",
      head: null,
    });
    expect(outline(result)).toEqual(["development:needs-human"]);
    expect(w.verify.runs).toBe(0);
  });

  it("keeps the commits of a Development session that needs a human", async () => {
    const asks: AgentStep = async (call) => ({ ...(await develop(call)), output: "<needs-human>Which copy?</needs-human>" });
    const { repo, run } = await setup({ agent: { development: [asks] } });

    const result = await run();

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human", question: "Which copy?" });
    expect(result.head).toBe(await git(repo, "rev-parse", "factory/issue-7"));
  });

  it("reviews only what changed since the last reviewed commit, and summarises every attempt", async () => {
    const finding = { path: "src/greet.ts", line: 1, body: "Name the greeting." };
    const { repo, w, run } = await setup({
      agent: {
        development: [develop, develop],
        review: [
          async (call) => {
            await commitFile(call.cwd, "src/greet.ts", 'export const greet = (): string => "hi";\n', "refactor: type greet #7");
            return reviewSays("Typed greet().", [finding])(call);
          },
          reviewSays("Checked the earlier finding; fixed."),
        ],
      },
      verify: [e2eFails, { ok: true }],
    });

    const result = await run();

    const reviewedHead = await git(repo, "log", "--format=%H", "--grep=refactor: type greet", "factory/issue-7");
    const [first, second] = w.agent.calls.filter((c) => c.stage === "review").map((c) => c.prompt);
    expect(first).toContain("Review the whole branch");
    expect(second).toContain(`only what changed since ${reviewedHead}`);
    expect(second).toContain("Name the greeting.");
    expect(result.review.summary).toMatch(/Attempt 1[\s\S]*Typed greet\(\)\.[\s\S]*Attempt 2[\s\S]*Checked the earlier finding; fixed\./);
    expect(result.review.inline).toEqual([finding]);
  });

  it("writes one line per attempt and Stage, with tokens and estimated cost, to the job summary", async () => {
    const summary = join(await tempDir("factory-summary-"), "summary.md");
    const { run } = await setup({
      agent: { development: [develop, develop], review: [reviewSays("ok"), reviewSays("ok")] },
      verify: [e2eFails, { ok: true }],
      env: { GITHUB_STEP_SUMMARY: summary },
    });

    await run();

    const text = await readFile(summary, "utf8");
    const rows = text.split("\n").filter((l) => /^\| \d /.test(l));
    expect(rows.map((r) => r.split("|").slice(1, 4).map((c) => c.trim()))).toEqual([
      ["1", "Development", "ok"],
      ["1", "Review", "ok"],
      ["1", "E2E", "failed: `pnpm --filter example test:e2e`"],
      ["2", "Development", "ok"],
      ["2", "Review", "ok"],
      ["2", "E2E", "ok"],
    ]);
    // 2 × (10k + 5k) input at $4/MTok + 2 × (1k + 500) output at $20/MTok = $0.12 + $0.06.
    expect(text).toContain("Tokens: 30,000 in / 3,000 out. Estimated cost: $0.18.");
  });
});
