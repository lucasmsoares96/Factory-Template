import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { checkout, commitFile, git, lastJson, tempDir, unmarked, world } from "./helpers.ts";

const develop: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "src/greet.ts", 'export const greet = () => "hi";\n', "feat: greet the user #7");
  await commitFile(cwd, "src/app.ts", (await git(cwd, "show", "HEAD:src/app.ts")).replace("line2 = 2", "line2 = 22") + "\n", "fix: line two #7");
};

const review: AgentStep = () => {
  const findings = {
    summary: "Looks right. Tightened nothing.",
    inline: [
      { path: "src/greet.ts", line: 1, body: "Consider a return type." },
      { path: "src/app.ts", line: 3, body: "Context line inside the hunk." },
      { path: "src/app.ts", line: 25, body: "Far from any change." },
      { path: "README.md", line: 1, body: "Not in the diff at all." },
    ],
  };
  return { output: `<review>${JSON.stringify(findings)}</review>` };
};

/** Runs claim → work → publish → working off through the CLI, each job on its own checkout. */
async function happyPath(options: { branches?: Record<string, string>; review?: AgentStep } = {}) {
  const workCheckout = await checkout();
  const publishCheckout = await checkout();
  const artifacts = await tempDir("factory-artifacts-");
  const w = world({
    repo: workCheckout,
    branches: options.branches,
    agent: { development: [develop], review: [options.review ?? review] },
    verify: [{ ok: true, evidence: [{ product: "example", name: "home.png" }, { product: "admin", name: "users.png" }, { product: "example", name: "about.png" }] }],
  });

  expect(await w.factory("claim", "7")).toBe(0);
  const claimed = lastJson(w.logs) as { startSha: string | null };
  expect(await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts)).toBe(0);
  const head = await git(workCheckout, "rev-parse", "HEAD");
  const exitCode = await w.factory(
    "publish", "7", "--repo", publishCheckout, "--in", artifacts, "--start-sha", claimed.startSha ?? "",
  );
  const output = lastJson(w.logs);
  // The last step of the run, as in the workflow.
  expect(await w.factory("working", "off", "7")).toBe(0);
  return { output, w, exitCode, head, artifacts, publishCheckout };
}

describe("factory publish", () => {
  it("turns a ready issue into a ready PR with review and evidence", async () => {
    const { w, exitCode, head, artifacts, output } = await happyPath();

    expect(exitCode).toBe(0);
    // `in-progress` holds the issue until the merge; `factory:working` came off with the run.
    expect(w.tracker.labelsOf(7)).toEqual(["in-progress"]);
    expect(w.codeHost.pr(101).labels).toEqual([]);
    expect(w.codeHost.pushes).toEqual([{ branch: "factory/issue-7", sha: head, expectedSha: null }]);
    expect(w.codeHost.branches.get("factory/issue-7")).toBe(head);

    expect(w.codeHost.prs).toHaveLength(1);
    const pr = w.codeHost.prs[0]!;
    expect(pr).toMatchObject({ title: "Fix #7: Greet the user", branch: "factory/issue-7", base: "main", state: "open", draft: false });
    expect(pr.body).toMatch(/^Closes #7$/m);
    expect(pr.body).toContain("Implemented by the Factory");

    expect(pr.reviews).toHaveLength(1);
    expect(pr.reviews[0]!.event).toBe("COMMENT");
    expect(pr.reviews[0]!.body).toContain("Looks right. Tightened nothing.");
    expect(pr.reviews[0]!.body).toMatch(/Tokens: [\d,]+ in \/ [\d,]+ out\. Estimated cost: \$\d+\.\d\d\./);
    expect(pr.reviews[0]!.comments.map((c) => ({ ...c, body: unmarked(c.body) }))).toEqual([
      { path: "src/greet.ts", line: 1, body: "Consider a return type." },
      { path: "src/app.ts", line: 3, body: "Context line inside the hunk." },
    ]);

    expect(pr.images.map((i) => [i.product, i.name, i.path])).toEqual([
      ["admin", "users.png", join(artifacts, "evidence/admin/users.png")],
      ["example", "about.png", join(artifacts, "evidence/example/about.png")],
      ["example", "home.png", join(artifacts, "evidence/example/home.png")],
    ]);

    // The PR this run opened shows `factory:working` until the run ends.
    expect(w.codeHost.writes).toEqual(["push factory/issue-7", "openDraftPr #101", "labelPr #101 factory:working", "submitReview #101", "markReady #101", "unlabelPr #101 factory:working"]);
    expect(output).toEqual({ issue: 7, outcome: "ready", pr: 101, url: "https://forge.test/pr/101" });
  });

  it("posts a COMMENT review without inline comments when the review has none", async () => {
    const summaryOnly: AgentStep = () => ({
      output: `<review>${JSON.stringify({ summary: "Fixed the naming myself.", inline: [] })}</review>`,
    });
    const { w, exitCode } = await happyPath({ review: summaryOnly });

    expect(exitCode).toBe(0);
    const reviews = w.codeHost.prs[0]!.reviews;
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.event).toBe("COMMENT");
    expect(reviews[0]!.body).toContain("Fixed the naming myself.");
    expect(reviews[0]!.body).toMatch(/Tokens: [\d,]+ in \/ [\d,]+ out\./);
    expect(reviews[0]!.comments).toEqual([]);
  });

  it("pushes with a lease on the branch head the claim saw", async () => {
    const old = "0123456789abcdef0123456789abcdef01234567";
    const { w, exitCode, head } = await happyPath({ branches: { "factory/issue-7": old } });

    expect(exitCode).toBe(0);
    expect(w.codeHost.pushes).toEqual([{ branch: "factory/issue-7", sha: head, expectedSha: old }]);
  });
});
