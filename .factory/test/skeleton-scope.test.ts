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
const NEW = "packages/skeleton/src/new.ts";
const PRODUCT = { "ready-for-agent": HUMAN, "product:example": HUMAN };

/** Development edits the Product and, wrongly, the Skeleton root layout and its template. */
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
  output: `Reviewed.\n<skeleton-gap>The root layout needs a footer slot.</skeleton-gap>\n<review>${JSON.stringify({ summary: "Looks fine.", inline: [], ...extra })}</review>`,
});
const review = reviewing({ criteriaMetWithoutSkeleton: true });

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
    env: { FACTORY_MAX_ATTEMPTS: String(options.attempts ?? 5) },
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

/** The Skeleton pull request: the one on the Skeleton issue's branch. */
const skeletonPr = (w: Awaited<ReturnType<typeof run>>["w"], issue: number) => w.codeHost.prs.find((p) => p.branch === `factory/issue-${issue}`);

describe("Skeleton scope of a Product issue", () => {
  it("reverts Skeleton changes in a new commit and turns them into a ready Skeleton pull request; the Product PR stays ready", async () => {
    const { w, workCheckout, publishCheckout, result, filesOf } = await run({ labels: PRODUCT });

    // The Skeleton is back to the base; the Product change stays; history is only added to.
    expect(await git(workCheckout, "show", `HEAD:${LAYOUT}`)).toBe("export const Layout = 'plain';");
    expect(await git(workCheckout, "show", `HEAD:${TEMPLATE}`)).toBe("export const T = 'plain';");
    expect(await git(workCheckout, "ls-tree", "--name-only", "HEAD", NEW)).toBe("");
    expect(await git(workCheckout, "show", "HEAD:apps/example/src/home.tsx")).toBe("export const Home = 1;");
    expect((await git(workCheckout, "log", "--format=%s", "main..HEAD")).split("\n")).toEqual([
      "revert: drop Skeleton changes from Product issue #7",
      "feat: footer #7",
    ]);

    expect(result.outcome).toBe("ready");
    expect(result.followUps).toHaveLength(1);
    expect(result.followUps[0]).toMatchObject({ files: [LAYOUT, NEW, TEMPLATE], patch: "skeleton.patch" });

    // The Skeleton issue is in the Tracker, linked back and waiting for a human to approve its pull request.
    const followUp = w.tracker.issues.get(8)!;
    expect(followUp.title).toContain("The Skeleton must grow");
    expect(followUp.body).toContain("The root layout needs a footer slot.");
    expect(followUp.body).toContain("#7");
    expect(followUp.relatedTo).toBe(7);
    expect(w.tracker.labelsOf(8)).toEqual(["ready-for-human"]);

    // Its pull request: not a draft, from the base, exactly the reverted files, closing the Skeleton issue.
    const skeleton = skeletonPr(w, 8)!;
    expect(skeleton).toMatchObject({ draft: false, state: "open", base: "main" });
    expect(skeleton.body).toContain("Closes #8");
    expect(skeleton.body).toContain("#7");
    expect(skeleton.body).toContain("<skeleton-gap>\nThe root layout needs a footer slot.\n</skeleton-gap>");
    expect(skeleton.body).not.toContain("Closes #7");
    expect(await filesOf(skeleton.headSha)).toEqual([LAYOUT, NEW, TEMPLATE]);
    expect(await git(publishCheckout, "rev-parse", `${skeleton.headSha}^`)).toBe(result.base);

    // The Product PR and the issue mention it, the result is delivered, and nothing is blocked.
    const product = w.codeHost.prs.find((p) => p.branch === "factory/issue-7")!;
    expect(product.body).toContain("#8");
    expect(product).toMatchObject({ draft: false });
    expect(await filesOf(product.headSha)).toEqual(["apps/example/src/home.tsx"]);
    expect(w.tracker.commentsOn(7).some((c) => c.body.includes("#8") && c.body.includes(`#${skeleton.number}`))).toBe(true);
    expect(await w.tracker.blockers(7)).toEqual([]);
    expect(lastJson(w.logs)).toMatchObject({ issue: 7, outcome: "ready" });
  });

  it("puts the Product issue back in the queue, blocked by the Skeleton issue, when the Review does not say the criteria are met without it", async () => {
    for (const extra of [{}, { criteriaMetWithoutSkeleton: false }]) {
      const { w, result, filesOf } = await run({ labels: PRODUCT, review: reviewing(extra) });
      expect(result).toMatchObject({ outcome: "waiting", reason: null, evidence: [], pullRequestStage: null });
      expect(result.review.criteriaMetWithoutSkeleton).toBe(false);

      expect(w.tracker.labelsOf(8)).toEqual(["ready-for-human"]);
      const skeleton = skeletonPr(w, 8)!;
      expect(skeleton).toMatchObject({ draft: false });
      expect(await filesOf(skeleton.headSha)).toEqual([LAYOUT, NEW, TEMPLATE]);

      // No Escalation and no Product pull request: the next run starts from the base that has the new Skeleton.
      expect(w.tracker.labelsOf(7).filter((l) => !l.startsWith("product:") && l !== "factory:working")).toEqual(["ready-for-agent"]);
      expect(await w.tracker.blockers(7)).toEqual([{ number: 8, done: false }]);
      expect(w.codeHost.prs.map((p) => p.branch)).toEqual(["factory/issue-8"]);
      expect(w.codeHost.branches.has("factory/issue-7")).toBe(false);
      const comments = w.tracker.commentsOn(7);
      expect(comments.some((c) => c.body.includes("escalation"))).toBe(false);
      expect(comments.at(-1)!.body).toContain(`#${skeleton.number}`);
      expect(w.codeHost.dispatches).toEqual([]);
      expect(lastJson(w.logs)).toMatchObject({ issue: 7, outcome: "waiting", blockedBy: [8] });
    }
  });

  it("recognises a Product issue by `apps/<id>` in its text", async () => {
    const { w } = await run({ labels: { "ready-for-agent": HUMAN }, body: `${ISSUE_BODY}\nTouches \`apps/example\` only.\n` });
    expect(w.tracker.issues.get(8)?.relatedTo).toBe(7);
  });

  it("waits on the Skeleton issue, naming it, when the criteria fail without the Skeleton change", async () => {
    const { w, result } = await run({
      labels: PRODUCT,
      attempts: 2,
      verify: [{ ok: false, failedCommand: "pnpm test:e2e", output: "no footer" }, { ok: false, failedCommand: "pnpm test:e2e", output: "no footer" }],
    });

    expect(result).toMatchObject({ outcome: "waiting", reason: null });
    expect(w.tracker.issues.get(8)?.relatedTo).toBe(7);
    expect(w.tracker.labelsOf(7).filter((l) => !l.startsWith("product:") && l !== "factory:working")).toEqual(["ready-for-agent"]);
    expect(await w.tracker.blockers(7)).toEqual([{ number: 8, done: false }]);
    expect(w.tracker.commentsOn(7).at(-1)!.body).toContain("#8");
    // The second Development hears that the Skeleton change was removed.
    expect(w.agent.calls.filter((c) => c.stage === "development")[1]!.prompt).toContain("packages/skeleton/");
  });

  it("writes one <skeleton-gap> when Development and the Review report the same gap, and shows the Review that gap", async () => {
    const gapDev: AgentStep = async (call) => {
      await develop(call);
      return { output: "Done.\n<skeleton-gap>\nthe ROOT  layout\n  needs a **footer** slot\n</skeleton-gap>" };
    };
    const { w } = await run({ labels: PRODUCT, develop: gapDev });

    const body = w.tracker.issues.get(8)!.body;
    expect(body.match(/<skeleton-gap>/g)).toHaveLength(1);
    expect(body).toContain("the ROOT  layout\n  needs a **footer** slot");
    expect(w.agent.calls.find((c) => c.stage === "review")!.prompt).toContain("the ROOT  layout\n  needs a **footer** slot");
  });

  it("keeps two different gaps from Development and the Review", async () => {
    const gapDev: AgentStep = async (call) => {
      await develop(call);
      return { output: "Done.\n<skeleton-gap>The header needs a logo slot.</skeleton-gap>" };
    };
    const { w } = await run({ labels: PRODUCT, develop: gapDev });

    const body = w.tracker.issues.get(8)!.body;
    expect(body.match(/<skeleton-gap>/g)).toHaveLength(2);
    expect(body).toContain("The header needs a logo slot.");
    expect(body).toContain("The root layout needs a footer slot.");
  });

  /** Development reports `gap`; the Review reports the default footer gap. Returns the follow-up issue's body. */
  async function followUpBody(gap: string) {
    const gapDev: AgentStep = async (call) => {
      await develop(call);
      return { output: `Done.\n<skeleton-gap>${gap}</skeleton-gap>` };
    };
    const { w } = await run({ labels: PRODUCT, develop: gapDev });
    return w.tracker.issues.get(8)!.body;
  }

  it("keeps the longer of two gaps when one contains the other", async () => {
    const body = await followUpBody("The root layout needs a footer slot, so a Product can add its links.");
    expect(body.match(/<skeleton-gap>/g)).toHaveLength(1);
    expect(body).toContain("The root layout needs a footer slot, so a Product can add its links.");
  });

  it("does not let a short gap swallow a longer one that mentions it", async () => {
    const body = await followUpBody("Footer slot.");
    expect(body.match(/<skeleton-gap>/g)).toHaveLength(2);
    expect(body).toContain("Footer slot.");
    expect(body).toContain("The root layout needs a footer slot.");
  });

  it("keeps every attempt's Skeleton change in the Skeleton pull request, the last one winning per file", async () => {
    let n = 0;
    const twice: AgentStep = async ({ cwd }) => {
      n++;
      await commitFiles(cwd, n === 1 ? { [LAYOUT]: "export const Layout = 'one';\n", [NEW]: "export {};\n" } : { [LAYOUT]: "export const Layout = 'two';\n", [TEMPLATE]: "export const T = 'two';\n" }, `feat: footer ${n} #7`);
      return { output: "Done." };
    };
    const { w, publishCheckout, filesOf } = await run({
      labels: PRODUCT,
      develop: twice,
      attempts: 2,
      verify: [{ ok: false, failedCommand: "pnpm test:e2e", output: "no footer" }, { ok: false, failedCommand: "pnpm test:e2e", output: "no footer" }],
    });

    const skeleton = skeletonPr(w, 8)!;
    expect(await filesOf(skeleton.headSha)).toEqual([LAYOUT, NEW, TEMPLATE]);
    expect(await git(publishCheckout, "show", `${skeleton.headSha}:${LAYOUT}`)).toBe("export const Layout = 'two';");
  });

  it("keeps the Skeleton change in its pull request when the Review undoes it itself, and says so only once on the issue", async () => {
    const undoing: AgentStep = async ({ cwd }) => {
      await git(cwd, "checkout", "main", "--", LAYOUT, TEMPLATE);
      await git(cwd, "rm", "--quiet", NEW);
      await git(cwd, "-c", "user.name=Review", "-c", "user.email=review@localhost", "commit", "--quiet", "-m", "revert: Skeleton #7");
      return { output: `<skeleton-gap>The root layout needs a footer slot.</skeleton-gap>\n<review>${JSON.stringify({ summary: "Undone.", inline: [] })}</review>` };
    };
    const { w, workCheckout, result, filesOf } = await run({ labels: PRODUCT, review: undoing });

    expect((await git(workCheckout, "log", "--format=%s", "main..HEAD")).split("\n")).toEqual(["revert: Skeleton #7", "feat: footer #7"]);
    expect(result).toMatchObject({ outcome: "waiting" });
    expect(result.followUps[0]).toMatchObject({ files: [LAYOUT, NEW, TEMPLATE], patch: "skeleton.patch" });
    expect(await filesOf(skeletonPr(w, 8)!.headSha)).toEqual([LAYOUT, NEW, TEMPLATE]);

    // The run the `ready-for-agent` label starts finds the issue blocked and adds no second "Waiting on" comment.
    const before = w.tracker.commentsOn(7).length;
    await w.factory("claim", "7", "--event", "labeled");
    expect(lastJson(w.logs)).toMatchObject({ claimed: false });
    expect(w.tracker.commentsOn(7)).toHaveLength(before);
  });

  it("opens only a needs-triage issue, no pull request, for a gap with no Skeleton files", async () => {
    const met = await run({ labels: PRODUCT, develop: productOnly });
    expect(met.result).toMatchObject({ outcome: "ready" });
    expect(met.result.followUps[0]).toMatchObject({ files: [], patch: null });
    expect(met.w.tracker.labelsOf(8)).toEqual(["needs-triage"]);
    expect(skeletonPr(met.w, 8)).toBeUndefined();
    expect(await met.w.tracker.blockers(7)).toEqual([]);

    // A Product that cannot finish without it waits on it too.
    const unmet = await run({ labels: PRODUCT, develop: productOnly, review: reviewing({}) });
    expect(unmet.result).toMatchObject({ outcome: "waiting" });
    expect(unmet.w.tracker.labelsOf(8)).toEqual(["needs-triage"]);
    expect(unmet.w.codeHost.prs).toEqual([]);
    expect(unmet.w.tracker.labelsOf(7).filter((l) => !l.startsWith("product:") && l !== "factory:working")).toEqual(["ready-for-agent"]);
    expect(await unmet.w.tracker.blockers(7)).toEqual([{ number: 8, done: false }]);
  });

  it("refuses a Skeleton patch that reaches outside packages/skeleton/: infra Escalation, no Skeleton pull request", async () => {
    const outside = [
      "diff --git a/apps/example/src/evil.ts b/apps/example/src/evil.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/apps/example/src/evil.ts",
      "@@ -0,0 +1 @@",
      "+export const evil = 1;",
      "",
    ].join("\n");
    const { w } = await run({
      labels: PRODUCT,
      between: async (artifacts) => writeFile(join(artifacts, "skeleton.patch"), (await readFile(join(artifacts, "skeleton.patch"), "utf8")) + outside),
    });

    expect(w.codeHost.prs).toEqual([]);
    expect([...w.tracker.issues.keys()]).toEqual([1, 7]);
    expect(w.tracker.labelsOf(7)).toContain("ready-for-human");
    expect(w.tracker.commentsOn(7).at(-1)!.body).toContain("outside packages/skeleton/: apps/example/src/evil.ts");
    expect(lastJson(w.logs)).toMatchObject({ issue: 7, outcome: "escalated", reason: "infra" });
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
