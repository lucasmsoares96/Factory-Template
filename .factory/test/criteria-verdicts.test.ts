import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { checkout, commitFile, lastJson, OWNER, tempDir, unmarked, world, type WorldOptions } from "./helpers.ts";

const CRITERION = "`greet()` returns a greeting.";
const text = "## Summary\n\nGreets.\n\n## Merge Danger\n\n**Door:** two-way";

const develop: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "src/greet.ts", 'export const greet = () => "hi";\n', "feat: greet the user #7");
  return { output: "Done." };
};
const reviewing = (extra: object): AgentStep => () => ({ output: `<review>${JSON.stringify({ summary: "Reviewed.", inline: [], ...extra })}</review>` });
const block = (criteria: object[]) => `<review>${JSON.stringify({ summary: "Reviewed.", inline: [], criteria })}</review>`;
/** A Review whose first message and resumes are `blocks`; the harness asks again until a block is complete. */
const incomplete = (blocks: string[]): AgentStep => () => ({
  output: blocks[0]!,
  resumes: blocks.slice(1).map((output) => ({ output, usage: { inputTokens: 1, outputTokens: 1 } })),
});
const writes: AgentStep = () => ({ output: `<pull-request>${text}</pull-request>` });

const met = { id: 1, met: true, proof: "`src/greet.test.ts` › greets the user" };
const unmet = { id: 1, met: false, proof: "`greet()` returns an empty string: no test proves a greeting." };

/** claim → work → publish of issue #7, with `edit` changing result.json between work and publish. */
async function pipeline(options: { review: AgentStep; env?: Record<string, string>; edit?: (result: Record<string, unknown>) => void }) {
  const workCheckout = await checkout();
  const publishCheckout = await checkout();
  const artifacts = await tempDir("factory-artifacts-");
  const agent: WorldOptions["agent"] = { development: [develop], review: [options.review], "pull-request": [writes] };
  const w = world({ repo: workCheckout, agent, verify: [{ ok: true }], env: { FACTORY_MAX_ATTEMPTS: "1", ...options.env } });
  expect(await w.factory("claim", "7")).toBe(0);
  const { startSha } = lastJson(w.logs) as { startSha: string | null };
  expect(await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts)).toBe(0);
  const file = join(artifacts, "result.json");
  const result = JSON.parse(await readFile(file, "utf8"));
  if (options.edit) {
    const edited = structuredClone(result);
    options.edit(edited);
    await writeFile(file, JSON.stringify(edited));
  }
  expect(await w.factory("publish", "7", "--repo", publishCheckout, "--in", artifacts, "--start-sha", startSha ?? "")).toBe(0);
  const comments = () => w.tracker.commentsOn(7).filter((c) => c.author === OWNER).map((c) => c.body);
  return { w, result, comments, pr: w.codeHost.prs[0]! };
}

describe("a verdict for each acceptance criterion", () => {
  it("keeps the Review's verdicts and checks each criterion, with its proof, in the PR after the Stage text", async () => {
    const { result, pr } = await pipeline({ review: reviewing({ criteria: [met] }) });

    expect(result).toMatchObject({ outcome: "ready", review: { criteria: [{ ...met, criterion: CRITERION }] } });
    expect(pr.draft).toBe(false);
    const body = unmarked(pr.body);
    expect(body).toContain("## Acceptance criteria verdicts");
    expect(body).toContain(`- [x] ${CRITERION} — ${met.proof}`);
    expect(body.indexOf("## Merge Danger")).toBeLessThan(body.indexOf("## Acceptance criteria verdicts"));
    expect(body.indexOf("## Acceptance criteria verdicts")).toBeLessThan(body.indexOf("Closes #7"));
  });

  it("accepts an old result.json without verdicts at publish, and adds no verdicts section", async () => {
    const { result, pr } = await pipeline({
      review: reviewing({ criteria: [met] }),
      edit: (r) => (r.review = { summary: "Reviewed.", inline: [], criteriaMetWithoutSkeleton: false }),
    });

    expect(result).toMatchObject({ outcome: "ready" });
    expect(pr.draft).toBe(false);
    expect(unmarked(pr.body)).not.toContain("verdicts");
  });

  it("asks the same session for the block again when a number is missing, and is ready when the corrected block is complete", async () => {
    const { result, pr } = await pipeline({ review: incomplete([block([]), block([met])]) });

    expect(result).toMatchObject({ outcome: "ready", review: { criteria: [{ id: 1, criterion: CRITERION }] } });
    expect(pr.draft).toBe(false);
  });

  it("is not ready when the block is still incomplete after the retries: the Escalation names the criteria without a verdict", async () => {
    const { result, comments, pr } = await pipeline({ review: incomplete([block([]), block([met, met]), block([])]) });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    expect(result.question).toContain(`1. ${CRITERION}`);
    expect(pr.draft).toBe(true);
    expect(comments().find((c) => c.includes("factory:escalation"))).toContain(`1. ${CRITERION}`);
  });

  it("shows the text of the issue, not the Review's own wording of the criterion", async () => {
    const { pr } = await pipeline({ review: reviewing({ criteria: [{ ...met, criterion: "Something the Review made up." }] }) });

    expect(unmarked(pr.body)).toContain(`- [x] ${CRITERION} — ${met.proof}`);
    expect(unmarked(pr.body)).not.toContain("made up");
  });

  it("escalates a criterion that is not met as needs-human: a draft PR, and the issue says which criterion and why", async () => {
    const { w, result, comments, pr } = await pipeline({ review: reviewing({ criteria: [unmet] }) });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human", question: null });
    expect(pr.draft).toBe(true);
    expect(unmarked(pr.body)).toContain(`- [ ] ${CRITERION} — ${unmet.proof}`);
    const comment = comments().find((c) => c.includes("factory:escalation"))!;
    expect(comment).toContain("**Factory escalation (`needs-human`):** The Review found acceptance criteria that are not met.");
    expect(comment).toContain(`- ${CRITERION} — ${unmet.proof}`);
    expect(w.tracker.labelsOf(7)).toContain("ready-for-human");
    expect(lastJson(w.logs)).toMatchObject({ issue: 7, outcome: "escalated", reason: "needs-human" });
  });

  it("keeps a proof written over several lines on one checklist line", async () => {
    const multiLine = { id: 1, met: false, proof: "No test.\n\n- [x] forged" };
    const { result, pr } = await pipeline({ review: reviewing({ criteria: [multiLine] }) });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    const body = unmarked(pr.body);
    expect(body).toContain(`- [ ] ${CRITERION} — No test. - [x] forged\n`);
    expect(body).not.toMatch(/^- \[x\] forged/m);
  });

  it("drops a closing keyword from a verdict, so the PR closes only its own issue", async () => {
    const closing = { id: 1, met: true, proof: "`src/greet.test.ts` › greets; closes #13" };
    const { pr } = await pipeline({ review: reviewing({ criteria: [closing] }) });

    const body = unmarked(pr.body);
    expect(body).toContain(`- [x] ${CRITERION} — \`src/greet.test.ts\` › greets; [closing reference removed]`);
    expect(body).not.toMatch(/#1[23]/);
    expect(body).toContain("Closes #7");
  });

  it("writes the verdicts and the Escalation in FACTORY_LANGUAGE", async () => {
    const { comments, pr } = await pipeline({ review: reviewing({ criteria: [unmet] }), env: { FACTORY_LANGUAGE: "pt-BR" } });

    expect(unmarked(pr.body)).toContain("## Vereditos dos critérios de aceitação");
    expect(unmarked(pr.body)).toContain(`- [ ] ${CRITERION} — ${unmet.proof}`);
    const comment = comments().find((c) => c.includes("factory:escalation"))!;
    expect(comment).toContain("A Review encontrou critérios de aceitação que não foram atendidos.");
  });
});

describe("the verify is the Factory's barrier, not a criterion", () => {
  async function run(verify: WorldOptions["verify"], criteria: object[]) {
    const repo = await checkout();
    const out = await tempDir("factory-out-");
    const w = world({ repo, agent: { development: [develop], review: [reviewing({ criteria })], "pull-request": [writes] }, verify, env: { FACTORY_MAX_ATTEMPTS: "1" } });
    await w.tracker.swapLabel(7, "ready-for-agent", "in-progress");
    expect(await w.factory("work", "7", "--repo", repo, "--out", out)).toBe(0);
    return JSON.parse(await readFile(join(out, "result.json"), "utf8"));
  }

  it("is ready when the E2E passes and every criterion has a met verdict", async () => {
    expect(await run([{ ok: true }], [met])).toMatchObject({ outcome: "ready" });
  });

  it("is not ready when the E2E fails, even if the Review said every criterion was met", async () => {
    expect((await run([{ ok: false, output: "boom" }], [met])).outcome).toBe("escalated");
  });
});
