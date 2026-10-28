import { describe, expect, it } from "vitest";
import { FakeCodeHost } from "../src/adapters/fake/fake-code-host.ts";
import { FakeTracker } from "../src/adapters/fake/fake-tracker.ts";
import { GitHubCodeHost } from "../src/adapters/github/github-code-host.ts";
import { GitHubTracker } from "../src/adapters/github/github-tracker.ts";
import { FACTORY_MARKER, isMarked, marked } from "../src/marker.ts";
import { FakeGitHubServer } from "./github/fake-github.ts";

const R = "/repos/o/r";
const pr = { number: 5, html_url: "https://github.com/o/r/pull/5", state: "open", draft: true, node_id: "PR_5", head: { ref: "factory/issue-7", sha: "a".repeat(40), repo: { full_name: "o/r" } }, base: { ref: "main" } };

describe("the Factory marker", () => {
  it("is put once, however many times a text is marked", () => {
    expect(isMarked(marked("hello"))).toBe(true);
    expect(marked(marked("hello"))).toBe(marked("hello"));
    expect(isMarked("a person wrote this")).toBe(false);
  });

  it("is on every text the GitHub adapters write: no write path leaves without it", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", `${R}/issues/7/comments`, () => ({ json: {} }));
    s.on("POST", `${R}/issues/5/comments`, () => ({ json: {} }));
    s.on("POST", `${R}/issues`, () => ({ json: { number: 9, html_url: "https://github.com/o/r/issues/9" } }));
    s.on("POST", `${R}/pulls`, () => ({ json: pr }));
    s.on("PATCH", `${R}/pulls/5`, () => ({ json: pr }));
    s.on("POST", `${R}/pulls/5/reviews`, () => ({ json: {} }));
    s.on("POST", `${R}/pulls/5/comments/3/replies`, () => ({ json: {} }));
    const api = { repo: "o/r", token: "tok", fetch: s.fetch };
    const tracker = new GitHubTracker(api);
    const host = new GitHubCodeHost({ ...api, baseBranch: "main", cwd: "/work", gh: async () => "" });

    await tracker.comment(7, "triage said so");
    await tracker.createIssue({ title: "T", body: "follow-up" });
    await host.commentPr(5, "a comment");
    await host.openDraftPr({ branch: "factory/issue-7", base: "main", title: "T", body: "the body" });
    await host.updatePrBody(5, "the new body");
    await host.closePr(5, "closing");
    await host.submitReview(5, { body: "summary", event: "COMMENT", comments: [{ path: "a.ts", line: 1, body: "inline" }] });
    await host.replyToThread(5, "3", "Address: done");

    const texts = s.calls
      .filter((c) => c.method !== "GET")
      .flatMap((c) => {
        const body = c.body as Record<string, unknown> | undefined;
        const inline = ((body?.comments as { body: string }[] | undefined) ?? []).map((i) => i.body);
        return [body?.body, ...inline].filter((t): t is string => typeof t === "string").map((t) => `${c.method} ${c.path}: ${t}`);
      });
    expect(texts.length).toBeGreaterThanOrEqual(9);
    for (const text of texts) expect(text, text).toContain(FACTORY_MARKER);
  });

  it("is on the text of the PR body written through gh with prints", async () => {
    const s = new FakeGitHubServer();
    let written = "";
    const { readFile } = await import("node:fs/promises");
    const host = new GitHubCodeHost({
      repo: "o/r", token: "tok", fetch: s.fetch, baseBranch: "main", cwd: "/work",
      gh: async (args) => ((written = await readFile(args[args.indexOf("--body-file") + 1]!, "utf8")), ""),
    });
    await host.updatePrBody(5, "body ![a](/tmp/a.png)", [{ product: "web", name: "a", path: "/tmp/a.png" }]);
    expect(written).toContain(FACTORY_MARKER);
  });

  it("is on every text the fakes write, so the tests see what the forge would", async () => {
    const tracker = new FakeTracker({ issues: [{ number: 7 }] });
    const host = new FakeCodeHost({ branches: { "factory/issue-7": "a".repeat(40) } });
    await tracker.comment(7, "hi");
    const opened = await host.openDraftPr({ branch: "factory/issue-7", base: "main", title: "T", body: "b" });
    await host.commentPr(opened.number, "c");
    await host.submitReview(opened.number, { body: "r", event: "COMMENT", comments: [{ path: "a", line: 1, body: "i" }] });
    host.pr(opened.number).threads.push({ id: "t", path: null, author: "alice", body: "x", replies: [] });
    await host.replyToThread(opened.number, "t", "reply");
    await host.closePr(opened.number, "bye");

    const p = host.pr(opened.number);
    const all = [...tracker.commentsOn(7).map((c) => c.body), p.body, ...p.comments, p.reviews[0]!.body, p.reviews[0]!.comments[0]!.body, p.threads[0]!.replies[0]!.body];
    for (const text of all) expect(text).toContain(FACTORY_MARKER);
  });
});
