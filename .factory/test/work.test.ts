import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { cloneRepo, commitFile, createRepo, git, tempDir, world, type WorldOptions } from "./helpers.ts";

const develop: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "src/greet.ts", 'export const greet = () => "hi";\n', "feat: greet the user #7");
  return { output: "Done.", usage: { inputTokens: 5000, outputTokens: 700 } };
};

const reviewWithFix: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "src/greet.ts", 'export const greet = (): string => "hi";\n', "refactor: type greet #7");
  const review = { summary: "Added a return type.", inline: [{ path: "src/greet.ts", line: 1, body: "Typed." }] };
  return { output: `Reviewed.\n<review>${JSON.stringify(review)}</review>`, usage: { inputTokens: 3000, outputTokens: 300 } };
};

async function setup(agent: WorldOptions["agent"], verify: WorldOptions["verify"], env: Record<string, string> = {}) {
  const origin = await createRepo();
  const repo = await cloneRepo(origin);
  const out = await tempDir("factory-out-");
  const w = world({ repo, agent, verify, env });
  await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
  return { origin, repo, out, w, readResult: async () => JSON.parse(await readFile(join(out, "result.json"), "utf8")) };
}

describe("factory work", () => {
  it("runs Development → Review → E2E once and writes a ready result", async () => {
    const { repo, out, w, readResult } = await setup(
      { development: [develop], review: [reviewWithFix] },
      [{ ok: true, evidence: [{ product: "example", name: "home.png" }, { product: "admin", name: "login.png" }] }],
    );

    expect(await w.factory("work", "7", "--out", out, "--repo", repo)).toBe(0);

    const result = await readResult();
    expect(result).toMatchObject({
      issue: 7,
      outcome: "ready",
      reason: null,
      question: null,
      branch: "factory/issue-7",
      review: { summary: "Added a return type.", inline: [{ path: "src/greet.ts", line: 1, body: "Typed." }] },
      threadReplies: [],
      usage: {
        development: { inputTokens: 5000, outputTokens: 700 },
        review: { inputTokens: 3000, outputTokens: 300 },
      },
      evidence: [
        { product: "admin", name: "login.png" },
        { product: "example", name: "home.png" },
      ],
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].stages.map((s: { stage: string; outcome: string; commits?: number }) => [s.stage, s.outcome, s.commits])).toEqual([
      ["development", "ok", 1],
      ["review", "ok", 1],
      ["e2e", "ok", undefined],
    ]);
    expect(result.head).toBe(await git(repo, "rev-parse", "factory/issue-7"));
    expect(await readFile(join(out, "evidence/example/home.png"), "utf8")).toBe("png:example/home.png");
    expect(await readdir(join(out, "evidence/admin"))).toEqual(["login.png"]);
  });

  it("gives each Stage a fresh session with the configured model and timeout", async () => {
    const { repo, out, w } = await setup({ development: [develop], review: [reviewWithFix] }, [{ ok: true }]);

    await w.factory("work", "7", "--out", out, "--repo", repo);

    expect(w.agent.calls.map((c) => [c.stage, c.model, c.timeoutMs])).toEqual([
      ["development", "claude-opus-5-5", 60 * 60_000],
      ["review", "claude-opus-5-5", 30 * 60_000],
    ]);
    const [development, review] = w.agent.calls;
    expect(development!.prompt).toContain("Greet the user");
    expect(development!.prompt).toContain("`greet()` returns a greeting.");
    expect(review!.prompt).toContain("feat: greet the user #7");
    expect(w.verify.runs).toBe(1);
  });

  it("takes models and timeouts from repo variables", async () => {
    const { repo, out, w } = await setup({ development: [develop], review: [reviewWithFix] }, [{ ok: true }], {
      FACTORY_MODELS_REVIEW: "claude-sonnet-5-5",
      FACTORY_TIMEOUTS_DEVELOPMENT: "90",
    });

    await w.factory("work", "7", "--out", out, "--repo", repo);

    expect(w.agent.calls.map((c) => [c.stage, c.model, c.timeoutMs])).toEqual([
      ["development", "claude-opus-5-5", 90 * 60_000],
      ["review", "claude-sonnet-5-5", 30 * 60_000],
    ]);
  });

  it("rejects an invalid repo variable before doing anything", async () => {
    const { repo, out, w } = await setup({}, [], { FACTORY_MAX_ATTEMPTS: "five" });

    await expect(w.factory("work", "7", "--out", out, "--repo", repo)).rejects.toThrow(/FACTORY_MAX_ATTEMPTS/);
    expect(w.agent.calls).toEqual([]);
  });

  it("bundles the issue branch, built from main, for the publish job", async () => {
    const { origin, repo, out, w, readResult } = await setup(
      { development: [develop], review: [reviewWithFix] },
      [{ ok: true }],
    );

    await w.factory("work", "7", "--out", out, "--repo", repo);

    const publishCheckout = await cloneRepo(origin);
    await git(publishCheckout, "fetch", "--quiet", join(out, "branch.bundle"), "factory/issue-7:incoming");
    expect(await git(publishCheckout, "rev-parse", "incoming")).toBe((await readResult()).head);
    expect(await git(publishCheckout, "log", "--format=%s", "main..incoming")).toBe(
      "refactor: type greet #7\nfeat: greet the user #7",
    );
  });

  it("does not review or verify a Development session that made no commits", async () => {
    const { repo, out, w, readResult } = await setup(
      { development: [() => ({ output: "I looked around." }), develop], review: [reviewWithFix] },
      [{ ok: true }],
    );

    await w.factory("work", "7", "--out", out, "--repo", repo);

    const result = await readResult();
    expect(result.outcome).toBe("ready");
    expect(result.attempts.map((a: { stages: { stage: string; outcome: string }[] }) => a.stages.map((s) => `${s.stage}:${s.outcome}`))).toEqual([
      ["development:no-commits"],
      ["development:ok", "review:ok", "e2e:ok"],
    ]);
    expect(w.agent.calls.map((c) => c.stage)).toEqual(["development", "development", "review"]);
    expect(w.agent.calls[1]!.prompt).toContain("made no commits");
    expect(w.verify.runs).toBe(1);
  });
});
