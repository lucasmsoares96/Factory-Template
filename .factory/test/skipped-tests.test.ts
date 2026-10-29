import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { addedSkippedTests } from "../src/skipped-tests.ts";
import { Git } from "../src/git.ts";
import { checkout, commitFile, commitFiles, tempDir, world } from "./helpers.ts";

const SPEC = "apps/example/e2e/sign-in.spec.ts";
const skipped = (line: string): AgentStep => async ({ cwd }) => {
  await commitFile(cwd, SPEC, `import { test } from "@playwright/test";\n\n${line}\n`, "test: sign-in tagline link #7");
  return { output: "Done." };
};
const review: AgentStep = () => ({ output: `Reviewed.\n<review>${JSON.stringify({ summary: "ok", inline: [] })}</review>` });

async function run(development: AgentStep[], env: Record<string, string> = {}) {
  const repo = await checkout();
  const out = await tempDir("factory-out-");
  const w = world({ repo, agent: { development, review: development.map(() => review) }, env, verify: development.map(() => ({ ok: true })) });
  await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
  await w.factory("work", "7", "--out", out, "--repo", repo);
  return { w, result: JSON.parse(await readFile(join(out, "result.json"), "utf8")) };
}

describe("skipped or focused tests added by Development", () => {
  it("fails the attempt even though E2E would be green, and feeds back the file and line", async () => {
    const good: AgentStep = async ({ cwd }) => {
      await commitFile(cwd, SPEC, 'import { test } from "@playwright/test";\n\ntest("links", async () => {});\n', "test: link #7");
    };
    const { w, result } = await run([skipped('test.fixme("tagline links to sign-up", async () => {});'), good]);

    expect(result.outcome).toBe("ready");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].stages.map((s: { stage: string; outcome: string }) => [s.stage, s.outcome])).toEqual([["development", "failed"]]);
    expect(w.verify.runs).toBe(1);
    const second = w.agent.calls.filter((c) => c.stage === "development")[1]!.prompt;
    expect(second).toContain(`${SPEC}:3`);
    expect(second).toContain("test.fixme");
    expect(second).toContain("skipped or focused test proves nothing");
  });

  it("escalates as needs-human, saying so, when the attempts run out", async () => {
    const { result } = await run([skipped('test.skip("a", () => {});'), skipped('test.only("a", () => {});')], { FACTORY_MAX_ATTEMPTS: "2" });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    expect(result.question).toContain("skipped or focused");
    expect(result.question).toContain(SPEC);
  });
});

describe("addedSkippedTests", () => {
  async function added(files: Record<string, string>, base: Record<string, string> = {}): Promise<string[]> {
    const repo = await checkout();
    if (Object.keys(base).length > 0) await commitFiles(repo, base, "base");
    const git = new Git(repo);
    const start = await git.head();
    await commitFiles(repo, files, "change");
    return (await addedSkippedTests(git, start)).map((s) => `${s.path}:${s.line}`);
  }

  it.each([
    "test.fixme(", "test.skip(", "it.skip(", "describe.skip(", "test.only(", "it.only(", "describe.only(", "xit(", "xdescribe(", "test.describe.skip(", "test.describe.fixme(", "test.describe.only(", "test.describe.serial.only(",
  ])("flags %s", async (call) => {
    expect(await added({ "src/a.test.ts": `${call}"x", () => {});\n` })).toEqual(["src/a.test.ts:1"]);
  });

  it("looks only at test files and e2e dirs", async () => {
    expect(await added({ "src/a.ts": "test.skip();\n", "e2e/b.ts": "test.skip();\n", "src/c.test.tsx": "it.skip();\n", "src/d.spec.ts": "describe.only();\n" })).toEqual([
      "e2e/b.ts:1", "src/c.test.tsx:1", "src/d.spec.ts:1",
    ]);
  });

  it("ignores removed skips, comments and strings", async () => {
    const base = { "src/a.test.ts": "test.skip('old', () => {});\nkeep();\n" };
    const files = { "src/a.test.ts": "keep();\n// test.skip is not allowed\n/* it.only */\n * test.fixme\nconst m = 'use test.skip here';\nconst n = `it.only`;\nit('x', () => {});\n" };
    expect(await added(files, base)).toEqual([]);
  });

  it("reports the line number in the new file", async () => {
    expect(await added({ "src/a.test.ts": "a();\nb();\ntest.skip('x', () => {});\n" })).toEqual(["src/a.test.ts:3"]);
  });
});
