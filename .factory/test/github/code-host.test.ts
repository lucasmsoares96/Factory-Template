import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GitHubCodeHost, childEnv, type GhRunner, type GitRunner } from "../../src/adapters/github/github-code-host.ts";
import { marked } from "../../src/marker.ts";
import type { ThreadId } from "../../src/seams/code-host.ts";
import { FakeGitHubServer } from "./fake-github.ts";
// Imported statically: helpers.ts registers the afterEach that removes temp dirs, which a dynamic import inside a test misses.
import { git, tempDir } from "../helpers.ts";

const R = "/repos/o/r";
const pr = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n, html_url: `https://github.com/o/r/pull/${n}`, state: "open", draft: true, node_id: `PR_${n}`,
  head: { ref: "factory/issue-7", sha: "a".repeat(40), repo: { full_name: "o/r" } }, base: { ref: "main" }, ...extra,
});

function host(server: FakeGitHubServer, extra: { git?: GitRunner; gh?: GhRunner } = {}) {
  return new GitHubCodeHost({
    repo: "o/r", token: "tok-123", fetch: server.fetch, baseBranch: "main", cwd: "/work",
    git: extra.git ?? (async () => ({ code: 0, stderr: "" })),
    gh: extra.gh ?? (async () => ""),
  });
}

describe("GitHubCodeHost", () => {
  it("reads the head of a branch, null when it does not exist", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/git/ref/heads/factory/issue-7`, () => ({ json: { object: { sha: "b".repeat(40) } } }));

    expect(await host(s).branchHead("factory/issue-7")).toBe("b".repeat(40));
    expect(await host(s).branchHead("factory/issue-8")).toBeNull();
  });

  it("encodes each segment of the branch in the ref URL, keeping the slashes", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/git/ref/heads/a%20b/c%23d%3Fe`, () => ({ json: { object: { sha: "c".repeat(40) } } }));

    expect(await host(s).branchHead("a b/c#d?e")).toBe("c".repeat(40));
    expect(s.calls[0]!.path).toBe(`${R}/git/ref/heads/a%20b/c%23d%3Fe`);
  });

  it("gives git and gh an allowlisted environment: the parent's secrets are not inherited", () => {
    const parent = { PATH: "/bin", HOME: "/h", FACTORY_TOKEN: "secret", CLAUDE_CODE_OAUTH_TOKEN: "oauth", GH_TOKEN: "ambient", NODE_OPTIONS: "--x" };
    expect(childEnv(parent, {})).toEqual({ PATH: "/bin", HOME: "/h" });
    expect(childEnv(parent, { GH_TOKEN: "tok" })).toEqual({ PATH: "/bin", HOME: "/h", GH_TOKEN: "tok" });
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

    expect(await h.openPrFor("factory/issue-7")).toEqual({ number: 3, url: "https://github.com/o/r/pull/3", branch: "factory/issue-7", headSha: "a".repeat(40), state: "open", draft: true, base: "main", fork: false, labels: [] });
    expect(await h.openPrFor("factory/issue-9")).toBeNull();
    await h.openDraftPr({ branch: "factory/issue-7", base: "main", title: "Fix #7: x", body: "B" });
    expect(s.calls.at(-1)!.body).toEqual({ head: "factory/issue-7", base: "main", title: "Fix #7: x", body: marked("B"), draft: true });
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

    expect(s.calls[0]!.body).toEqual({ event: "COMMENT", body: marked("Looks fine"), comments: [{ path: "a.ts", line: 3, side: "RIGHT", body: marked("hm") }] });
  });

  it("reads a pull request by number (null when missing) and comments on it as an issue comment", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls/4`, () => ({ json: pr(4, { draft: false }) }));
    s.on("POST", `${R}/issues/4/comments`, () => ({ status: 201, json: {} }));
    const h = host(s);

    expect(await h.pullRequest(4)).toMatchObject({ number: 4, branch: "factory/issue-7", draft: false, state: "open" });
    expect(await h.pullRequest(5)).toBeNull();
    await h.commentPr(4, "stopped");
    expect(s.calls.at(-1)!.body).toEqual({ body: marked("stopped") });
  });

  it("lists every open pull request with its base, telling a fork's (or a deleted fork's) from this repository's", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls`, ({ query }) => ({
      json:
        query.get("state") === "open" && query.get("page") === "1"
          ? [
              pr(4, { draft: false }),
              pr(5, { head: { ref: "patch-1", sha: "b".repeat(40), repo: { full_name: "someone/r" } }, base: { ref: "main" } }),
              pr(6, { head: { ref: "gone", sha: "c".repeat(40), repo: null }, base: { ref: "release" } }),
            ]
          : [],
    }));

    const prs = await host(s).openPullRequests();

    expect(prs.map((p) => [p.number, p.branch, p.base, p.fork])).toEqual([
      [4, "factory/issue-7", "main", false],
      [5, "patch-1", "main", true],
      [6, "gone", "release", true],
    ]);
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
    await h.replyToThread(4, "10" as ThreadId, "done");
    expect(s.calls.at(-1)!.body).toEqual({ body: marked("done") });
  });

  it("reads the Conversation as comments and submitted review bodies in time order, without empty or pending ones", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/4/comments`, () => ({
      json: [
        { id: 1, body: "first", user: { login: "alice" }, created_at: "2026-10-26T10:00:00Z" },
        { id: 2, body: "third", user: { login: "bob" }, created_at: "2026-10-26T12:00:00Z" },
      ],
    }));
    s.on("GET", `${R}/pulls/4/reviews`, () => ({
      json: [
        { id: 7, body: "second", user: { login: "alice" }, submitted_at: "2026-10-26T11:00:00Z" },
        { id: 8, body: "", user: { login: "alice" }, submitted_at: "2026-10-26T11:30:00Z" },
        { id: 9, body: "draft", user: { login: "alice" } },
      ],
    }));

    expect(await host(s).conversation(4)).toEqual([
      { id: "comment-1", kind: "comment", author: "alice", body: "first" },
      { id: "review-7", kind: "review", author: "alice", body: "second" },
      { id: "comment-2", kind: "comment", author: "bob", body: "third" },
    ]);
  });

  describe("body with the evidence images", () => {
    const img = { product: "example", name: "home.png", path: "/tmp/out/evidence/example/home.png" };
    const body = `## Evidence\n\n![home](${img.path})`;

    /** A gh runner that records the args, the env and the body file as gh would read it. */
    const recorder = (fail?: Error) => {
      const calls: { args: string[]; env: Record<string, string>; file: string }[] = [];
      const gh: GhRunner = async (args, { env }) => {
        calls.push({ args, env, file: await readFile(args[args.indexOf("--body-file") + 1]!, "utf8") });
        if (fail) throw fail;
        return "";
      };
      return { calls, gh };
    };

    it("opens the draft over REST and has gh edit the body with each print attached, the token only in its env", async () => {
      const s = new FakeGitHubServer();
      s.on("POST", `${R}/pulls`, () => ({ status: 201, json: pr(4) }));
      const r = recorder();

      await host(s, { gh: r.gh }).openDraftPr({ branch: "factory/issue-7", base: "main", title: "t", body, images: [img] });

      expect(r.calls).toHaveLength(1);
      expect(r.calls[0]!.args.slice(0, 5)).toEqual(["pr", "edit", "4", "--repo", "o/r"]);
      expect(r.calls[0]!.args.filter((a, i, all) => all[i - 1] === "--attach")).toEqual([img.path]);
      expect(r.calls[0]!.file).toBe(marked(body));
      expect(r.calls[0]!.env).toMatchObject({ GH_TOKEN: "tok-123" });
      expect(JSON.stringify(r.calls[0]!.args)).not.toContain("tok-123");
    });

    it("rewrites the body of an open PR the same way", async () => {
      const s = new FakeGitHubServer();
      const r = recorder();

      await host(s, { gh: r.gh }).updatePrBody(4, body, [img]);

      expect(r.calls[0]!.args.slice(0, 3)).toEqual(["pr", "edit", "4"]);
      expect(s.writes()).toEqual([]);
    });

    it("uses plain REST and no gh when the body has no images", async () => {
      const s = new FakeGitHubServer();
      s.on("PATCH", `${R}/pulls/4`, () => ({ json: pr(4) }));
      const r = recorder();

      await host(s, { gh: r.gh }).updatePrBody(4, "just text");

      expect(r.calls).toEqual([]);
      expect(s.calls[0]!.body).toEqual({ body: marked("just text") });
    });

    it("keeps the delivery when gh cannot attach: the body is written with the prints named instead of linked", async () => {
      const s = new FakeGitHubServer();
      s.on("PATCH", `${R}/pulls/4`, () => ({ json: pr(4) }));
      const r = recorder(new Error("unknown flag: --attach"));

      await host(s, { gh: r.gh }).updatePrBody(4, body, [img]);

      const written = String((s.calls.at(-1)!.body as { body: string }).body);
      expect(written).not.toContain("/tmp/out");
      expect(written).toMatch(/## Evidence[\s\S]*home\.png[\s\S]*could not be attached[\s\S]*unknown flag/);
    });
  });

  it("reads a pull request's labels and removes one, a label already gone being no error", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/pulls/4`, () => ({ json: pr(4, { labels: [{ name: "factory:working" }, { name: "preview" }] }) }));
    s.on("DELETE", `${R}/issues/4/labels/factory%3Aworking`, () => ({ json: [] }));
    const h = host(s);

    expect((await h.pullRequest(4))!.labels).toEqual(["factory:working", "preview"]);
    await h.unlabelPr(4, "factory:working");
    await h.unlabelPr(5, "factory:working");

    expect(s.writes()).toEqual([`DELETE ${R}/issues/4/labels/factory%3Aworking`, `DELETE ${R}/issues/5/labels/factory%3Aworking`]);
  });

  describe("react", () => {
    it("puts 👀 on a Conversation comment and on a review comment over REST", async () => {
      const s = new FakeGitHubServer();
      s.on("POST", `${R}/issues/comments/11/reactions`, () => ({ status: 201, json: {} }));
      s.on("POST", `${R}/pulls/comments/22/reactions`, () => ({ status: 201, json: {} }));
      const h = host(s);

      await h.react({ pr: 4, kind: "comment", id: 11 }, "eyes");
      await h.react({ pr: 4, kind: "review-comment", id: 22 }, "eyes");

      expect(s.writes()).toEqual([`POST ${R}/issues/comments/11/reactions`, `POST ${R}/pulls/comments/22/reactions`]);
      expect(s.calls.map((c) => c.body)).toEqual([{ content: "eyes" }, { content: "eyes" }]);
    });

    it("puts 👀 on a review through GraphQL, which REST has no endpoint for", async () => {
      const s = new FakeGitHubServer();
      s.on("GET", `${R}/pulls/4/reviews/33`, () => ({ json: { id: 33, node_id: "PRR_33", body: "", user: { login: "alice" }, submitted_at: "2026-10-27T10:00:00Z" } }));
      s.on("POST", "/graphql", () => ({ json: { data: { addReaction: { reaction: { content: "EYES" } } } } }));

      await host(s).react({ pr: 4, kind: "review", id: 33 }, "eyes");

      expect(s.calls.at(-1)!.body).toMatchObject({ variables: { subject: "PRR_33", content: "EYES" } });
      expect(String((s.calls.at(-1)!.body as { query: string }).query)).toContain("addReaction");
    });

    it("a GraphQL error fails the reaction on a review", async () => {
      const s = new FakeGitHubServer();
      s.on("GET", `${R}/pulls/4/reviews/33`, () => ({ json: { id: 33, node_id: "PRR_33", body: "", user: null } }));
      s.on("POST", "/graphql", () => ({ json: { errors: [{ message: "Resource not accessible by integration" }] } }));

      await expect(host(s).react({ pr: 4, kind: "review", id: 33 }, "eyes")).rejects.toThrow("Resource not accessible");
    });
  });

  it("lists the Factory runs queued or going, every page, reading the issue or the PR from the start of the run title", async () => {
    const s = new FakeGitHubServer();
    const run = (id: number, file: string, title: string) => ({ id, path: `.github/workflows/${file}`, display_title: title, status: "x" });
    const runs: Record<string, unknown[]> = {
      queued: [run(1, "factory-issue.yml", "#7 Follow-up to PR #80"), run(2, "ci.yml", "#8 something else")],
      in_progress: [
        ...Array.from({ length: 100 }, (_, i) => run(1000 + i, "factory-update-branches.yml", "Factory update branches")),
        run(3, "factory-pr-feedback.yml", "PR #12 feedback"),
        run(4, "factory-retro.yml", "Retro of PR #13"),
        run(7, "factory-retro.yml", "Retro of #15"),
        run(5, "factory-triage.yml", "Factory triage"),
        // Runs that their workflow's own filter skips: they name nothing, and a skipped Triage is no Triage.
        run(8, "factory-triage.yml", "Factory triage: another label"),
        run(9, "factory-pr-feedback.yml", "Factory PR feedback: not for the Factory"),
        run(10, "factory-issue.yml", "Factory issue: another label"),
      ],
      waiting: [run(6, "factory-update-branches.yml", "PR #14 update branch")],
    };
    s.on("GET", `${R}/actions/runs`, ({ query }) => {
      const all = runs[query.get("status")!] ?? [];
      const page = Number(query.get("page"));
      return { json: { total_count: all.length, workflow_runs: all.slice((page - 1) * 100, page * 100) } };
    });

    const active = await host(s).activeRuns();

    expect(active.filter((r) => r.id < 1000)).toEqual([
      { id: 1, workflow: "factory-issue.yml", issue: 7, pr: null },
      { id: 3, workflow: "factory-pr-feedback.yml", issue: null, pr: 12 },
      { id: 4, workflow: "factory-retro.yml", issue: null, pr: 13 },
      { id: 7, workflow: "factory-retro.yml", issue: 15, pr: null },
      { id: 5, workflow: "factory-triage.yml", issue: null, pr: null },
      { id: 9, workflow: "factory-pr-feedback.yml", issue: null, pr: null },
      { id: 10, workflow: "factory-issue.yml", issue: null, pr: null },
      { id: 6, workflow: "factory-update-branches.yml", issue: null, pr: 14 },
    ]);
    expect(active).toHaveLength(108);
    const statuses = new Set(s.calls.map((c) => new URLSearchParams(c.path.split("?")[1]).get("status")));
    expect([...statuses].sort()).toEqual(["in_progress", "pending", "queued", "requested", "waiting"]);
  });

  it("dispatches a Factory workflow on the base branch", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", `${R}/actions/workflows/factory-issue.yml/dispatches`, () => ({ status: 204 }));

    await host(s).dispatch("issue", { issue: "7" });

    expect(s.calls[0]!.body).toEqual({ ref: "main", inputs: { issue: "7" } });
  });

  it("switches the resume sweep on and off through the workflow's enable and disable endpoints", async () => {
    const s = new FakeGitHubServer();
    s.on("PUT", `${R}/actions/workflows/factory-resume.yml/enable`, () => ({ status: 204 }));
    s.on("PUT", `${R}/actions/workflows/factory-resume.yml/disable`, () => ({ status: 204 }));

    await host(s).setResumeSweep(true);
    await host(s).setResumeSweep(false);

    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT ${R}/actions/workflows/factory-resume.yml/enable`, `PUT ${R}/actions/workflows/factory-resume.yml/disable`]);
  });

  it("dispatches update-branches to factory-update-branches.yml", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", `${R}/actions/workflows/factory-update-branches.yml/dispatches`, () => ({ status: 204 }));

    await host(s).dispatch("update-branches", { pr: "14" });

    expect(s.calls[0]!.body).toEqual({ ref: "main", inputs: { pr: "14" } });
  });

  describe("failedChecks", () => {
    const head = "a".repeat(40);
    const run = (id: number, name: string, conclusion: string | null, status = "completed") => ({ id, name, status, conclusion, head_sha: head, html_url: `https://github.com/o/r/actions/runs/${id}` });
    const job = (id: number, name: string, conclusion: string | null) => ({ id, name, conclusion, html_url: `https://github.com/o/r/actions/runs/1/job/${id}` });
    const server = () => {
      const s = new FakeGitHubServer();
      s.on("GET", `${R}/pulls/4`, () => ({ json: pr(4) }));
      s.on("GET", `${R}/actions/runs`, ({ query }) =>
        query.get("head_sha") === head
          ? { json: { total_count: 4, workflow_runs: [run(1, "Factory PR", "failure"), run(2, "CI", "success"), run(3, "Factory PR feedback", null, "in_progress"), run(4, "Factory PR", "cancelled")] } }
          : { json: { total_count: 0, workflow_runs: [] } },
      );
      s.on("GET", `${R}/actions/runs/1/jobs`, () => ({ json: { total_count: 4, jobs: [job(11, "build", "success"), job(12, "preview smoke", "failure"), job(13, "deploy", "timed_out"), job(14, "lint", "cancelled")] } }));
      s.on("GET", `${R}/actions/runs/3/jobs`, () => ({ json: { total_count: 1, jobs: [job(31, "wait", null)] } }));
      s.on("GET", `${R}/actions/runs/4/jobs`, () => ({ json: { total_count: 1, jobs: [job(41, "build", "cancelled")] } }));
      s.on("GET", `${R}/actions/jobs/12/logs`, () => ({ text: Array.from({ length: 50 }, (_, i) => `smoke ${i + 1}`).join("\n") + "\nGET /api/me failed with status 500\n" }));
      s.on("GET", `${R}/actions/jobs/13/logs`, () => ({ text: "deploying\nThe job has exceeded the maximum execution time\n" }));
      s.on("GET", `${R}/actions/jobs/14/logs`, () => ({ text: "linting\nThe operation was canceled.\n" }));
      return s;
    };

    it("lists the Actions runs of the PR's head, keeps the jobs that failed, timed out or were cancelled and reads the end of each log", async () => {
      const s = server();

      const checks = await host(s).failedChecks(4, 10);

      expect(checks).toEqual([
        { name: "Factory PR / preview smoke", url: "https://github.com/o/r/actions/runs/1/job/12", log: [...Array.from({ length: 9 }, (_, i) => `smoke ${i + 42}`), "GET /api/me failed with status 500"].join("\n") },
        { name: "Factory PR / deploy", url: "https://github.com/o/r/actions/runs/1/job/13", log: "deploying\nThe job has exceeded the maximum execution time" },
        { name: "Factory PR / lint", url: "https://github.com/o/r/actions/runs/1/job/14", log: "linting\nThe operation was canceled." },
      ]);
      expect(s.calls.map((c) => c.path.split("?")[0])).not.toContain(`${R}/actions/runs/2/jobs`);
      expect(s.calls.find((c) => c.path.startsWith(`${R}/actions/runs?`))!.path).toContain(`head_sha=${head}`);
      expect(s.calls.every((c) => c.headers.get("authorization") === "Bearer tok-123")).toBe(true);
      expect(s.writes()).toEqual([]);
    });

    it("skips a run that was itself cancelled, as a run superseded by a newer one on the same head is", async () => {
      const s = server();

      const checks = await host(s).failedChecks(4, 10);

      expect(checks.map((c) => c.url)).not.toContain("https://github.com/o/r/actions/runs/1/job/41");
      expect(s.calls.map((c) => c.path.split("?")[0])).not.toContain(`${R}/actions/runs/4/jobs`);
    });

    it("throws when the runs cannot be listed, without the token in the message", async () => {
      const failing = new FakeGitHubServer();
      failing.on("GET", `${R}/pulls/4`, () => ({ json: pr(4) }));
      failing.on("GET", `${R}/actions/runs`, () => ({ status: 403, json: { message: "Resource not accessible by integration" } }));

      const error = await host(failing).failedChecks(4, 10).catch((e: Error) => e);

      expect((error as Error).message).toMatch(/403.*Resource not accessible by integration/);
      expect((error as Error).message).not.toContain("tok-123");
    });

    it("a log that cannot be read says why in its own check; the other checks keep their logs", async () => {
      const failing = new FakeGitHubServer();
      failing.on("GET", `${R}/pulls/4`, () => ({ json: pr(4) }));
      failing.on("GET", `${R}/actions/runs`, () => ({ json: { total_count: 1, workflow_runs: [run(1, "Factory PR", "failure")] } }));
      failing.on("GET", `${R}/actions/runs/1/jobs`, () => ({ json: { total_count: 2, jobs: [job(12, "preview smoke", "failure"), job(13, "deploy", "timed_out")] } }));
      failing.on("GET", `${R}/actions/jobs/12/logs`, () => ({ status: 410, json: { message: "Gone" } }));
      failing.on("GET", `${R}/actions/jobs/13/logs`, () => ({ text: "deploying\n" }));

      const checks = await host(failing).failedChecks(4, 10);

      expect(checks.map((c) => c.name)).toEqual(["Factory PR / preview smoke", "Factory PR / deploy"]);
      expect(checks[0]!.log).toMatch(/^\(the log could not be read: GitHub GET .*\/actions\/jobs\/12\/logs failed \(410\)/);
      expect(checks[1]!.log).toBe("deploying");
    });
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
  describe("what the Merge Mode reads and writes", () => {
    const head = "a".repeat(40);
    const workflowRun = (id: number, created: string, conclusion: string | null, status = "completed") => ({ id, created_at: created, conclusion, status });

    it("reads the body and every changed file, a rename by both names", async () => {
      const s = new FakeGitHubServer();
      s.on("GET", `${R}/pulls/4`, () => ({ json: { ...pr(4), body: "## Acceptance criteria verdicts", changed_files: 3 } }));
      s.on("GET", `${R}/pulls/4/files`, () => ({ json: [{ filename: "a.ts" }, { filename: "b.ts", previous_filename: "old/b.ts" }, { filename: "c.ts" }] }));

      expect(await host(s).pullRequestBody(4)).toBe("## Acceptance criteria verdicts");
      expect(await host(s).changedFiles(4)).toEqual(["a.ts", "b.ts", "old/b.ts", "c.ts"]);
    });

    it("throws rather than hide a file when GitHub lists fewer than the PR changes", async () => {
      const s = new FakeGitHubServer();
      s.on("GET", `${R}/pulls/4`, () => ({ json: { ...pr(4), body: null, changed_files: 3001 } }));
      s.on("GET", `${R}/pulls/4/files`, () => ({ json: [{ filename: "a.ts" }] }));

      await expect(host(s).changedFiles(4)).rejects.toThrow(/1 of the 3001 files/);
    });

    it("reads the jobs of the newest run of factory-pr.yml at the head, a job still going without a conclusion", async () => {
      const s = new FakeGitHubServer();
      s.on("GET", `${R}/actions/workflows/factory-pr.yml/runs`, ({ query }) =>
        query.get("head_sha") === head
          ? { json: { total_count: 2, workflow_runs: [workflowRun(1, "2026-10-28T10:00:00Z", "failure"), workflowRun(2, "2026-10-28T11:00:00Z", null, "in_progress")] } }
          : { json: { total_count: 0, workflow_runs: [] } },
      );
      s.on("GET", `${R}/actions/runs/2/jobs`, () => ({ json: { total_count: 2, jobs: [{ name: "build (example)", status: "completed", conclusion: "success" }, { name: "verify", status: "in_progress", conclusion: null }] } }));

      expect(await host(s).prChecks(head)).toEqual([{ name: "build (example)", conclusion: "success" }, { name: "verify", conclusion: null }]);
      expect(await host(s).prChecks("b".repeat(40))).toEqual([]);
    });

    it("reads the newest deploy of the base branch that ended, null when none has", async () => {
      const s = new FakeGitHubServer();
      let runs = [workflowRun(1, "2026-10-28T10:00:00Z", "success"), workflowRun(2, "2026-10-28T12:00:00Z", "failure")];
      s.on("GET", `${R}/actions/workflows/factory-deploy.yml/runs`, ({ query }) =>
        query.get("branch") === "main" && query.get("status") === "completed" ? { json: { total_count: runs.length, workflow_runs: runs } } : { status: 400, json: {} },
      );

      expect(await host(s).lastDeploy()).toBe("failure");
      runs = [];
      expect(await host(s).lastDeploy()).toBeNull();
    });

    it("compares the head with the base branch: behind when the head lacks a commit of it", async () => {
      const s = new FakeGitHubServer();
      s.on("GET", `${R}/compare/main...${head}`, () => ({ json: { behind_by: 2, ahead_by: 1 } }));
      s.on("GET", `${R}/compare/main...${"b".repeat(40)}`, () => ({ json: { behind_by: 0, ahead_by: 3 } }));

      expect(await host(s).behindBase(head)).toBe(true);
      expect(await host(s).behindBase("b".repeat(40))).toBe(false);
    });

    it("merges with a merge commit pinned to the head, and a refusal is a result, not a throw", async () => {
      const s = new FakeGitHubServer();
      s.on("PUT", `${R}/pulls/4/merge`, ({ body }) => (body.sha === head ? { json: { merged: true } } : { status: 409, json: { message: "Head branch was modified" } }));

      expect(await host(s).merge(4, head)).toEqual({ ok: true });
      expect(s.calls[0]!.body).toEqual({ sha: head, merge_method: "merge" });
      const refused = await host(s).merge(4, "b".repeat(40));
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.reason).toContain("Head branch was modified");
    });
  });
});
