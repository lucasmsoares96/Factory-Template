import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import type { VerifyStep } from "../src/adapters/fake/fake-verify.ts";
import { checkout, commitFile, lastJson, OWNER, tempDir, unmarked, world, type WorldOptions } from "./helpers.ts";

const OLD_SHA = "0123456789abcdef0123456789abcdef01234567";
const text = "## Summary\n\n```text\ngreet\n```\n\n## Merge Danger\n\n**Door:** two-way";
const stageUsage = { inputTokens: 2_000, outputTokens: 300 };

const developFile = (path: string): AgentStep => async ({ cwd }) => {
  await commitFile(cwd, path, "export {};\n", `feat: touch ${path} #7`);
  return { usage: { inputTokens: 10_000, outputTokens: 1_000 } };
};
const review: AgentStep = () => ({
  output: `<review>${JSON.stringify({ summary: "Reviewed.", inline: [] })}</review>`,
  usage: { inputTokens: 5_000, outputTokens: 500 },
});
const writes = (body = text): AgentStep => () => ({ output: `<pull-request>${body}</pull-request>`, usage: stageUsage });
const noBlock: AgentStep = () => ({ output: "nothing", usage: stageUsage, resumes: [{ output: "no", usage: stageUsage }, { output: "no", usage: stageUsage }] });
const e2eFails: VerifyStep = { ok: false, failedCommand: "pnpm test:e2e", output: "boom" };

async function pipeline(
  options: Pick<WorldOptions, "agent" | "verify" | "branches" | "prs" | "env"> & { publishArgs?: string[]; edit?: (result: Record<string, unknown>) => void },
) {
  const workCheckout = await checkout();
  const publishCheckout = await checkout();
  const artifacts = await tempDir("factory-artifacts-");
  const w = world({ repo: workCheckout, ...options });
  let startSha: string | null = null;
  if (options.publishArgs) {
    await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
    startSha = await w.codeHost.branchHead("factory/issue-7");
  } else {
    expect(await w.factory("claim", "7")).toBe(0);
    startSha = (lastJson(w.logs) as { startSha: string | null }).startSha;
  }
  expect(await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts)).toBe(0);
  if (options.edit) {
    const file = join(artifacts, "result.json");
    const result = JSON.parse(await readFile(file, "utf8"));
    options.edit(result);
    await writeFile(file, JSON.stringify(result));
  }
  expect(await w.factory("publish", "7", "--repo", publishCheckout, "--in", artifacts, "--start-sha", startSha ?? "", ...(options.publishArgs ?? []))).toBe(0);
  const comments = () => w.tracker.commentsOn(7).filter((c) => c.author === OWNER).map((c) => c.body);
  return { w, comments };
}

const ready = (pullRequest: AgentStep, file = "src/greet.ts") => ({
  agent: { development: [developFile(file)], review: [review], "pull-request": [pullRequest] },
  verify: [{ ok: true }],
});

describe("pull request body assembled by publish", () => {
  it("puts the Stage text between the warnings and Closes #N", async () => {
    const { w } = await pipeline({ ...ready(writes(), "AGENTS.md"), edit: (r) => (r.followUps = [{ title: "Add a footer slot", body: "b", files: [] }]) });

    const body = unmarked(w.codeHost.prs[0]!.body);
    expect(body.indexOf("[!CAUTION]")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("[!CAUTION]")).toBeLessThan(body.indexOf("[!NOTE]"));
    expect(body.indexOf("[!NOTE]")).toBeLessThan(body.indexOf("## Summary"));
    expect(body.indexOf("## Merge Danger")).toBeLessThan(body.indexOf("Closes #7"));
    expect(body.trimEnd().endsWith("Closes #7")).toBe(true);
    expect(body).not.toContain("Implemented by the Factory");
    expect(body.match(/Add a footer slot/g)).toHaveLength(1);
  });

  it("drops a closing keyword the agent wrote for any issue", async () => {
    const { w } = await pipeline(ready(writes(`${text}\n\nCloses #99\nfixes owner/repo#12`)));

    const body = unmarked(w.codeHost.prs[0]!.body);
    expect(body).not.toMatch(/#99|#12/);
    expect(body.match(/Closes #/g)).toHaveLength(1);
  });

  it("drops closing keywords inline, keeping the sentence readable", async () => {
    const stage = `${text}\n\nThis fixes #99 by renaming the helper, and it also Resolves: acme/web#4.\nCloses #5, #6 and fixed #8 too.`;
    const { w } = await pipeline(ready(writes(stage)));

    const body = unmarked(w.codeHost.prs[0]!.body);
    expect(body).not.toMatch(/#99|#4\b|#5|#6|#8/);
    expect(body.replace(/\n\nCloses #7$/, "")).not.toMatch(/\b(?:fix|fixes|fixed|resolves|closes)\b/i);
    expect(body).toContain("This [closing reference removed] by renaming the helper, and it also [closing reference removed].");
    expect(body).toContain("[closing reference removed] too.");
    expect(body.match(/Closes #/g)).toHaveLength(1);
    expect(body.trimEnd().endsWith("Closes #7")).toBe(true);
  });

  it("drops the tool attribution footer the agent appends (the pr skill's own template ends with one)", async () => {
    const footer = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
    const { w } = await pipeline(ready(writes(`${text}\n\n${footer}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`)));

    const body = unmarked(w.codeHost.prs[0]!.body);
    expect(body).not.toContain("Generated with");
    expect(body).not.toContain("Co-Authored-By");
    expect(body).toContain("## Merge Danger");
    expect(body.trimEnd().endsWith("Closes #7")).toBe(true);
  });

  it("falls back to the minimal body and tells why in the review footer", async () => {
    const { w } = await pipeline(ready(noBlock));

    const pr = w.codeHost.prs[0]!;
    expect(unmarked(pr.body)).toBe("Implemented by the Factory.\n\nCloses #7");
    const footer = pr.reviews[0]!.body;
    expect(footer).toContain("The Pull Request Stage failed");
    expect(footer).toContain("<pull-request>");
    expect(pr.draft).toBe(false);
  });

  it("sums the Pull Request Stage tokens into the cost line", async () => {
    const { w } = await pipeline(ready(writes()));

    // 10,000 + 5,000 + 2,000 in; 1,000 + 500 + 300 out.
    expect(w.codeHost.prs[0]!.reviews[0]!.body).toContain("Tokens: 17,000 in / 1,800 out.");
  });

  it("gives an Escalation draft the same body under the warning, and lists the Stage in the comment", async () => {
    const { w, comments } = await pipeline({
      agent: { development: [developFile("src/greet.ts")], review: [review], "pull-request": [writes()] },
      verify: [e2eFails],
      env: { FACTORY_MAX_ATTEMPTS: "1" },
    });

    const pr = w.codeHost.prs[0]!;
    expect(pr).toMatchObject({ draft: true });
    expect(pr.body.startsWith("> [!WARNING]")).toBe(true);
    expect(pr.body).toContain("## Summary");
    expect(unmarked(pr.body).trimEnd().endsWith("Closes #7")).toBe(true);
    expect(comments()[0]).toContain("Pull Request Stage (not an attempt): ok");
    expect(comments()[0]).toContain("Tokens: 17,000 in / 1,800 out.");
  });

  it("rewrites the body of the open pull request a run continues, and keeps it when the Stage failed", async () => {
    const prs = [{ number: 55, branch: "factory/issue-7", draft: false, headSha: OLD_SHA, body: "Old body\n\nCloses #7" }];
    const branches = { "factory/issue-7": OLD_SHA };

    const rewritten = await pipeline({ ...ready(writes()), prs, branches, publishArgs: ["--pr", "55"] });
    expect(rewritten.w.codeHost.pr(55).body).toContain("## Summary");
    expect(unmarked(rewritten.w.codeHost.pr(55).body).trimEnd().endsWith("Closes #7")).toBe(true);
    expect(rewritten.w.codeHost.prs).toHaveLength(1);

    const failed = await pipeline({ ...ready(noBlock), prs: structuredClone(prs), branches, publishArgs: ["--pr", "55"] });
    expect(unmarked(failed.w.codeHost.pr(55).body)).toBe("Old body\n\nCloses #7");
    expect(failed.w.codeHost.writes).not.toContain("updatePrBody #55");
  });
});
