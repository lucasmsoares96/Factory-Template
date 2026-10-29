import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import type { VerifyStep } from "../src/adapters/fake/fake-verify.ts";
import { createGitHubIssue } from "../src/adapters/github/create-issue.ts";
import { MarkdownTracker } from "../src/adapters/local/markdown-tracker.ts";
import { resultSchema } from "../src/result.ts";
import { derivedCheckout, commitFile, commitFiles, git, HUMAN, ISSUE_BODY, lastJson, tempDir, world } from "./helpers.ts";

const LAYOUT = "packages/skeleton/src/layout.tsx";
const TEMPLATE = "packages/skeleton/template/src/home.tsx";
const NEW = "packages/skeleton/src/new.ts";
const PRODUCT = { "ready-for-agent": HUMAN, "product:example": HUMAN };

/** Development edits the Product and, because the Product needs it, the Skeleton root layout and its template. */
const develop: AgentStep = async ({ cwd }) => {
  await commitFiles(
    cwd,
    { "apps/example/src/home.tsx": "export const Home = 1;\n", [LAYOUT]: "export const Layout = 'footer';\n", [TEMPLATE]: "export const T = 'footer';\n", [NEW]: "export {};\n" },
    "feat: footer #7",
  );
  return { output: "Done." };
};

/** Development edits the Product only. */
const productOnly: AgentStep = async ({ cwd }) => {
  await commitFile(cwd, "apps/example/src/home.tsx", "export const Home = 1;\n", "feat: footer #7");
  return { output: "Done." };
};

const reviewing = (extra: object): AgentStep => () => ({
  output: `Reviewed.\n<review>${JSON.stringify({ summary: "Looks fine.", inline: [], ...extra })}</review>`,
});
const verdict = (met: boolean) => ({ criterion: "`greet()` returns a greeting.", met, proof: met ? "`apps/example/e2e/home.spec.ts` › greets" : "The footer needs the Skeleton's slot." });
const review = reviewing({ criteria: [verdict(true)] });

/** A checkout whose base commit holds the Skeleton files; the commit is made once per file and copied. */
const skeletonCheckout = () =>
  derivedCheckout("skeleton", (dir) =>
    commitFiles(dir, { [LAYOUT]: "export const Layout = 'plain';\n", [TEMPLATE]: "export const T = 'plain';\n" }, "chore: skeleton"),
  );

/** claim → work → publish on two checkouts that share a base commit holding the Skeleton files. */
async function run(options: {
  labels: Record<string, string>;
  body?: string;
  develop?: AgentStep;
  verify?: VerifyStep[];
  attempts?: number;
  review?: AgentStep;
  /** Runs between `work` and `publish`, on the artifacts. */
  between?: (artifacts: string) => Promise<void>;
  env?: Record<string, string>;
}) {
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
    env: { FACTORY_MAX_ATTEMPTS: String(options.attempts ?? 5), ...options.env },
    verify: options.verify ?? [{ ok: true }],
  });
  await w.factory("claim", "7");
  const claimed = lastJson(w.logs) as { startSha: string | null };
  await w.factory("work", "7", "--repo", workCheckout, "--out", artifacts);
  const result = JSON.parse(await readFile(join(artifacts, "result.json"), "utf8"));
  await options.between?.(artifacts);
  await w.factory("publish", "7", "--repo", publishCheckout, "--in", artifacts, "--start-sha", claimed.startSha ?? "");
  /** The files a pushed commit changes against the run's base, in the publish checkout. */
  const filesOf = async (sha: string) => (await git(publishCheckout, "diff", "--name-only", "--no-renames", result.base, sha)).split("\n").filter(Boolean);
  return { w, workCheckout, publishCheckout, artifacts, result, filesOf };
}


describe("Skeleton change in a Product issue (ADR 0017)", () => {
  it("sends the whole branch to one pull request, with a warning that lists the Skeleton files, and opens nothing else", async () => {
    const { w, workCheckout, result, filesOf } = await run({ labels: PRODUCT });

    // Nothing is reverted: the Skeleton keeps what Development wrote, and the log has no revert commit.
    expect(await git(workCheckout, "show", `HEAD:${LAYOUT}`)).toBe("export const Layout = 'footer';");
    expect((await git(workCheckout, "log", "--format=%s", "main..HEAD")).split("\n")).toEqual(["feat: footer #7"]);
    expect(result.outcome).toBe("ready");

    // One pull request, ready, with the Product and the Skeleton files.
    expect(w.codeHost.prs).toHaveLength(1);
    const pr = w.codeHost.prs[0]!;
    expect(pr.branch).toBe("factory/issue-7");
    expect(pr.draft).toBe(false);
    expect(await filesOf(result.head)).toEqual(["apps/example/src/home.tsx", LAYOUT, NEW, TEMPLATE].sort());
    // The warning opens the body, lists the files and says every Product is reached.
    expect(pr.body.trimStart().startsWith("<!-- factory -->") ? pr.body.replace(/^\s*<!-- factory -->\s*/, "") : pr.body).toMatch(/^> \[!WARNING\]\n> This pull request changes the Skeleton/);
    for (const file of [LAYOUT, NEW, TEMPLATE]) expect(pr.body).toContain(file);
    expect(pr.body).toContain("reaches every Product");
    expect(pr.body).not.toContain("apps/example/src/home.tsx`");

    // No follow-up issue, no block, and the issue is not put back in the queue.
    expect([...w.tracker.issues.keys()]).toEqual([1, 7]);
    expect(lastJson(w.logs)).toMatchObject({ issue: 7, outcome: "ready" });
    expect(w.tracker.commentsOn(7).some((c) => c.body.includes("Waiting on"))).toBe(false);
  });

  it("writes the warning in FACTORY_LANGUAGE", async () => {
    const { w } = await run({ labels: PRODUCT, env: { FACTORY_LANGUAGE: "pt-BR" } });
    expect(w.codeHost.prs[0]!.body).toContain("Este pull request altera o Skeleton");
  });

  it("opens the pull request of a Product-only change with no warning", async () => {
    const { w, result } = await run({ labels: PRODUCT, develop: productOnly });

    expect(result.outcome).toBe("ready");
    expect(w.codeHost.prs).toHaveLength(1);
    expect(w.codeHost.prs[0]!.body).not.toContain("changes the Skeleton");
    expect([...w.tracker.issues.keys()]).toEqual([1, 7]);
  });

  it("asks the Review for the generic check only when the diff touches the Skeleton", async () => {
    const touched = await run({ labels: PRODUCT });
    const reviewPrompt = (r: typeof touched) => r.w.agent.calls.find((c) => c.stage === "review")!.prompt;
    expect(reviewPrompt(touched)).toContain("Check that it is generic");
    const productOnlyRun = await run({ labels: PRODUCT, develop: productOnly });
    expect(reviewPrompt(productOnlyRun)).not.toContain("Check that it is generic");
  });

  it("leaves an issue whose own scope is the Skeleton untouched", async () => {
    const skeletonDev: AgentStep = async ({ cwd }) => {
      await commitFile(cwd, LAYOUT, "export const Layout = 'footer';\n", "feat: skeleton footer slot #7");
    };
    const { w, workCheckout } = await run({
      labels: { "ready-for-agent": HUMAN },
      body: `${ISSUE_BODY}\nChange \`packages/skeleton/src/layout.tsx\`.\n`,
      develop: skeletonDev,
    });

    expect(await git(workCheckout, "show", `HEAD:${LAYOUT}`)).toBe("export const Layout = 'footer';");
    expect([...w.tracker.issues.keys()]).toEqual([1, 7]);
  });
});

describe("result.json of the old Skeleton split", () => {
  const sha = "a".repeat(40);
  const old = {
    version: 1, issue: 7, branch: "factory/issue-7", base: sha, head: sha, outcome: "waiting", reason: null, question: null,
    attempts: [], review: { summary: "", inline: [] }, threadReplies: [],
    usage: { development: { inputTokens: 0, outputTokens: 0 }, review: { inputTokens: 0, outputTokens: 0 } },
    evidence: [],
    followUps: [{ title: "The Skeleton must grow: x", body: "b", files: [LAYOUT], gaps: ["Gap."], patch: "skeleton.patch" }],
  };

  it("is still read: `waiting` becomes a needs-human Escalation and followUps is ignored", () => {
    const result = resultSchema.parse(old);
    expect(result).toMatchObject({ outcome: "escalated", reason: "needs-human" });
    expect(result).not.toHaveProperty("followUps");
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
