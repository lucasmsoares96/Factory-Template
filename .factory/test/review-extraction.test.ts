import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { checkout, commitFile, tempDir, world, type WorldOptions } from "./helpers.ts";

let edits = 0;
const develop: AgentStep = async ({ cwd }) => {
  edits++;
  await commitFile(cwd, "src/greet.ts", `export const greet = () => "hi ${edits}";\n`, `feat: greet the user #7 (${edits})`);
  return { usage: { inputTokens: 10_000, outputTokens: 1_000 } };
};

const block = (summary: string) => `<review>${JSON.stringify({ summary, inline: [] })}</review>`;
const usage = { inputTokens: 2_000, outputTokens: 200 };

async function setup(review: AgentStep) {
  const repo = await checkout();
  const out = await tempDir("factory-out-");
  const options: Pick<WorldOptions, "agent" | "verify"> = { agent: { development: [develop, develop], review: [review, () => ({ output: block("second"), usage })] }, verify: [{ ok: true }] };
  const w = world({ repo, ...options });
  await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
  expect(await w.factory("work", "7", "--out", out, "--repo", repo)).toBe(0);
  const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
  return { w, result };
}

const reviewCalls = (w: Awaited<ReturnType<typeof setup>>["w"]) => w.agent.calls.filter((c) => c.stage === "review");

describe("Review block extraction", () => {
  it("does not resume a session whose message has a valid block", async () => {
    const { w, result } = await setup(() => ({ output: block("ok"), usage }));

    expect(result.review.summary).toBe("ok");
    expect(reviewCalls(w)[0]!.resumes).toEqual([]);
    expect(result.attempts[0].stages.find((s: { stage: string }) => s.stage === "review").retries).toBe(0);
  });

  it.each([1, 2])("resumes the session and takes the block it re-emits, on resume %i", async (n) => {
    const invalid = { output: "Here it is: <review>{oops</review>", usage };
    const { w, result } = await setup(() => ({
      output: "Looks fine to me.",
      usage,
      resumes: [...Array(n - 1).fill(invalid), { output: block(`after ${n}`), usage }],
    }));

    expect(result.review.summary).toBe(`after ${n}`);
    expect(reviewCalls(w)[0]!.resumes).toHaveLength(n);
    expect(reviewCalls(w)[0]!.resumes[0]).toMatch(/<review>/);
    expect(result.attempts[0].stages.find((s: { stage: string }) => s.stage === "review").retries).toBe(n);
  });

  it("falls back to the raw message after 2 resumes, and does not resume a third time", async () => {
    const invalid = { output: "still no block", usage };
    const { w, result } = await setup(() => ({ output: "Looks fine to me.", usage, resumes: [invalid, invalid, { output: block("late"), usage }] }));

    expect(result.review.summary).toBe("Looks fine to me.");
    expect(reviewCalls(w)[0]!.resumes).toHaveLength(2);
  });

  it("adds the tokens of every resume to the Review usage", async () => {
    const { result } = await setup(() => ({
      output: "no block",
      usage,
      resumes: [{ output: "no", usage }, { output: block("ok"), usage }],
    }));

    expect(result.usage.review).toEqual({ inputTokens: 6_000, outputTokens: 600 });
  });

  it("keeps the Stage timeout: a resume that times out ends the Review as a timeout", async () => {
    const { w, result } = await setup(() => ({ output: "no block", usage, resumes: [{ output: "", usage, timedOut: true }] }));

    expect(result.attempts[0].stages.map((s: { stage: string; outcome: string }) => `${s.stage}:${s.outcome}`)).toEqual([
      "development:ok",
      "review:timeout",
    ]);
    expect(reviewCalls(w)[0]!.resumes).toHaveLength(1);
  });
});
