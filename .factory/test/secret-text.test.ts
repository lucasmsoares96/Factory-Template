import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { FakeSecretScanner } from "../src/adapters/fake/fake-secret-scanner.ts";
import { checkout, commitFile, tempDir, world, ISSUE_VERDICTS } from "./helpers.ts";

// The fake scanner treats this marker as the secret, so no test file holds anything that looks like one.
const LEAK = "LEAKY-VALUE";
const scanner = () =>
  new FakeSecretScanner({
    respond: ({ head, texts }) => [
      ...(head ? texts.filter((t) => t.name === "commit messages" && t.text.includes(LEAK)).map(() => ({ source: "commit messages", line: 1, rule: "fake-rule" })) : []),
      ...texts.filter((t) => t.name !== "commit messages" && t.text.includes(LEAK)).map((t) => ({ source: t.name, line: 2, rule: "fake-rule" })),
    ],
  });

const develop = (message = "feat: greet the user #7"): AgentStep => async ({ cwd }) => {
  await commitFile(cwd, "src/greet.ts", 'export const greet = () => "hi";\n', message);
  return {};
};
const review = (summary: string): string => `<review>${JSON.stringify({ summary, inline: [], criteria: ISSUE_VERDICTS })}</review>`;
const pr = (text: string): string => `Done.\n<pull-request>${text}</pull-request>`;
const clean = "## Summary\n\nA database address with a password, built from variables.";

async function run(script: NonNullable<Parameters<typeof world>[0]>["agent"], options: { scan?: FakeSecretScanner } = {}) {
  const repo = await checkout();
  const out = await tempDir("factory-out-");
  const w = world({ repo, agent: script, verify: [{ ok: true }], scanner: options.scan ?? scanner() });
  await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
  expect(await w.factory("work", "7", "--out", out, "--repo", repo)).toBe(0);
  const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
  return { w, result };
}
const calls = (w: Awaited<ReturnType<typeof run>>["w"], stage: string) => w.agent.calls.filter((c) => c.stage === stage);

describe("secret scan of the texts, inside the work job", () => {
  it("resumes the Pull Request session with the place and the rule, never the value, and publishes the clean body", async () => {
    const { w, result } = await run({
      development: [develop()],
      review: [() => ({ output: review("ok") })],
      "pull-request": [() => ({ output: pr(`before ${LEAK} after`), resumes: [{ output: pr(clean) }] })],
    });

    const [call] = calls(w, "pull-request");
    expect(call!.resumes).toHaveLength(1);
    expect(call!.resumes[0]).toContain("`pull request body` line 2 (rule `fake-rule`)");
    expect(call!.resumes[0]).not.toContain(LEAK);
    expect(result).toMatchObject({ outcome: "ready", pullRequestBody: clean, pullRequestStage: { outcome: "ok", retries: 1 } });
  });

  it("escalates needs-human without the value when the body is still dirty after the retries", async () => {
    const dirty = { output: pr(`still ${LEAK}`) };
    const { result } = await run({
      development: [develop()],
      review: [() => ({ output: review("ok") })],
      "pull-request": [() => ({ output: pr(`first ${LEAK}`), resumes: [dirty, dirty] })],
    });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human", pullRequestBody: null, pullRequestStage: { outcome: "failed", retries: 2 } });
    expect(result.question).toContain("`pull request body` line 2");
    expect(JSON.stringify(result)).not.toContain(LEAK);
  });

  it("resumes the Review session for a secret in the summary, then goes on with the clean block", async () => {
    const { w, result } = await run({
      development: [develop()],
      review: [() => ({ output: review(`has ${LEAK}`), resumes: [{ output: review("clean summary") }] })],
      "pull-request": [() => ({ output: pr(clean) })],
    });

    expect(calls(w, "review")[0]!.resumes[0]).toContain("`review summary` line 2");
    expect(calls(w, "review")[0]!.resumes[0]).not.toContain(LEAK);
    expect(result).toMatchObject({ outcome: "ready", review: { summary: "clean summary" } });
  });

  it("escalates when the Review text is still dirty, and keeps the value out of the result", async () => {
    const dirty = { output: review(`dirty ${LEAK}`) };
    const { result } = await run({
      development: [develop()],
      review: [() => ({ output: review(`dirty ${LEAK}`), resumes: [dirty, dirty] })],
      "pull-request": [() => ({ output: pr(clean) })],
    });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    expect(JSON.stringify(result)).not.toContain(LEAK);
  });

  it("escalates straight away on a secret in a commit message: no session is asked again", async () => {
    const { w, result } = await run({
      development: [develop(`feat: greet ${LEAK} #7`)],
      review: [() => ({ output: review("ok") })],
      "pull-request": [() => ({ output: pr(clean) })],
    });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human", pullRequestStage: null });
    expect(result.question).toContain("`commit messages`");
    expect(calls(w, "pull-request")).toHaveLength(0);
    expect(w.agent.calls.every((c) => c.resumes.length === 0)).toBe(true);
  });
});
