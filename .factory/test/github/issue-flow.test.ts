import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHubCodeHost } from "../../src/adapters/github/github-code-host.ts";
import { GitHubTracker } from "../../src/adapters/github/github-tracker.ts";
import { FakeAgent } from "../../src/adapters/fake/fake-agent.ts";
import { FakeVerify } from "../../src/adapters/fake/fake-verify.ts";
import { runFactory } from "../../src/cli.ts";
import { tempDir } from "../helpers.ts";
import { FakeGitHubServer } from "./fake-github.ts";

// Seam 1 on the GitHub semantics: the CLI runs over the real GitHub adapters, with a stateful fake of the REST API.
const R = "/repos/o/r";

interface Issue {
  number: number;
  state: "open" | "closed";
  reason: string | null;
  body: string;
  labels: Set<string>;
  events: { event: string; label: string; actor: string }[];
  comments: string[];
  blockedBy: number[];
  parent: number | null;
}

function githubWorld(issues: Partial<Issue>[], writers = ["alice", "owner"]) {
  const server = new FakeGitHubServer();
  const store = new Map<number, Issue>();
  for (const seed of issues) {
    store.set(seed.number!, { state: "open", reason: null, body: "", labels: new Set(), events: [], comments: [], blockedBy: [], parent: null, ...seed } as Issue);
  }
  const json = (i: Issue) => ({ number: i.number, title: `T${i.number}`, body: i.body, state: i.state, state_reason: i.reason, labels: [...i.labels].map((name) => ({ name })) });
  const get = (n: string) => store.get(Number(n));
  const hooks = { pulls: [] as unknown[], afterIssueRead: (_issue: Issue) => {} };
  server.on("GET", `${R}/issues/(\\d+)`, ({ params }) => {
    const issue = get(params[0]!);
    if (!issue) return { status: 404 };
    const response = { json: json(issue) };
    hooks.afterIssueRead(issue);
    return response;
  });
  server.on("GET", `${R}/issues`, () => ({ json: [] }));
  server.on("PATCH", `${R}/issues/(\\d+)`, ({ params, body }) => ((get(params[0]!)!.body = body.body), { json: {} }));
  server.on("GET", `${R}/issues/(\\d+)/parent`, ({ params }) => {
    const parent = store.get(get(params[0]!)?.parent ?? -1);
    return parent ? { json: json(parent) } : { status: 404 };
  });
  server.on("GET", `${R}/issues/(\\d+)/sub_issues`, () => ({ json: [] }));
  server.on("GET", `${R}/issues/(\\d+)/comments`, ({ params }) => ({ json: get(params[0]!)!.comments.map((body, i) => ({ id: i + 1, body, user: { login: "owner" } })) }));
  server.on("POST", `${R}/issues/(\\d+)/comments`, ({ params, body }) => (get(params[0]!)!.comments.push(body.body), { status: 201, json: {} }));
  server.on("GET", `${R}/issues/(\\d+)/events`, ({ params }) => ({ json: get(params[0]!)!.events.map((e) => ({ event: e.event, label: { name: e.label }, actor: { login: e.actor } })) }));
  server.on("GET", `${R}/issues/(\\d+)/dependencies/blocked_by`, ({ params }) => ({ json: get(params[0]!)!.blockedBy.map((n) => json(store.get(n)!)) }));
  server.on("DELETE", `${R}/issues/(\\d+)/labels/([^/]+)`, ({ params }) => {
    const issue = get(params[0]!)!;
    const name = decodeURIComponent(params[1]!);
    return issue.labels.delete(name) ? { json: [] } : { status: 404, json: { message: "Label does not exist" } };
  });
  server.on("POST", `${R}/issues/(\\d+)/labels`, ({ params, body }) => {
    for (const l of body.labels) get(params[0]!)!.labels.add(l);
    return { json: [] };
  });
  server.on("GET", `${R}/collaborators/([^/]+)/permission`, ({ params }) =>
    writers.includes(params[0]!) ? { json: { permission: "write", role_name: "write" } } : { status: 404 },
  );
  server.on("GET", `${R}/pulls`, () => ({ json: hooks.pulls }));
  server.on("GET", `${R}/git/ref/heads/.+`, () => ({ status: 404 }));
  return { server, store, hooks };
}

const BODY = "## Acceptance criteria\n\n- [ ] works\n";
const SPEC = "# Spec\n\n## Testing Decisions\n\n1. CLI.\n";
const ready = (extra: Partial<Issue> = {}): Partial<Issue>[] => [
  { number: 1, body: SPEC },
  { number: 7, body: BODY, parent: 1, labels: new Set(["ready-for-agent"]), events: [{ event: "labeled", label: "ready-for-agent", actor: "alice" }], ...extra },
];

async function run(w: ReturnType<typeof githubWorld>, argv: string[], env: Record<string, string> = {}) {
  const logs: string[] = [];
  const full = { ...env };
  const code = await runFactory(argv, {
    env: full,
    log: (line) => logs.push(line),
    adapters: ({ config }) => ({
      tracker: new GitHubTracker({ repo: "o/r", token: "t", fetch: w.server.fetch }),
      codeHost: new GitHubCodeHost({ repo: "o/r", token: "t", fetch: w.server.fetch, baseBranch: config.baseBranch, cwd: "/nowhere" }),
      agent: new FakeAgent("/nowhere", {}),
      verify: new FakeVerify("/nowhere", "ev", []),
    }),
  });
  return { code, logs };
}

describe("factory claim over the GitHub adapters", () => {
  it("takes the lock through the label API and tells the workflow through GITHUB_OUTPUT", async () => {
    const w = githubWorld(ready());
    const out = join(await tempDir(), "output");
    await writeFile(out, "");

    const { code } = await run(w, ["claim", "7", "--event", "labeled"], { GITHUB_OUTPUT: out });

    expect(code).toBe(0);
    expect([...w.store.get(7)!.labels]).toEqual(["in-progress", "factory:working"]);
    expect(await readFile(out, "utf8")).toBe("claimed=true\nrequester=alice\nstart_sha=\nbranch=factory/issue-7\npr=\n");
  });

  it("a second claim of the same issue loses the lock: the label is already gone", async () => {
    const w = githubWorld(ready());
    await run(w, ["claim", "7"]);
    const out = join(await tempDir(), "output");
    await writeFile(out, "");

    const { logs } = await run(w, ["claim", "7"], { GITHUB_OUTPUT: out });

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ claimed: false, reason: "not-ready" });
    expect(await readFile(out, "utf8")).toBe("claimed=false\nrequester=alice\nreason=not-ready\n");
  });

  it("refuses a label put by someone without write, read from the events and the permission API", async () => {
    const w = githubWorld(ready({ events: [{ event: "labeled", label: "ready-for-agent", actor: "mallory" }] }));

    const { logs } = await run(w, ["claim", "7"]);

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ claimed: false, reason: "label-actor-cannot-write" });
    expect([...w.store.get(7)!.labels]).toEqual(["ready-for-agent"]);
  });

  it("a blocker closed as not planned still blocks; the labeled event explains once with a comment", async () => {
    const w = githubWorld([...ready({ blockedBy: [3] }), { number: 3, state: "closed", reason: "not_planned" }]);

    const first = await run(w, ["claim", "7", "--event", "labeled"]);
    await run(w, ["claim", "7", "--event", "labeled"]);

    expect(JSON.parse(first.logs.at(-1)!)).toMatchObject({ claimed: false, reason: "blocked" });
    expect(w.store.get(7)!.comments).toHaveLength(1);
    expect(w.store.get(7)!.comments[0]).toContain("Waiting on #3");
  });

  it("a blocker closed as completed lets the claim through", async () => {
    const w = githubWorld([...ready({ blockedBy: [3] }), { number: 3, state: "closed", reason: "completed" }]);

    const { logs } = await run(w, ["claim", "7"]);

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ claimed: true });
  });

  it("without acceptance criteria the label moves to needs-info", async () => {
    const w = githubWorld(ready({ body: "no criteria" }));

    await run(w, ["claim", "7"]);

    expect([...w.store.get(7)!.labels]).toEqual(["needs-info"]);
  });
});

describe("factory publish over the GitHub adapters", () => {
  it("with no result from work, escalates `infra` on the issue and hands it to a human", async () => {
    const w = githubWorld(ready({ labels: new Set(["in-progress"]) }));
    const empty = await tempDir();

    const { code, logs } = await run(w, ["publish", "7", "--in", empty, "--repo", empty], { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "99" });

    expect(code).toBe(0);
    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ outcome: "escalated", reason: "infra", pr: null });
    expect([...w.store.get(7)!.labels]).toEqual(["ready-for-human"]);
    expect(w.store.get(7)!.comments.at(-1)).toContain("https://github.com/o/r/actions/runs/99");
    expect(w.server.writes().some((c) => c.includes("/pulls"))).toBe(false);
  });

  it("discards the run when the issue lost in-progress meanwhile", async () => {
    const w = githubWorld(ready({ labels: new Set(["needs-info"]) }));
    const empty = await tempDir();

    const { logs } = await run(w, ["publish", "7", "--in", empty, "--repo", empty]);

    expect(JSON.parse(logs.at(-1)!)).toMatchObject({ outcome: "discarded" });
    expect([...w.store.get(7)!.labels]).toEqual(["needs-info"]);
  });
});


describe("factory unblock over the GitHub adapters: the criteria of a merged Factory PR", () => {
  const closedBody = "## Acceptance criteria\n\n- [ ] works\n\n## Notes\n\n- [ ] later\n";
  const merged = [{ number: 101, html_url: "u", state: "closed", draft: false, merged_at: "2026-01-01T00:00:00Z", head: { ref: "factory/issue-7", sha: "a", repo: { full_name: "o/r" } }, base: { ref: "main" }, labels: [] }];

  function closedWorld(pulls: unknown[] = merged, reason = "completed") {
    const w = githubWorld([{ number: 7, body: closedBody, state: "closed", reason }]);
    w.hooks.pulls = pulls;
    return w;
  }

  it("writes the checked body verbatim: no marker, other sections as they were", async () => {
    const w = closedWorld();

    const { code } = await run(w, ["unblock", "--issue", "7"]);

    expect(code).toBe(0);
    expect(w.store.get(7)!.body).toBe("## Acceptance criteria\n\n- [x] works\n\n## Notes\n\n- [ ] later\n");
  });

  it("does not write for an issue closed as not planned, or with no merged PR", async () => {
    const notPlanned = closedWorld(merged, "not_planned");
    const noPr = closedWorld([]);

    await run(notPlanned, ["unblock", "--issue", "7"]);
    await run(noPr, ["unblock", "--issue", "7"]);

    expect(notPlanned.server.writes()).toEqual([]);
    expect(noPr.server.writes()).toEqual([]);
  });

  it("keeps an edit made between the read and the write, and checks the boxes on top of it", async () => {
    const w = closedWorld();
    const edited = `${closedBody}\nAdded by a person meanwhile.\n`;
    // The first read of the body is followed at once by a concurrent edit.
    let reads = 0;
    w.hooks.afterIssueRead = (issue) => {
      if (++reads === 1) issue.body = edited;
    };

    await run(w, ["unblock", "--issue", "7"]);

    expect(w.store.get(7)!.body).toBe("## Acceptance criteria\n\n- [x] works\n\n## Notes\n\n- [ ] later\n\nAdded by a person meanwhile.\n");
  });
});
