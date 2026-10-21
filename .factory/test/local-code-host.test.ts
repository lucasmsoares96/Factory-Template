import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalCodeHost } from "../src/adapters/local/local-code-host.ts";
import { MarkdownTracker } from "../src/adapters/local/markdown-tracker.ts";
import { loadConfig } from "../src/config.ts";
import { checkout, commitFile, git, tempDir } from "./helpers.ts";

const ISSUE = "# 07: Greet the user\n\n**Status:** in-progress\n\n## Acceptance criteria\n\n- [ ] greets\n";

/**
 * The host repo (the "remote": where the branch lands) with the Markdown
 * ticket in `.scratch/greetings/issues/`, and a separate checkout that pushes
 * to it, like the `publish` job's.
 */
async function setup() {
  const host = await checkout();
  const issues = join(host, ".scratch/greetings/issues");
  await mkdir(issues, { recursive: true });
  await writeFile(join(issues, "07-greet.md"), ISSUE);
  const from = join(await tempDir("factory-publish-"), "repo");
  await git(host, "clone", "--quiet", host, from);
  const tracker = new MarkdownTracker({ dir: issues, self: "factory", human: "lucas" });
  const codeHost = new LocalCodeHost({ remote: host, from, files: tracker.files, config: loadConfig({}) });
  const read = () => readFile(join(issues, "07-greet.md"), "utf8");
  return { host, from, issues, tracker, codeHost, read };
}

describe("local CodeHost", () => {
  it("pushes the branch into the host repo with a lease against the starting SHA", async () => {
    const { host, from, codeHost } = await setup();
    await git(from, "checkout", "--quiet", "-b", "work");
    await commitFile(from, "src/greet.ts", "export const greet = () => 'hi';\n", "feat: greet #7");
    const first = await git(from, "rev-parse", "HEAD");

    expect(await codeHost.branchHead("factory/issue-7")).toBeNull();
    expect(await codeHost.push({ branch: "factory/issue-7", sha: first, expectedSha: null })).toEqual({ ok: true });
    expect(await git(host, "rev-parse", "factory/issue-7")).toBe(first);
    expect(await codeHost.branchHead("factory/issue-7")).toBe(first);

    await commitFile(from, "src/greet.ts", "export const greet = () => 'hello';\n", "fix: greet #7");
    const second = await git(from, "rev-parse", "HEAD");
    // Someone else's start: the lease no longer holds.
    expect(await codeHost.push({ branch: "factory/issue-7", sha: second, expectedSha: null })).toEqual({ ok: false, reason: "branch-moved" });
    expect(await codeHost.push({ branch: "factory/issue-7", sha: second, expectedSha: first })).toEqual({ ok: true });
    expect(await git(host, "rev-parse", "factory/issue-7")).toBe(second);
  });

  it("keeps the pull request as one comment in the ticket: draft, labels, ready, closed", async () => {
    const { from, codeHost, read } = await setup();
    await git(from, "push", "--quiet", "origin", "HEAD:refs/heads/factory/issue-7");

    expect(await codeHost.openPrFor("factory/issue-7")).toBeNull();
    const pr = await codeHost.openDraftPr({ branch: "factory/issue-7", base: "main", title: "Fix #7: Greet the user", body: "Closes #7" });
    expect(pr).toMatchObject({ number: 7, branch: "factory/issue-7", draft: true, state: "open" });
    expect(await codeHost.openPrFor("factory/issue-7")).toMatchObject({ number: 7, draft: true });

    await codeHost.updatePrBody(7, "## Summary\n\nNew body\n\nCloses #7");
    await codeHost.labelPr(7, "harness-change");
    await codeHost.markReady(7);
    let text = await read();
    expect(text.match(/factory:pr/g)).toHaveLength(1);
    expect(text).toContain("**Pull request (local, ready):** `factory/issue-7` → `main`");
    expect(text).toContain("Fix #7: Greet the user");
    expect(text).toContain("New body");
    expect(text).toContain("Labels: `harness-change`");
    expect(await codeHost.openPrFor("factory/issue-7")).toMatchObject({ draft: false });

    await codeHost.closePr(7, "Superseded by a new run.");
    text = await read();
    expect(text).toContain("**Pull request (local, closed):**");
    expect(text).toContain("Superseded by a new run.");
    expect(await codeHost.openPrFor("factory/issue-7")).toBeNull();
  });

  it("writes the review with its inline findings into the ticket's comments", async () => {
    const { from, codeHost, tracker } = await setup();
    await git(from, "push", "--quiet", "origin", "HEAD:refs/heads/factory/issue-7");
    await codeHost.openDraftPr({ branch: "factory/issue-7", base: "main", title: "t", body: "b" });

    await codeHost.submitReview(7, {
      event: "COMMENT",
      body: "Looks right.\n\n---\nTokens: 1 in / 1 out.",
      comments: [{ path: "src/greet.ts", line: 1, body: "Name the greeting." }],
    });

    const review = (await tracker.issue(7)).comments.find((c) => c.body.startsWith("**Factory review**"));
    expect(review?.author).toBe("factory");
    expect(review?.body).toContain("Looks right.");
    expect(review?.body).toContain("- `src/greet.ts:1` Name the greeting.");
  });

  it("copies the prints next to the local PR and writes the body with relative references, on open and on rewrite", async () => {
    const { host, from, codeHost, read } = await setup();
    await git(from, "push", "--quiet", "origin", "HEAD:refs/heads/factory/issue-7");
    const prints = await tempDir("factory-prints-");
    await writeFile(join(prints, "home.png"), "png:home");
    await writeFile(join(prints, "login.png"), "png:login");
    const home = { product: "example", name: "home.png", path: join(prints, "home.png") };
    const login = { product: "other", name: "login.png", path: join(prints, "login.png") };

    await codeHost.openDraftPr({ branch: "factory/issue-7", base: "main", title: "t", body: `## Evidence\n\n![home](${home.path})`, images: [home] });
    const opened = await read();
    expect(opened).toContain("![home](../evidence/07/example/home.png)");
    expect(opened).not.toContain(prints);

    await codeHost.updatePrBody(7, `## Evidence\n\n![home](${home.path})\n\n![login](${login.path})`, [home, login]);

    const evidence = join(host, ".scratch/greetings/evidence/07");
    expect(await readFile(join(evidence, "example/home.png"), "utf8")).toBe("png:home");
    expect(await readFile(join(evidence, "other/login.png"), "utf8")).toBe("png:login");
    const text = await read();
    expect(text).toContain("![login](../evidence/07/other/login.png)");
    expect(text).not.toContain(prints);
    expect(text).not.toContain("factory:evidence");
  });

  it("has no review threads and cannot dispatch workflows", async () => {
    const { codeHost } = await setup();
    expect(await codeHost.threads(7)).toEqual([]);
    await expect(codeHost.dispatch("issue", { issue: "7" })).rejects.toThrow(/not available in local mode/);
  });
});
