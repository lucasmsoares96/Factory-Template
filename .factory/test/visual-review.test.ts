import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { FakeSecretScanner } from "../src/adapters/fake/fake-secret-scanner.ts";
import { interfacePaths } from "../src/scope.ts";
import { checkout, commitFile, ISSUE_VERDICTS, lastJson, tempDir, unmarked, world, type WorldOptions } from "./helpers.ts";

const measurement = (name: string, width: number, findings: object[] = [], exceptions: object[] = []) => JSON.stringify({ name, width, height: 800, findings, exceptions });
const OVERLAP = { kind: "overlap", message: "Two elements cross.", elements: [{ role: "link", name: "New Company" }, { role: "heading", name: "Account" }] };
const EXCEPTION = { kind: "clipped-text", message: "The title is cut.", elements: [{ role: "heading", name: "Account" }], reason: "Cut with an ellipsis on purpose." };

/** Both sizes of one print, with the given findings at 1280 (and none at 390). */
const prints = (findings: object[] = [], exceptions: object[] = []) => [
  { product: "example", name: "home-1280.png" },
  { product: "example", name: "home-1280.json", content: measurement("home", 1280, findings, exceptions) },
  { product: "example", name: "home-390.png" },
  { product: "example", name: "home-390.json", content: measurement("home", 390) },
];

const developUi: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "apps/example/src/client/home.tsx", "export const Home = () => null;\n", "feat: show the home #7");
};
const developLogic: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "src/greet.ts", 'export const greet = () => "hi";\n', "feat: greet the user #7");
};
const visual = (summary = "Measured and looked.", inline: object[] = []): AgentStep => () => ({ output: `<visual-review>${JSON.stringify({ summary, inline })}</visual-review>` });
const fixes: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "apps/example/src/client/home.tsx", "export const Home = () => 1;\n", "fix: keep the link off the title #7");
  return { output: `<visual-review>${JSON.stringify({ summary: "Moved the link.", inline: [] })}</visual-review>` };
};
const review: AgentStep = () => ({ output: `<review>${JSON.stringify({ summary: "Reviewed.", inline: [], criteria: ISSUE_VERDICTS })}</review>` });
const writes: AgentStep = () => ({ output: "<pull-request>## Summary\n\nDone.\n\n## Merge Danger\n\n**Door:** two-way</pull-request>" });

async function run(options: { development: AgentStep; visualReview?: AgentStep[]; verify: WorldOptions["verify"]; env?: Record<string, string>; scanner?: FakeSecretScanner }) {
  const repo = await checkout();
  const out = await tempDir("factory-out-");
  const w = world({
    repo,
    agent: { development: [options.development], "visual-review": options.visualReview ?? [], review: [review], "pull-request": [writes] },
    verify: options.verify,
    ...(options.scanner ? { scanner: options.scanner } : {}),
    env: { FACTORY_MAX_ATTEMPTS: "1", ...options.env },
  });
  await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
  const code = await w.factory("work", "7", "--out", out, "--repo", repo);
  return { w, out, code, result: JSON.parse(await readFile(join(out, "result.json"), "utf8")) };
}

describe("which diffs go through the Visual Review", () => {
  it("takes a Product's or the Skeleton's client code, screens and styles", () => {
    expect(
      interfacePaths([
        "apps/example/src/client/main.tsx",
        "apps/example/src/client/styles.css",
        "apps/example/src/features/notes/routes/index.tsx",
        "apps/example/src/features/notes/public/share.tsx",
        "packages/skeleton/src/client/signed-in.tsx",
        "packages/skeleton/src/features/companies/members.tsx",
        "packages/skeleton/template/src/client/styles.css",
      ]),
    ).toHaveLength(7);
  });

  it("leaves out the worker, the schema, the tests and the harness", () => {
    expect(interfacePaths(["apps/example/src/worker.ts", "apps/example/src/features/notes/schema.ts", "apps/example/e2e/notes.spec.ts", "packages/skeleton/e2e/index.ts", "packages/skeleton/src/platform/app.ts", ".factory/src/prompts.ts", "src/greet.ts"])).toEqual([]);
  });
});

describe("factory work: the Visual Review", () => {
  it("runs Development → E2E → Visual Review → Review → E2E when the diff changes interface files", async () => {
    const { w, result, code } = await run({ development: developUi, visualReview: [visual()], verify: [{ ok: true, evidence: prints() }, { ok: true, evidence: prints() }] });

    expect(code).toBe(0);
    expect(w.agent.calls.map((c) => c.stage)).toEqual(["development", "visual-review", "review", "pull-request"]);
    expect(w.verify.runs).toBe(2);
    expect(result.outcome).toBe("ready");
    expect(result.attempts[0].stages.map((s: { stage: string; outcome: string }) => `${s.stage}:${s.outcome}`)).toEqual(["development:ok", "e2e:ok", "visual-review:ok", "review:ok", "e2e:ok"]);
    expect(result.visualReview).toMatchObject({ summary: "Measured and looked.", measurements: [{ name: "home-1280", findings: [] }, { name: "home-390", findings: [] }] });
    expect(w.agent.calls[2]!.prompt).toContain("A Visual Review ran before you");
  });

  it("gives the session the prints at both sizes, the measurements, the issue and the numbered criteria", async () => {
    const second = await run({ development: developUi, visualReview: [fixes], verify: [{ ok: true, evidence: prints([OVERLAP]) }, { ok: true, evidence: prints() }] });
    const prompt = second.w.agent.calls.find((c) => c.stage === "visual-review")!.prompt;
    expect(prompt).toContain("test-results/evidence/example/home-1280.png");
    expect(prompt).toContain("test-results/evidence/example/home-390.json");
    expect(prompt).toContain('overlap: Two elements cross. [link "New Company", heading "Account"]');
    expect(prompt).toContain("1. `greet()` returns a greeting.");
    expect(second.w.agent.calls.find((c) => c.stage === "visual-review")!.model).toBe("claude-sonnet-5-5");
  });

  it("skips the Visual Review, and the first E2E, when the diff changes no interface file", async () => {
    const { w, result } = await run({ development: developLogic, verify: [{ ok: true }] });

    expect(w.agent.calls.map((c) => c.stage)).toEqual(["development", "review", "pull-request"]);
    expect(w.verify.runs).toBe(1);
    expect(result.visualReview).toBeNull();
    expect(result.attempts[0].stages.map((s: { stage: string }) => s.stage)).toEqual(["development", "review", "e2e"]);
  });

  it("sends a failing first E2E back to Development without a Visual Review", async () => {
    const { w, result } = await run({ development: developUi, verify: [{ ok: false, failedCommand: "pnpm factory:verify", output: "1 failed" }] });

    expect(w.agent.calls.map((c) => c.stage)).toEqual(["development", "pull-request"]);
    expect(result.outcome).toBe("escalated");
    expect(result.attempts[0].stages.map((s: { stage: string; outcome: string }) => `${s.stage}:${s.outcome}`)).toEqual(["development:ok", "e2e:failed"]);
  });

  it("keeps the run from ready when a measured finding is neither fixed nor declared, and the Escalation names it", async () => {
    const { w, result } = await run({ development: developUi, visualReview: [visual()], verify: [{ ok: true, evidence: prints([OVERLAP]) }, { ok: true, evidence: prints([OVERLAP]) }] });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    expect(result.question).toContain("`example/home-1280` (1280px) overlap: Two elements cross. [link \"New Company\", heading \"Account\"]");
    expect(w.agent.calls.some((c) => c.stage === "visual-review")).toBe(true);
  });

  it("lets the run be ready when the finding is fixed, and shows the final measurements and the exceptions in the review", async () => {
    const repo = await checkout();
    const out = await tempDir("factory-out-");
    const w = world({
      repo,
      agent: { development: [developUi], "visual-review": [fixes], review: [review], "pull-request": [writes] },
      verify: [{ ok: true, evidence: prints([OVERLAP]) }, { ok: true, evidence: prints([], [EXCEPTION]) }],
      env: { FACTORY_MAX_ATTEMPTS: "1" },
    });
    expect(await w.factory("claim", "7")).toBe(0);
    const { startSha } = lastJson(w.logs) as { startSha: string | null };
    expect(await w.factory("work", "7", "--out", out, "--repo", repo)).toBe(0);
    const publishCheckout = await checkout();
    expect(await w.factory("publish", "7", "--repo", publishCheckout, "--in", out, "--start-sha", startSha ?? "")).toBe(0);

    const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
    expect(result.outcome).toBe("ready");
    expect(await readFile(join(out, "evidence/example/home-390.png"), "utf8")).toBe("png:example/home-390.png");
    expect(await readFile(join(out, "evidence/example/home-1280.png"), "utf8")).toBe("png:example/home-1280.png");
    const body = w.codeHost.prs[0]!.reviews.map((r) => r.body).join("\n");
    expect(unmarked(body)).toContain("## Visual Review");
    expect(unmarked(body)).toContain("Moved the link.");
    expect(unmarked(body)).toContain("Cut with an ellipsis on purpose.");
  });

  it("does not hold a run for a finding the test declared as an exception", async () => {
    const { result } = await run({ development: developUi, visualReview: [visual()], verify: [{ ok: true, evidence: prints([], [EXCEPTION]) }, { ok: true, evidence: prints([], [EXCEPTION]) }] });

    expect(result.outcome).toBe("ready");
    expect(result.visualReview.measurements[0].exceptions).toHaveLength(1);
  });

  it("takes the Visual Review's model and timeout from repo variables", async () => {
    const { w } = await run({ development: developUi, visualReview: [visual()], verify: [{ ok: true, evidence: prints() }, { ok: true, evidence: prints() }], env: { FACTORY_MODELS_VISUAL_REVIEW: "claude-opus-5-5", FACTORY_TIMEOUTS_VISUAL_REVIEW: "12" } });

    const call = w.agent.calls.find((c) => c.stage === "visual-review")!;
    expect([call.model, call.timeoutMs]).toEqual(["claude-opus-5-5", 12 * 60_000]);
  });
});

// The fake scanner treats this marker as the secret, so no test file holds anything that looks like one.
const LEAK = "LEAKY-VALUE";
const leakScanner = () => new FakeSecretScanner({ respond: ({ texts }) => texts.filter((t) => t.text.includes(LEAK)).map((t) => ({ source: t.name, line: 2, rule: "fake-rule" })) });
const block = (summary: string, inline: object[] = []) => `<visual-review>${JSON.stringify({ summary, inline })}</visual-review>`;

describe("factory work: the secret scan of the Visual Review", () => {
  it("resumes the session with the place and the rule, never the value, and goes on with the clean block", async () => {
    const { w, result } = await run({
      development: developUi,
      visualReview: [() => ({ output: block(`has ${LEAK}`), resumes: [{ output: block("clean summary") }] })],
      verify: [{ ok: true, evidence: prints() }, { ok: true, evidence: prints() }],
      scanner: leakScanner(),
    });

    const [call] = w.agent.calls.filter((c) => c.stage === "visual-review");
    expect(call!.resumes[0]).toContain("`visual review summary` line 2 (rule `fake-rule`)");
    expect(call!.resumes[0]).not.toContain(LEAK);
    expect(result).toMatchObject({ outcome: "ready", visualReview: { summary: "clean summary" } });
  });

  it("escalates when an inline comment is still dirty after the retries, and keeps the value out of the result", async () => {
    const dirty = { output: block("fine", [{ path: "apps/example/src/client/home.tsx", line: 1, body: `dirty ${LEAK}` }]) };
    const { w, result } = await run({
      development: developUi,
      visualReview: [() => ({ ...dirty, resumes: [dirty, dirty] })],
      verify: [{ ok: true, evidence: prints() }],
      scanner: leakScanner(),
    });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    expect(result.question).toContain("`visual review inline comment 1` line 2");
    expect(JSON.stringify(result)).not.toContain(LEAK);
    expect(w.agent.calls.some((c) => c.stage === "review")).toBe(false);
  });
});
