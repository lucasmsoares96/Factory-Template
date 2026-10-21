import { describe, expect, it } from "vitest";
import { GitHubTracker } from "../../src/adapters/github/github-tracker.ts";
import { marked } from "../../src/marker.ts";
import { FakeGitHubServer } from "./fake-github.ts";

const R = "/repos/o/r";
const issue = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n, title: `T${n}`, body: `B${n}`, state: "open", state_reason: null, labels: [{ name: "ready-for-agent" }], user: { login: "alice" }, ...extra,
});

function tracker(server: FakeGitHubServer) {
  return new GitHubTracker({ repo: "o/r", token: "tok-123", fetch: server.fetch });
}

describe("GitHubTracker", () => {
  it("reads an issue with its parent, children and comments, with the token only in the header", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/7`, () => ({ json: issue(7) }));
    s.on("GET", `${R}/issues/7/parent`, () => ({ json: issue(1, { body: "# Spec" }) }));
    s.on("GET", `${R}/issues/7/sub_issues`, () => ({ json: [] }));
    s.on("GET", `${R}/issues/7/comments`, () => ({ json: [{ id: 5, body: "hi", user: { login: "bob" } }] }));

    const got = await tracker(s).issue(7);

    expect(got).toMatchObject({
      number: 7, title: "T7", body: "B7", state: "open", labels: ["ready-for-agent"],
      parent: { number: 1, body: "# Spec" }, children: [], comments: [{ id: "5", author: "bob", body: "hi" }],
    });
    expect(s.calls.every((c) => c.headers.get("authorization") === "Bearer tok-123")).toBe(true);
    expect(JSON.stringify(got)).not.toContain("tok-123");
  });

  it("has no parent when GitHub answers 404 and lists sub-issues as children", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/1`, () => ({ json: issue(1) }));
    s.on("GET", `${R}/issues/1/sub_issues`, () => ({ json: [issue(7), issue(8)] }));
    s.on("GET", `${R}/issues/1/comments`, () => ({ json: [] }));

    const got = await tracker(s).issue(1);

    expect(got.parent).toBeNull();
    expect(got.children).toEqual([7, 8]);
  });

  it("follows pagination for comments", async () => {
    const s = new FakeGitHubServer();
    const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: from + i, body: `c${from + i}`, user: { login: "bob" } }));
    s.on("GET", `${R}/issues/7`, () => ({ json: issue(7) }));
    s.on("GET", `${R}/issues/7/parent`, () => ({ status: 404 }));
    s.on("GET", `${R}/issues/7/sub_issues`, () => ({ json: [] }));
    s.on("GET", `${R}/issues/7/comments`, ({ query }) => ({ json: query.get("page") === "1" ? page(1, 100) : page(101, 3) }));

    expect((await tracker(s).issue(7)).comments).toHaveLength(103);
  });

  it("a blocker is done only when closed as completed", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/7/dependencies/blocked_by`, () => ({
      json: [issue(2, { state: "closed", state_reason: "completed" }), issue(3, { state: "closed", state_reason: "not_planned" }), issue(4)],
    }));

    expect(await tracker(s).blockers(7)).toEqual([
      { number: 2, done: true },
      { number: 3, done: false },
      { number: 4, done: false },
    ]);
  });

  it("lists the open issues a number blocks and the open issues with a label, leaving pull requests out", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/7/dependencies/blocking`, () => ({ json: [issue(8), issue(9, { state: "closed" })] }));
    s.on("GET", `${R}/issues`, ({ query }) => ({
      json: query.get("labels") === "ready-for-agent" && query.get("state") === "open" ? [issue(10), issue(11, { pull_request: {} })] : [],
    }));

    expect(await tracker(s).blocking(7)).toEqual([8]);
    expect(await tracker(s).labeled("ready-for-agent")).toEqual([10]);
  });

  it("swapLabel is the lock: removing a label that is gone is false and adds nothing", async () => {
    const s = new FakeGitHubServer();
    let present = true;
    s.on("DELETE", `${R}/issues/7/labels/ready-for-agent`, () => (present ? ((present = false), { json: [] }) : { status: 404 }));
    s.on("POST", `${R}/issues/7/labels`, () => ({ json: [] }));

    expect(await tracker(s).swapLabel(7, "ready-for-agent", "in-progress")).toBe(true);
    expect(await tracker(s).swapLabel(7, "ready-for-agent", "in-progress")).toBe(false);
    expect(s.writes()).toEqual([
      `DELETE ${R}/issues/7/labels/ready-for-agent`,
      `POST ${R}/issues/7/labels`,
      `DELETE ${R}/issues/7/labels/ready-for-agent`,
    ]);
    expect(s.calls[1]!.body).toEqual({ labels: ["in-progress"] });
  });

  it("encodes label names with a colon", async () => {
    const s = new FakeGitHubServer();
    s.on("DELETE", `${R}/issues/7/labels/agent%3Aexplore`, () => ({ json: [] }));
    s.on("POST", `${R}/issues/7/labels`, () => ({ json: [] }));

    expect(await tracker(s).swapLabel(7, "agent:explore", "x")).toBe(true);
  });

  it("removeLabel deletes the label and tolerates one that is gone", async () => {
    const s = new FakeGitHubServer();
    s.on("DELETE", `${R}/issues/7/labels/in-progress`, () => ({ json: [] }));
    s.on("DELETE", `${R}/issues/8/labels/in-progress`, () => ({ status: 404 }));

    await tracker(s).removeLabel(7, "in-progress");
    await tracker(s).removeLabel(8, "in-progress");

    expect(s.writes()).toEqual([`DELETE ${R}/issues/7/labels/in-progress`, `DELETE ${R}/issues/8/labels/in-progress`]);
  });

  it("comments", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", `${R}/issues/7/comments`, () => ({ status: 201, json: {} }));

    await tracker(s).comment(7, "hello");

    expect(s.calls[0]!.body).toEqual({ body: marked("hello") });
  });

  it("creates an issue through the REST helper", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", `${R}/issues`, ({ body }) => ({ status: 201, json: { number: 42, html_url: "https://github.com/o/r/issues/42", echo: body } }));

    const made = await tracker(s).createIssue({ title: "T", body: "B", labels: ["needs-triage"], relatedTo: 7 });

    expect(made).toEqual({ number: 42, url: "https://github.com/o/r/issues/42" });
    expect(s.calls[0]!.body).toMatchObject({ labels: ["needs-triage"], body: expect.stringContaining("Related to #7") });
  });

  it("canWrite is true for admin, maintain and write, false for triage, read, none and strangers", async () => {
    const s = new FakeGitHubServer();
    const roles: Record<string, string> = { a: "admin", m: "maintain", w: "write", t: "triage", r: "read" };
    s.on("GET", `${R}/collaborators/([^/]+)/permission`, ({ params }) =>
      roles[params[0]!] ? { json: { permission: roles[params[0]!] === "maintain" ? "write" : roles[params[0]!] === "triage" ? "read" : roles[params[0]!], role_name: roles[params[0]!] } } : { status: 404 },
    );
    const t = tracker(s);

    expect(await Promise.all(["a", "m", "w", "t", "r", "nobody"].map((l) => t.canWrite(l)))).toEqual([true, true, true, false, false, false]);
  });

  it("labelActor is who applied the label last, null once it was removed or never there", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/7/events`, () => ({
      json: [
        { event: "labeled", label: { name: "ready-for-agent" }, actor: { login: "mallory" } },
        { event: "unlabeled", label: { name: "ready-for-agent" }, actor: { login: "alice" } },
        { event: "labeled", label: { name: "ready-for-agent" }, actor: { login: "alice" } },
        { event: "labeled", label: { name: "other" }, actor: { login: "zed" } },
      ],
    }));
    s.on("GET", `${R}/issues/8/events`, () => ({
      json: [{ event: "labeled", label: { name: "ready-for-agent" }, actor: { login: "alice" } }, { event: "unlabeled", label: { name: "ready-for-agent" }, actor: { login: "alice" } }],
    }));
    const t = tracker(s);

    expect(await t.labelActor(7, "ready-for-agent")).toBe("alice");
    expect(await t.labelActor(8, "ready-for-agent")).toBeNull();
  });

  it("a refused call says what failed without leaking the token", async () => {
    const s = new FakeGitHubServer();
    s.on("GET", `${R}/issues/7`, () => ({ status: 403, json: { message: "Resource not accessible" } }));

    const error = await tracker(s).issue(7).catch((e: Error) => e);

    expect((error as Error).message).toContain("403");
    expect((error as Error).message).not.toContain("tok-123");
  });
});
