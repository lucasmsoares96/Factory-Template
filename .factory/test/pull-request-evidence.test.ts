import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { checkout, commitFile, lastJson, tempDir, unmarked, world, type WorldOptions } from "./helpers.ts";
import { commits, feedbackRound, finishRound, prWorld, PR, replies, reviewOk, thread } from "./pr-flow-helpers.ts";

const url = (pr: number, product: string, name: string) => `https://forge.test/pr/${pr}/images/${product}/${name}`;
const print = (product: string, name: string) => `test-results/evidence/${product}/${name}`;
const prints = [{ product: "example", name: "home.png" }, { product: "admin", name: "users.png" }, { product: "example", name: "about.png" }];

const develop: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "src/greet.ts", "export {};\n", "feat: greet #7");
};
const review: AgentStep = () => ({ output: `<review>${JSON.stringify({ summary: "Fine.", inline: [] })}</review>` });
const writes = (body: string): AgentStep => () => ({ output: `<pull-request>${body}</pull-request>` });

async function issueRun(options: { stage: AgentStep; evidence?: typeof prints }) {
  const workCheckout = await checkout();
  const publishCheckout = await checkout();
  const artifacts = await tempDir("factory-artifacts-");
  const w = world({
    repo: workCheckout,
    agent: { development: [develop], review: [review], "pull-request": [options.stage] },
    verify: [{ ok: true, evidence: options.evidence ?? prints }],
  } satisfies WorldOptions);
  expect(await w.factory("claim", "7")).toBe(0);
  const { startSha } = lastJson(w.logs) as { startSha: string | null };
  expect(await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts)).toBe(0);
  expect(await w.factory("publish", "7", "--repo", publishCheckout, "--in", artifacts, "--start-sha", startSha ?? "")).toBe(0);
  return { w, pr: w.codeHost.prs[0]! };
}

const middle = (body: string) => body.slice(0, body.indexOf("Closes #7"));

describe("evidence in the pull request body", () => {
  it("swaps the local reference of a print for the URL the CodeHost gives it, next to the text that supports it", async () => {
    const { pr } = await issueRun({
      stage: writes(`## Summary\n\nGreets.\n\n## Evidence\n\nThe home screen now greets:\n\n![home](${print("example", "home.png")})\n\n## Merge Danger\n\n**Door:** two-way`),
    });

    expect(pr.body).toContain(`![home](${url(101, "example", "home.png")})`);
    expect(pr.body).not.toContain("test-results");
    expect(pr.body.indexOf("The home screen now greets")).toBeLessThan(pr.body.indexOf(url(101, "example", "home.png")));
    expect(pr.images.map((i) => `${i.product}/${i.name}`).sort()).toEqual(["admin/users.png", "example/about.png", "example/home.png"]);
  });

  it("appends a print the text does not reference at the end of the Evidence section, grouped by Product", async () => {
    const { pr } = await issueRun({
      stage: writes(`## Summary\n\nGreets.\n\n## Evidence\n\n![home](${print("example", "home.png")})\n\n## Merge Danger\n\n**Door:** two-way`),
    });

    const body = unmarked(pr.body);
    const evidence = body.slice(body.indexOf("## Evidence"), body.indexOf("## Merge Danger"));
    expect(evidence).toMatch(/### admin\n\n!\[users\.png\]\(https:\/\/forge\.test\/pr\/101\/images\/admin\/users\.png\)/);
    expect(evidence).toMatch(/### example\n\n!\[about\.png\]\(https:\/\/forge\.test\/pr\/101\/images\/example\/about\.png\)/);
    expect(evidence.match(/home\.png/g)).toHaveLength(1);
    expect(body.indexOf("### admin")).toBeLessThan(body.indexOf("## Merge Danger"));
    expect(body.trimEnd().endsWith("Closes #7")).toBe(true);
  });

  it("adds an Evidence section when the text has none", async () => {
    const { pr } = await issueRun({ stage: writes("## Summary\n\nGreets.") });

    expect(middle(pr.body)).toMatch(/## Summary[\s\S]*## Evidence\n\n### admin\n\n!\[users\.png\]/);
    expect(pr.body.match(/!\[/g)).toHaveLength(3);
  });

  it("puts the prints in the minimal body when the Pull Request Stage wrote no text", async () => {
    const { pr } = await issueRun({ stage: () => ({ output: "no block", resumes: [{ output: "no" }, { output: "no" }] }) });

    expect(pr.body).toContain("Implemented by the Factory.");
    expect(pr.body).toContain(`![home.png](${url(101, "example", "home.png")})`);
  });

  it("removes a reference to a file that is not in the evidence, and leaves remote images alone", async () => {
    const { pr } = await issueRun({
      stage: writes(
        `## Evidence\n\nBefore:\n\n![ghost](${print("example", "ghost.png")})\n\nInline ![gone](/tmp/elsewhere.png) text\n\n![badge](https://img.shields.io/x.svg)\n\n![home](${print("example", "home.png")})`,
      ),
    });

    expect(pr.body).not.toContain("ghost");
    expect(pr.body).not.toContain("elsewhere");
    expect(pr.body).toContain("Inline  text");
    expect(pr.body).toContain("![badge](https://img.shields.io/x.svg)");
    expect(pr.body).toContain(url(101, "example", "home.png"));
  });

  it("leaves no separate evidence comment, on the PR or in the writes", async () => {
    const { w, pr } = await issueRun({ stage: writes("## Summary\n\nGreets.") });

    expect(pr.comments).toEqual([]);
    expect(w.codeHost.writes).toEqual(["push factory/issue-7", "openDraftPr #101", "submitReview #101", "markReady #101"]);
  });
});

describe("evidence in the body on later rounds", () => {
  it("pr-feedback rewrites the body with the Stage text and the new prints", async () => {
    const p = await prWorld({
      main: "none",
      threads: [thread("t1", "Show it again.")],
      agent: {
        development: [commits(replies({ threadId: "t1", decision: "address", body: "Done." }))],
        review: [reviewOk],
        "pull-request": [writes(`## Summary\n\nRound two.\n\n## Evidence\n\n![home](${print("example", "home.png")})\n\n## Merge Danger\n\nNone.`)],
      },
      verify: [{ ok: true, evidence: [{ product: "example", name: "home.png" }, { product: "example", name: "extra.png" }] }],
    });

    await feedbackRound(p);

    const pr = p.w.codeHost.pr(PR);
    expect(p.w.agent.calls.map((c) => c.stage)).toContain("pull-request");
    expect(pr.body).toContain("Round two.");
    expect(pr.body).toContain(url(PR, "example", "home.png"));
    expect(pr.body).toContain(url(PR, "example", "extra.png"));
    expect(unmarked(pr.body).trimEnd().endsWith("Closes #7")).toBe(true);
    expect(pr.comments).toEqual([]);
    expect(p.w.codeHost.writes.filter((x) => x.startsWith("updatePrBody"))).toEqual([`updatePrBody #${PR}`]);
  });

  it("update-branch leaves the body and the images as they were", async () => {
    const p = await prWorld({ main: "clean", verify: [{ ok: true, evidence: [{ product: "example", name: "home.png" }] }] });
    expect(await p.w.factory("update-branch", "7")).toBe(0);
    const claim = lastJson(p.w.logs) as { startSha: string };

    await finishRound(p, ["--flow", "update-branch"], claim.startSha);

    const pr = p.w.codeHost.pr(PR);
    expect(unmarked(pr.body)).toBe("Original body\n\nCloses #7");
    expect(pr.images).toEqual([]);
    expect(p.w.codeHost.writes.some((x) => x.startsWith("updatePrBody"))).toBe(false);
  });
});
