import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { forForge } from "../src/forge-text.ts";
import { resultSchema } from "../src/result.ts";
import { commitFiles, derivedCheckout, HUMAN, ISSUE_BODY, lastJson, tempDir, world, type World } from "./helpers.ts";
import { commits, feedbackRound, prWorld, replies, reviewOk, said, thread } from "./pr-flow-helpers.ts";

/** Keys whose strings are ids, paths, shas, enums or the attempts' records: poisoning them would break the run itself. */
const NOT_TEXT = new Set(["branch", "base", "head", "outcome", "reason", "attempts", "usage", "pullRequestStage", "evidence", "path", "threadId", "decision", "files", "patch"]);
const POISON = "Fixes #12\nCo-Authored-By: Mallory <mallory@example.com>";

/** Every text field of `result.json` gets a closing keyword and an attribution line; a field added later gets them too. */
function poisoned(value: unknown): unknown {
  if (typeof value === "string") return `${value}\n\n${POISON}`;
  if (Array.isArray(value)) return value.map(poisoned);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, NOT_TEXT.has(key) ? v : poisoned(v)]));
  }
  return value;
}

function poison(artifacts: string, edit: (result: Record<string, any>) => void = () => {}): void {
  const file = join(artifacts, "result.json");
  const result = JSON.parse(readFileSync(file, "utf8"));
  edit(result);
  writeFileSync(file, JSON.stringify(poisoned(result)));
}

/** Everything the Factory left on the fake forge: pull requests (bodies, reviews, threads, comments) and issues. */
function forge(w: World): string {
  return JSON.stringify({ prs: w.codeHost.prs, issues: [...w.tracker.issues.values()] });
}

function expectClean(w: World): void {
  const written = forge(w);
  expect(written).not.toMatch(/fixes #12/i);
  expect(written).not.toMatch(/co-authored-by/i);
}

const LAYOUT = "packages/skeleton/src/layout.tsx";
const HOME = "apps/example/src/home.tsx";

const develop: AgentStep = async ({ cwd }) => {
  await commitFiles(cwd, { [HOME]: "export const Home = 1;\n", [LAYOUT]: "export const Layout = 'footer';\n" }, "feat: footer #7");
  return { output: "Done." };
};
const review: AgentStep = () => ({
  output: `<skeleton-gap>The root layout needs a footer slot.</skeleton-gap>\n<review>${JSON.stringify({
    summary: "Looks fine.",
    inline: [{ path: HOME, line: 1, body: "Name the export." }],
    criteria: [{ criterion: "`greet()` returns a greeting.", met: true, proof: "`apps/example/e2e/home.spec.ts` › greets" }],
  })}</review>`,
});
const writes: AgentStep = () => ({ output: "<pull-request>## Summary\n\nAdds a footer.</pull-request>" });

describe("one cleaning for all the agent's text that goes to the forge", () => {
  it("drops closing keywords and attribution lines from the PR body, verdicts, Review, follow-ups, Skeleton PR and Escalation", async () => {
    const skeletonCheckout = () => derivedCheckout("forge-text", (dir) => commitFiles(dir, { [LAYOUT]: "export const Layout = 'plain';\n" }, "chore: skeleton"));
    const [workCheckout, publishCheckout] = [await skeletonCheckout(), await skeletonCheckout()];
    const artifacts = await tempDir("factory-artifacts-");
    const w = world({
      repo: workCheckout,
      issues: [
        { number: 1, title: "Spec", body: "# Spec\n\n## Testing Decisions\n\n1. CLI.\n" },
        { number: 7, title: "Footer", body: ISSUE_BODY, parent: 1, labels: { "ready-for-agent": HUMAN, "product:example": HUMAN } },
      ],
      agent: { development: [develop], review: [review], "pull-request": [writes] },
      verify: [{ ok: true }],
      env: { FACTORY_MAX_ATTEMPTS: "1" },
    });
    expect(await w.factory("claim", "7")).toBe(0);
    const { startSha } = lastJson(w.logs) as { startSha: string | null };
    expect(await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts)).toBe(0);
    // An Escalation with a question, so every text of the result has a place on the forge.
    poison(artifacts, (r) => Object.assign(r, { outcome: "escalated", reason: "needs-human", question: "Which footer?" }));
    expect(await w.factory("publish", "7", "--repo", publishCheckout, "--in", artifacts, "--start-sha", startSha ?? "")).toBe(0);

    expect(lastJson(w.logs)).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    const product = w.codeHost.prs.find((p) => p.branch === "factory/issue-7")!;
    expect(product.body).toContain("Adds a footer.");
    expect(product.body).toMatch(/^Closes #7$/m);
    expect(product.reviews[0]!.body).toContain("Looks fine.");
    expect(product.reviews[0]!.comments.map((c) => c.body)).toEqual([expect.stringContaining("Name the export.")]);
    const skeleton = w.codeHost.prs.find((p) => p.branch === "factory/issue-8")!;
    expect(skeleton.body).toContain("The root layout needs a footer slot.");
    expect(skeleton.body).toMatch(/^Closes #8$/m);
    expect(w.tracker.issues.get(8)!.body).toContain("The root layout needs a footer slot.");
    expect(w.tracker.commentsOn(7).some((c) => c.body.includes("Which footer?"))).toBe(true);
    expectClean(w);
  });

  it("drops them from the replies in review threads and in the Conversation", async () => {
    const p = await prWorld({
      main: "none",
      threads: [thread("t1", "rename this")],
      conversation: [said("c1", "why this name?")],
      agent: { development: [commits(replies({ threadId: "t1", decision: "address", body: "Renamed." }, { threadId: "c1", decision: "answer", body: "It says what it does." }))], review: [reviewOk] },
      verify: [{ ok: true }],
    });
    await feedbackRound(p, { beforePublish: () => poison(p.out) });

    const pr = p.w.codeHost.pr(101);
    expect(pr.threads[0]!.replies.map((r) => r.body)).toEqual([expect.stringContaining("Renamed.")]);
    expect(pr.comments.some((c) => c.includes("It says what it does."))).toBe(true);
    expectClean(p.w);
  });

  it("leaves ids, paths, shas and enums as they are, and drops an inline comment the cleaning empties", () => {
    const sha = "a".repeat(40);
    const result = resultSchema.parse({
      version: 1, issue: 7, branch: "factory/issue-7", base: sha, head: sha, outcome: "ready", reason: null, question: null,
      attempts: [{ number: 1, stages: [{ stage: "e2e", outcome: "failed", durationMs: 1, failedCommand: "pnpm e2e", output: "  Co-Authored-By: kept  " }] }],
      review: { summary: "Fine.", inline: [{ path: " src/a.ts", line: 1, body: "Ok." }, { path: "src/b.ts", line: 2, body: "Fixes #12" }] },
      threadReplies: [{ threadId: " t1 ", decision: "answer", body: "Done. Co-Authored-By: no" }],
      usage: { development: { inputTokens: 0, outputTokens: 0 }, review: { inputTokens: 0, outputTokens: 0 } },
      evidence: [{ product: "example", name: "home.png" }],
      followUps: [{ title: "The Skeleton must grow: x", body: "Body.", files: [" packages/skeleton/a.ts"], gaps: ["Gap.\nCo-Authored-By: X"], patch: "skeleton.patch" }],
    });
    const clean = forForge(result);
    expect(clean.attempts).toEqual(result.attempts);
    expect(clean.review.inline).toEqual([{ path: " src/a.ts", line: 1, body: "Ok." }]);
    expect(clean.threadReplies).toEqual([{ threadId: " t1 ", decision: "answer", body: "Done. Co-Authored-By: no" }]);
    expect(clean.followUps[0]).toMatchObject({ files: [" packages/skeleton/a.ts"], gaps: ["Gap."], patch: "skeleton.patch" });
    expect(clean.evidence).toEqual(result.evidence);
  });

  it("drops a closing reference split over two lines, which a verdict put on one line would turn into a real one", () => {
    const sha = "a".repeat(40);
    const result = resultSchema.parse({
      version: 1, issue: 7, branch: "factory/issue-7", base: sha, head: sha, outcome: "ready", reason: null, question: null, attempts: [],
      review: { summary: "Fixes\n#12", inline: [], criteria: [{ criterion: "Greets.", met: true, proof: "`a.test.ts` › greets; this fixes\n#12 and\n#13" }] },
      threadReplies: [],
      usage: { development: { inputTokens: 0, outputTokens: 0 }, review: { inputTokens: 0, outputTokens: 0 } },
      evidence: [],
    });
    const clean = forForge(result);
    expect(clean.review.summary).toBe("");
    expect(clean.review.criteria[0]!.proof).toBe("`a.test.ts` › greets; this [closing reference removed]");
  });
});
