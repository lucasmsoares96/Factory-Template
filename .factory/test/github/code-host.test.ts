import { describe, expect, it } from "vitest";
import { GitHubCodeHost, type GitRunner } from "../../src/adapters/github/github-code-host.ts";
import { FakeGitHubServer } from "./fake-github.ts";
// Imported statically: helpers.ts registers the afterEach that removes temp dirs, which a dynamic import inside a test misses.
import { git, tempDir } from "../helpers.ts";

const R = "/repos/o/r";
const pr = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n, html_url: `https://github.com/o/r/pull/${n}`, state: "open", draft: true, node_id: `PR_${n}`,
  head: { ref: "factory/issue-7", sha: "a".repeat(40) }, ...extra,
});

function host(server: FakeGitHubServer, extra: { git?: GitRunner; gh?: (args: string[], env: Record<string, string>) => Promise<void> } = {}) {
  return new GitHubCodeHost({
    repo: "o/r", token: "tok-123", fetch: server.fetch, baseBranch: "main", cwd: "/work",
    git: extra.git ?? (async () => ({ code: 0, stderr: "" })),
    gh: extra.gh ?? (async () => {}),
  });
}

describe("GitHubCodeHost", () => {
  it("reads the head of a branch, null when it does not exist", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/git/ref/heads/factory/issue-7`, () => ({ json: { object: { sha: "b".repeat(40) } } }));

    expect(await host(s).branchHead("factory/issue-7")).toBe("b".repeat(40));
    expect(await host(s).branchHead("factory/issue-8")).toBeNull();
  });

  it("pushes with a lease against the start SHA, the token only in the environment", async () => {
    const seen: { args: string[]; env: Record<string, string>; cwd: string }[] = [];
    const git: GitRunner = async (args, options) => (seen.push({ args, ...options }), { code: 0, stderr: "" });
    const s = new FakeGitHubServer();

    const out = await host(s, { git }).push({ branch: "factory/issue-7", sha: "c".repeat(40), expectedSha: "b".repeat(40) });

    expect(out).toEqual({ ok: true });
    expect(seen[0]!.args).toEqual([
      "push", `--force-with-lease=refs/heads/factory/issue-7:${"b".repeat(40)}`, "https://github.com/o/r.git", `${"c".repeat(40)}:refs/heads/factory/issue-7`,
    ]);
    expect(seen[0]!.cwd).toBe("/work");
    expect(JSON.stringify(seen[0]!.args)).not.toContain("tok-123");
    expect(Object.values(seen[0]!.env).join("\n")).toContain(Buffer.from("x-access-token:tok-123").toString("base64"));
  });

  it("a branch that must not exist is leased against nothing", async () => {
    const seen: string[][] = [];
    const git: GitRunner = async (args) => (seen.push(args), { code: 0, stderr: "" });

    await host(new FakeGitHubServer(), { git }).push({ branch: "factory/issue-7", sha: "c".repeat(40), expectedSha: null });

    expect(seen[0]![1]).toBe("--force-with-lease=refs/heads/factory/issue-7:");
  });

  it("a rejected lease is branch-moved; any other failure throws without the token", async () => {
    const stale: GitRunner = async () => ({ code: 1, stderr: " ! [rejected] x -> y (stale info)" });
    const broken: GitRunner = async () => ({ code: 128, stderr: "fatal: could not read from https://x-access-token:tok-123@github.com" });
    const input = { branch: "factory/issue-7", sha: "c".repeat(40), expectedSha: null };

    expect(await host(new FakeGitHubServer(), { git: stale }).push(input)).toEqual({ ok: false, reason: "branch-moved" });
    const error = await host(new FakeGitHubServer(), { git: broken }).push(input).catch((e: Error) => e);
    expect((error as Error).message).toContain("git push failed");
    expect((error as Error).message).not.toContain("tok-123");
  });

  it("finds the open pull request of a branch and opens a draft", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls`, ({ query }) => ({ json: query.get("head") === "o:factory/issue-7" && query.get("state") === "open" ? [pr(3)] : [] }));
    s.on("POST", `${R}/pulls`, ({ body }) => ({ status: 201, json: pr(4, { echo: body }) }));
    const h = host(s);

    expect(await h.openPrFor("factory/issue-7")).toEqual({ number: 3, url: "https://github.com/o/r/pull/3", branch: "factory/issue-7", headSha: "a".repeat(40), state: "open", draft: true });
    expect(await h.openPrFor("factory/issue-9")).toBeNull();
    await h.openDraftPr({ branch: "factory/issue-7", base: "main", title: "Fix #7: x", body: "B" });
    expect(s.calls.at(-1)!.body).toEqual({ head: "factory/issue-7", base: "main", title: "Fix #7: x", body: "B", draft: true });
  });

  it("marks ready through GraphQL (REST has no endpoint), updates the body, labels and closes with a comment first", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls/4`, () => ({ json: pr(4) }));
    s.on("POST", "/graphql", ({ body }) => ({ json: { data: { echo: body.variables } } }));
    s.on("PATCH", `${R}/pulls/4`, () => ({ json: pr(4) }));
    s.on("POST", `${R}/issues/4/comments`, () => ({ status: 201, json: {} }));
    s.on("POST", `${R}/issues/4/labels`, () => ({ json: [] }));
    const h = host(s);

    await h.markReady(4);
    await h.updatePrBody(4, "new body");
    await h.labelPr(4, "harness-change");
    await h.closePr(4, "Superseded");

    expect(s.calls.find((c) => c.path === "/graphql")!.body).toMatchObject({ variables: { id: "PR_4" } });
    expect(s.writes()).toEqual([
      "POST /graphql", `PATCH ${R}/pulls/4`, `POST ${R}/issues/4/labels`, `POST ${R}/issues/4/comments`, `PATCH ${R}/pulls/4`,
    ]);
    expect(s.calls.at(-1)!.body).toEqual({ state: "closed" });
  });

  it("a GraphQL error fails markReady", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls/4`, () => ({ json: pr(4) }));
    s.on("POST", "/graphql", () => ({ json: { errors: [{ message: "nope" }] } }));

    await expect(host(s).markReady(4)).rejects.toThrow("nope");
  });

  it("submits a COMMENT review with inline comments on the new side", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", `${R}/pulls/4/reviews`, () => ({ json: {} }));

    await host(s).submitReview(4, { event: "COMMENT", body: "Looks fine", comments: [{ path: "a.ts", line: 3, body: "hm" }] });

    expect(s.calls[0]!.body).toEqual({ event: "COMMENT", body: "Looks fine", comments: [{ path: "a.ts", line: 3, side: "RIGHT", body: "hm" }] });
  });

  it("reads a pull request by number (null when missing) and comments on it as an issue comment", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls/4`, () => ({ json: pr(4, { draft: false }) }));
    s.on("POST", `${R}/issues/4/comments`, () => ({ status: 201, json: {} }));
    const h = host(s);

    expect(await h.pullRequest(4)).toMatchObject({ number: 4, branch: "factory/issue-7", draft: false, state: "open" });
    expect(await h.pullRequest(5)).toBeNull();
    await h.commentPr(4, "stopped");
    expect(s.calls.at(-1)!.body).toEqual({ body: "stopped" });
  });

  it("groups review comments into threads by their root and replies to a thread", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls/4/comments`, () => ({
      json: [
        { id: 10, path: "a.ts", body: "root", user: { login: "alice" } },
        { id: 11, path: "a.ts", body: "reply", user: { login: "bob" }, in_reply_to_id: 10 },
      ],
    }));
    s.on("POST", `${R}/pulls/4/comments/10/replies`, () => ({ status: 201, json: {} }));
    const h = host(s);

    expect(await h.threads(4)).toEqual([{ id: "10", path: "a.ts", author: "alice", body: "root", replies: [{ author: "bob", body: "reply" }] }]);
    await h.replyToThread(4, "10", "done");
    expect(s.calls.at(-1)!.body).toEqual({ body: "done" });
  });

  it("posts the evidence once: the old evidence comment is replaced, the prints attached by gh with the token in its env", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/4/comments`, () => ({ json: [{ id: 90, body: "<!-- factory:evidence -->\nold", user: { login: "bot" } }, { id: 91, body: "other", user: { login: "x" } }] }));
    s.on("DELETE", `${R}/issues/comments/90`, () => ({ status: 204 }));
    const gh: string[][] = [];
    const envs: Record<string, string>[] = [];

    await host(s, { gh: async (args, env) => {
      gh.push(args);
      envs.push(env);
    } }).postEvidence(4, [
      { product: "example", images: [{ name: "home.png", path: "/tmp/out/evidence/example/home.png" }] },
      { product: "other", images: [{ name: "x.png", path: "/tmp/out/evidence/other/x.png" }] },
    ]);

    expect(s.writes()).toEqual([`DELETE ${R}/issues/comments/90`]);
    expect(gh).toHaveLength(1);
    expect(gh[0]!.slice(0, 5)).toEqual(["pr", "comment", "4", "--repo", "o/r"]);
    expect(gh[0]!.filter((a) => a === "--attach")).toHaveLength(2);
    expect(envs[0]).toMatchObject({ GH_TOKEN: "tok-123" });
    expect(JSON.stringify(gh)).not.toContain("tok-123");
  });

  it("keeps the delivery when gh cannot attach: a text comment names the prints", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/4/comments`, () => ({ json: [] }));
    s.on("POST", `${R}/issues/4/comments`, () => ({ status: 201, json: {} }));

    await host(s, { gh: async () => { throw new Error("unknown flag: --attach"); } }).postEvidence(4, [
      { product: "example", images: [{ name: "home.png", path: "/tmp/home.png" }] },
    ]);

    expect(String((s.calls.at(-1)!.body as { body: string }).body)).toMatch(/<!-- factory:evidence -->[\s\S]*example[\s\S]*home\.png[\s\S]*unknown flag/);
  });

  it("dispatches a Factory workflow on the base branch", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", `${R}/actions/workflows/factory-issue.yml/dispatches`, () => ({ status: 204 }));

    await host(s).dispatch("issue", { issue: "7" });

    expect(s.calls[0]!.body).toEqual({ ref: "main", inputs: { issue: "7" } });
  });
});

describe("GitHubCodeHost.push with the real git", () => {
  it("leases against the start SHA: a moved branch is branch-moved, an absent one needs null", async () => {
    const root = await tempDir();
    const bare = `${root}/bare.git`;
    const work = `${root}/work`;
    await git(root, "init", "--quiet", "--bare", "--initial-branch=main", bare);
    await git(root, "init", "--quiet", "--initial-branch=main", work);
    await git(work, "config", "user.email", "t@t");
    await git(work, "config", "user.name", "t");
    await git(work, "commit", "--quiet", "--allow-empty", "-m", "one");
    const one = await git(work, "rev-parse", "HEAD");
    await git(work, "commit", "--quiet", "--allow-empty", "-m", "two");
    const two = await git(work, "rev-parse", "HEAD");
    const h = new GitHubCodeHost({ repo: "o/r", token: "tok", fetch: new FakeGitHubServer().fetch, baseBranch: "main", cwd: work, remoteUrl: bare });

    expect(await h.push({ branch: "factory/issue-7", sha: one, expectedSha: null })).toEqual({ ok: true });
    expect(await h.push({ branch: "factory/issue-7", sha: two, expectedSha: null })).toEqual({ ok: false, reason: "branch-moved" });
    expect(await h.push({ branch: "factory/issue-7", sha: two, expectedSha: two })).toEqual({ ok: false, reason: "branch-moved" });
    expect(await h.push({ branch: "factory/issue-7", sha: two, expectedSha: one })).toEqual({ ok: true });
    expect(await git(bare, "rev-parse", "factory/issue-7")).toBe(two);
  });
});
