import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import type { VerifyStep } from "../src/adapters/fake/fake-verify.ts";
import { createGitHubIssue } from "../src/adapters/github/create-issue.ts";
import { MarkdownTracker } from "../src/adapters/local/markdown-tracker.ts";
import { derivedCheckout, commitFile, commitFiles, git, HUMAN, ISSUE_BODY, lastJson, tempDir, world } from "./helpers.ts";

const LAYOUT = "packages/skeleton/src/layout.tsx";
const TEMPLATE = "packages/skeleton/template/src/home.tsx";

/** Development edits the Product and, wrongly, the Skeleton root layout and its template. */
const develop: AgentStep = async ({ cwd }) => {
  await commitFiles(
    cwd,
    { "apps/example/src/home.tsx": "export const Home = 1;\n", [LAYOUT]: "export const Layout = 'footer';\n", [TEMPLATE]: "export const T = 'footer';\n", "packages/skeleton/src/new.ts": "export {};\n" },
    "feat: footer #7",
  );
  return { output: "Done." };
};

const reviewing = (extra: object): AgentStep => () => ({
  output: `Reviewed.\n<skeleton-gap>The root layout needs a footer slot.</skeleton-gap>\n<review>${JSON.stringify({ summary: "Looks fine.", inline: [], ...extra })}</review>`,
});
const review = reviewing({ criteriaMetWithoutSkeleton: true });

/** A checkout whose base commit holds the Skeleton files; the commit is made once per file and copied. */
const skeletonCheckout = () =>
  derivedCheckout("skeleton", (dir) =>
    commitFiles(dir, { [LAYOUT]: "export const Layout = 'plain';\n", [TEMPLATE]: "export const T = 'plain';\n" }, "chore: skeleton"),
  );

/** claim → work → publish on two checkouts that share a base commit holding the Skeleton files. */
async function run(options: { labels: Record<string, string>; body?: string; develop?: AgentStep; verify?: VerifyStep[]; attempts?: number; review?: AgentStep }) {
  const workCheckout = await skeletonCheckout();
  const publishCheckout = await skeletonCheckout();
  const artifacts = await tempDir("factory-artifacts-");
  const w = world({
    repo: workCheckout,
    issues: [
      { number: 1, title: "Spec", body: "# Spec\n\n## Testing Decisions\n\n1. CLI.\n" },
      { number: 7, title: "Footer on the home page", body: options.body ?? ISSUE_BODY, parent: 1, labels: options.labels },
    ],
    agent: {
      development: Array.from({ length: options.attempts ?? 1 }, () => options.develop ?? develop),
      review: Array.from({ length: options.attempts ?? 1 }, () => options.review ?? review),
    },
    env: { FACTORY_MAX_ATTEMPTS: String(options.attempts ?? 5) },
    verify: options.verify ?? [{ ok: true }],
  });
  await w.factory("claim", "7");
  const claimed = lastJson(w.logs) as { startSha: string | null };
  await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts);
  const result = JSON.parse(await readFile(join(artifacts, "result.json"), "utf8"));
  await w.factory("publish", "7", "--repo", publishCheckout, "--in", artifacts, "--start-sha", claimed.startSha ?? "");
  return { w, workCheckout, result };
}

describe("Skeleton scope of a Product issue", () => {
  it("reverts Skeleton changes in a new commit, opens a linked follow-up and stays ready", async () => {
    const { w, workCheckout, result } = await run({ labels: { "ready-for-agent": HUMAN, "product:example": HUMAN } });

    // The Skeleton is back to the base; the Product change stays; history is only added to.
    expect(await git(workCheckout, "show", `HEAD:${LAYOUT}`)).toBe("export const Layout = 'plain';");
    expect(await git(workCheckout, "show", `HEAD:${TEMPLATE}`)).toBe("export const T = 'plain';");
    expect(await git(workCheckout, "ls-tree", "--name-only", "HEAD", "packages/skeleton/src/new.ts")).toBe("");
    expect(await git(workCheckout, "show", "HEAD:apps/example/src/home.tsx")).toBe("export const Home = 1;");
    expect((await git(workCheckout, "log", "--format=%s", "main..HEAD")).split("\n")).toEqual([
      "revert: drop Skeleton changes from Product issue #7",
      "feat: footer #7",
    ]);

    expect(result.outcome).toBe("ready");
    expect(result.followUps).toHaveLength(1);
    expect(result.followUps[0].files).toEqual([LAYOUT, "packages/skeleton/src/new.ts", TEMPLATE]);

    // The follow-up ticket is in the Tracker, linked back and waiting for triage.
    const followUp = w.tracker.issues.get(8)!;
    expect(followUp.title).toContain("The Skeleton must grow");
    expect(followUp.body).toContain("The root layout needs a footer slot.");
    expect(followUp.body).toContain("#7");
    expect(followUp.relatedTo).toBe(7);
    expect(w.tracker.labelsOf(8)).toEqual(["needs-triage"]);

    // The PR and the issue mention it, and the result is delivered.
    expect(w.codeHost.prs[0]!.body).toContain("#8");
    expect(w.codeHost.prs[0]).toMatchObject({ draft: false });
    expect(w.tracker.commentsOn(7).some((c) => c.body.includes("#8"))).toBe(true);
    expect(lastJson(w.logs)).toMatchObject({ issue: 7, outcome: "ready" });
  });

  it("is needs-human, not ready, when E2E is green but the Review does not say the criteria are met without the Skeleton", async () => {
    const silent = await run({ labels: { "ready-for-agent": HUMAN, "product:example": HUMAN }, review: reviewing({}) });
    expect(silent.result).toMatchObject({ outcome: "escalated", reason: "needs-human", evidence: [] });
    expect(silent.result.question).toContain("could not be met without a change in the Skeleton");
    expect(silent.result.review.criteriaMetWithoutSkeleton).toBe(false);
    expect(silent.w.codeHost.prs[0]).toMatchObject({ draft: true });
    expect(silent.w.tracker.labelsOf(7)).toContain("ready-for-human");
    expect(silent.w.tracker.issues.get(8)?.relatedTo).toBe(7);

    const no = await run({ labels: { "ready-for-agent": HUMAN, "product:example": HUMAN }, review: reviewing({ criteriaMetWithoutSkeleton: false }) });
    expect(no.result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
  });

  it("recognises a Product issue by `apps/<id>` in its text", async () => {
    const { w } = await run({ labels: { "ready-for-agent": HUMAN }, body: `${ISSUE_BODY}\nTouches \`apps/example\` only.\n` });
    expect(w.tracker.issues.get(8)?.relatedTo).toBe(7);
  });

  it("escalates as needs-human, naming the follow-up, when the criteria fail without the Skeleton change", async () => {
    const { w, result } = await run({
      labels: { "ready-for-agent": HUMAN, "product:example": HUMAN },
      attempts: 2,
      verify: [{ ok: false, failedCommand: "pnpm test:e2e", output: "no footer" }, { ok: false, failedCommand: "pnpm test:e2e", output: "no footer" }],
    });

    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    expect(result.question).toContain("Skeleton");
    expect(w.tracker.issues.get(8)?.relatedTo).toBe(7);
    expect(w.tracker.labelsOf(7)).toContain("ready-for-human");
    const escalation = w.tracker.commentsOn(7).at(-1)!.body;
    expect(escalation).toContain("needs-human");
    expect(escalation).toContain("#8");
    // The second Development hears that the Skeleton change was removed.
    expect(w.agent.calls.filter((c) => c.stage === "development")[1]!.prompt).toContain("packages/skeleton/");
  });

  it("writes one <skeleton-gap> when Development and the Review report the same gap, and shows the Review that gap", async () => {
    const gapDev: AgentStep = async (call) => {
      await develop(call);
      return { output: "Done.\n<skeleton-gap>\nThe root layout needs a **footer** slot\n</skeleton-gap>" };
    };
    const { w } = await run({ labels: { "ready-for-agent": HUMAN, "product:example": HUMAN }, develop: gapDev });

    const body = w.tracker.issues.get(8)!.body;
    expect(body.match(/<skeleton-gap>/g)).toHaveLength(1);
    expect(body).toContain("The root layout needs a **footer** slot");
    expect(w.agent.calls.find((c) => c.stage === "review")!.prompt).toContain("The root layout needs a **footer** slot");
  });

  it("keeps two different gaps from Development and the Review", async () => {
    const gapDev: AgentStep = async (call) => {
      await develop(call);
      return { output: "Done.\n<skeleton-gap>The header needs a logo slot.</skeleton-gap>" };
    };
    const { w } = await run({ labels: { "ready-for-agent": HUMAN, "product:example": HUMAN }, develop: gapDev });

    const body = w.tracker.issues.get(8)!.body;
    expect(body.match(/<skeleton-gap>/g)).toHaveLength(2);
    expect(body).toContain("The header needs a logo slot.");
    expect(body).toContain("The root layout needs a footer slot.");
  });

  it("leaves an issue whose own scope is the Skeleton untouched", async () => {
    const skeletonDev: AgentStep = async ({ cwd }) => {
      await commitFile(cwd, LAYOUT, "export const Layout = 'footer';\n", "feat: skeleton footer slot #7");
    };
    const { w, workCheckout, result } = await run({
      labels: { "ready-for-agent": HUMAN },
      body: `${ISSUE_BODY}\nChange \`packages/skeleton/src/layout.tsx\`.\n`,
      develop: skeletonDev,
    });

    expect(await git(workCheckout, "show", `HEAD:${LAYOUT}`)).toBe("export const Layout = 'footer';");
    expect(result.followUps).toEqual([]);
    expect([...w.tracker.issues.keys()]).toEqual([1, 7]);
  });
});

describe("Tracker.createIssue", () => {
  it("the Markdown Tracker writes the next NN-slug.md linked to the original", async () => {
    const dir = join(await tempDir("factory-md-"), "issues");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "07-footer.md"), "# 07: Footer\n\n**Blocked by:** None\n\n**Status:** in-progress\n");
    const tracker = new MarkdownTracker({ dir, self: "factory", human: "lucas" });

    const created = await tracker.createIssue({ title: "The Skeleton must grow: footer slot", body: "Add a slot.", labels: ["needs-triage"], relatedTo: 7 });

    expect(created.number).toBe(8);
    expect(await readdir(dir)).toEqual(["07-footer.md", "08-the-skeleton-must-grow-footer-slot.md"]);
    const text = await readFile(join(dir, "08-the-skeleton-must-grow-footer-slot.md"), "utf8");
    expect(text).toContain("# 08: The Skeleton must grow: footer slot");
    expect(text).toContain("**Related to:** [07](07-footer.md)");
    expect(text).toContain("Add a slot.");
    const issue = await tracker.issue(8);
    expect(issue).toMatchObject({ number: 8, labels: ["needs-triage"], state: "open" });
    expect(await tracker.blockers(8)).toEqual([]);
  });

  it("the GitHub adapter posts the issue through the REST API", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/o/r/issues/42", id: 1 }), { status: 201 });
    }) as unknown as typeof fetch;

    const created = await createGitHubIssue(
      { repo: "o/r", token: "tok", fetch: fetcher },
      { title: "The Skeleton must grow", body: "Body.", labels: ["needs-triage"], relatedTo: 7 },
    );

    expect(created).toEqual({ number: 42, url: "https://github.com/o/r/issues/42" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/issues");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer tok", Accept: "application/vnd.github+json" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      title: "The Skeleton must grow",
      body: "Body.\n\nRelated to #7",
      labels: ["needs-triage"],
    });
  });

  it("the GitHub adapter fails loudly on an error response", async () => {
    const fetcher = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    await expect(createGitHubIssue({ repo: "o/r", token: "t", fetch: fetcher }, { title: "t", body: "b" })).rejects.toThrow(/403/);
  });
});
