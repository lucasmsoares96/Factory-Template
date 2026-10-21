import type { IssueRef, PullRequestInfo } from "./clients.ts";
import { labelSpecs } from "./labels.ts";
import type { ProductIdentity, StepContext } from "./steps.ts";

const POLL_MS = 30_000;
const TIMEOUT_MS = 40 * 60_000;
const CLEANUP_WAIT_MS = 5 * 60_000;
const ISSUE_WORKFLOW = "factory-issue.yml";
const CLEANUP_WORKFLOW = "factory-pr-cleanup.yml";

export const EXAMPLE_QUESTION = "Create an example issue and watch the Factory solve it? It takes about 15 minutes and uses Claude credits; everything it creates is deleted at the end.";

type Outcome = "ready" | "escalated" | "run-failed" | "timeout" | "interrupted" | "error";

/** What the example leaves behind when a deletion fails: the thing and the command that removes it. */
interface Leftover {
  what: string;
  command: string;
}

/** The parent spec of the example: the seams the Factory's Development Stage must test through. */
export function parentBody(product: ProductIdentity): string {
  return [
    `A throwaway example created by \`pnpm bootstrap factory\` to watch the Factory work on the Product \`${product.id}\`. It is deleted at the end of the run.`,
    "",
    "## Goal",
    "",
    `Show the Factory turning a small, harmless change to ${product.title} into a pull request with evidence.`,
    "",
    "## Testing Decisions",
    "",
    `- Seam: the Product's own Playwright E2E spec under \`apps/${product.id}/e2e/\`, with an \`@evidence\` screenshot of the changed screen.`,
    "- Every text goes through the Product's i18n messages (`en` and `pt-BR`), never as a literal in a component.",
    "- Never change `packages/skeleton`: the Product extends it by configuration only.",
  ].join("\n");
}

/** The child issue: a Product-only text override that the Skeleton already renders and the Product's E2E can read. */
export function childBody(product: ProductIdentity, parent: number): string {
  return [
    `Part of #${parent}. A throwaway example; it is deleted at the end.`,
    "",
    "## What to build",
    "",
    `Override the sign-in screen title in \`apps/${product.id}/product.config.ts\`, in \`messages\` for both locales: \`auth.signIn.title\` becomes "Welcome to ${product.title}" in \`en\` and "Bem-vindo ao ${product.title}" in \`pt-BR\`. The Skeleton already renders this text, so no change outside \`apps/${product.id}/\` is needed.`,
    "",
    "## Acceptance criteria",
    "",
    `- [ ] \`apps/${product.id}/product.config.ts\` overrides \`auth.signIn.title\` in \`en\` and \`pt-BR\` with the texts above.`,
    `- [ ] The Product's own E2E spec under \`apps/${product.id}/e2e/\` checks that the sign-in screen shows the new title and prints an \`@evidence\` screenshot.`,
    "- [ ] Nothing under `packages/skeleton/` changes.",
  ].join("\n");
}

/** Resolves true when `ms` passed, false when Ctrl-C came first. */
function pause(ctx: StepContext, ms: number): Promise<boolean> {
  const signal = ctx.example?.interrupt?.signal;
  if (!signal) return ctx.sleep(ms).then(() => true);
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
    void ctx.sleep(ms).then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    });
  });
}

/** The last step of `pnpm bootstrap factory`: offers the example. The default is No. Returns the exit code. */
export async function offerExample(ctx: StepContext): Promise<number> {
  if (!ctx.interactive) return 0;
  if (!(await ctx.prompter.confirm({ id: "example-issue", message: EXAMPLE_QUESTION, initial: false }))) return 0;

  const ids = await ctx.listProducts();
  if (ids.length === 0) {
    ctx.log("There is no Product in apps/, so there is nothing to build an example on. Skipping the example.");
    return 0;
  }
  const id = ids.length === 1 ? ids[0]! : await ctx.prompter.select({ id: "example-product", message: "Which Product should the example change?", options: ids.map((value) => ({ value, label: value })) });
  return runExample(ctx, await ctx.product(id));
}

async function runExample(ctx: StepContext, product: ProductIdentity): Promise<number> {
  const { github, log } = ctx;
  const pollMs = ctx.example?.pollMs ?? POLL_MS;
  const timeoutMs = ctx.example?.timeoutMs ?? TIMEOUT_MS;
  const readyLabel = ctx.config.labels.readyForAgent;
  const productLabel = `${ctx.config.labels.productPrefix}${product.id}`;
  const created: { parent?: IssueRef; child?: IssueRef } = {};
  let pr: PullRequestInfo | null = null;
  let previewUrls: string[] = [];
  const knownRuns = new Set<number>();
  let outcome: Outcome = "error";
  let reason = "";
  ctx.example?.interrupt?.hold(true);
  try {
    // The labels first: an issue cannot carry a label that does not exist.
    const have = new Set((await github.listLabels()).map((l) => l.name));
    const wanted = [...labelSpecs(ctx.config).filter((l) => l.name === readyLabel), { name: productLabel, color: "ededed", description: `Work on the ${product.id} Product` }];
    for (const label of wanted) {
      if (have.has(label.name)) continue;
      await github.upsertLabel(label);
      log(`Created the label ${label.name}.`);
    }
    for (const run of await github.workflowRuns(ISSUE_WORKFLOW)) knownRuns.add(run.id);

    created.parent = await github.createIssue({ title: `Example: change the ${product.title} sign-in title`, body: parentBody(product), labels: [] });
    log(`Created the parent spec #${created.parent.number}: ${created.parent.url}`);
    created.child = await github.createIssue({ title: `Example: welcome text on the ${product.title} sign-in screen`, body: childBody(product, created.parent.number), labels: [] });
    await github.addSubIssue(created.parent.number, created.child.number);
    log(`Created the issue #${created.child.number}, a sub-issue of #${created.parent.number}: ${created.child.url}`);
    // The labels go last, once the issue is linked: the label event is what starts the Factory.
    await github.addLabels(created.child.number, [productLabel, readyLabel]);
    log(`Labelled #${created.child.number} ${productLabel} and ${readyLabel}; GitHub starts the Factory run.`);

    const branch = `factory/issue-${created.child.number}`;
    const spin = ctx.prompter.spinner(`Waiting for the Factory (checking every ${Math.round(pollMs / 1000)} s, up to ${Math.round(timeoutMs / 60_000)} min)`);
    const seen = new Set<string>();
    const step = (key: string, line: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      log(line);
    };
    let waited = 0;
    let runUrl = "";
    try {
      for (;;) {
        const labels = await github.issueLabels(created.child.number);
        const runs = (await github.workflowRuns(ISSUE_WORKFLOW)).filter((r) => !knownRuns.has(r.id));
        const run = runs[0];
        if (run && !runUrl) {
          runUrl = run.url;
          step("run", `The Factory run started: ${run.url}`);
        }
        pr = (await github.findPullRequest(branch)) ?? pr;
        if (pr) step("pr", `The Factory opened pull request #${pr.number}: ${pr.url}`);
        if (labels.includes(ctx.config.labels.readyForHuman)) {
          outcome = "escalated";
          reason = `The Factory escalated: #${created.child.number} got ${ctx.config.labels.readyForHuman}${pr ? "" : " and no pull request"}.${runUrl ? ` Run: ${runUrl}` : ""}`;
          break;
        }
        if (pr) {
          const status = await github.pullRequestStatus(pr.number);
          if (status.previewComment) {
            previewUrls = [...new Set(status.previewComment.match(/https:\/\/[^\s)>\]"]+/g) ?? [])].filter((u) => !u.startsWith("https://github.com/"));
            step("preview", `The preview comment appeared on #${pr.number}${previewUrls.length ? `: ${previewUrls.join(" ")}` : ""}`);
          }
          if (status.previewComment || status.checksDone) {
            if (!status.previewComment) step("checks", `The checks of #${pr.number} finished: ${pr.url}/checks`);
            outcome = "ready";
            break;
          }
        }
        const failed = runs.find((r) => r.status === "completed" && r.conclusion !== null && !["success", "skipped"].includes(r.conclusion));
        if (failed && !pr) {
          outcome = "run-failed";
          reason = `The factory-issue.yml run ${failed.conclusion}: ${failed.url}`;
          break;
        }
        if (waited >= timeoutMs) {
          outcome = "timeout";
          reason = `No result after ${Math.round(timeoutMs / 60_000)} minutes${runUrl ? `; run: ${runUrl}` : ""}.`;
          break;
        }
        spin.update(`Waiting for the Factory, ${Math.round(waited / 60_000)} min so far${runUrl ? ` (${runUrl})` : ""}`);
        if (!(await pause(ctx, pollMs))) {
          outcome = "interrupted";
          reason = "Interrupted (Ctrl-C).";
          break;
        }
        waited += pollMs;
      }
    } finally {
      spin.stop(outcome === "ready" ? "The Factory finished" : "Stopped waiting");
    }
  } catch (error) {
    outcome = "error";
    reason = `The example stopped on an error: ${(error as Error).message}`;
  } finally {
    // Always: pass, fail, timeout or error.
    try {
      if (pr && outcome !== "interrupted") {
        log(`Pull request: ${pr.url}`);
        if (previewUrls.length) log(`Preview: ${previewUrls.join(" ")}`);
        await ctx.prompter.pause({ id: "example-delete", message: "Press Enter to delete the example" });
      }
    } catch (error) {
      log(`Skipping the pause: ${(error as Error).message}`);
    }
    const left = await cleanUp(ctx, created, knownRuns, pollMs);
    ctx.example?.interrupt?.hold(false);
    if (left.length > 0) {
      log("Some of the example is still there. Remove it by hand:");
      for (const item of left) log(`  ${item.what}: ${item.command}`);
    } else if (created.parent) {
      log("The example is deleted: the issues, the pull request, its branch and its preview.");
    }
  }
  if (outcome === "ready") {
    log("The Factory solved the example: the pull request is ready for review.");
    return 0;
  }
  log(`${reason || `The example ended with: ${outcome}.`}`);
  log("The example did not come out ready. Your Factory setup itself is fine; look at the run above, or try again later.");
  return 1;
}

/** Deletes everything the example made, one thing at a time, so a failure leaves only that thing. */
async function cleanUp(ctx: StepContext, created: { parent?: IssueRef; child?: IssueRef }, knownRuns: Set<number>, pollMs: number): Promise<Leftover[]> {
  const { github, log } = ctx;
  const left: Leftover[] = [];
  const attempt = async (what: string, command: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      log(`Could not delete ${what}: ${(error as Error).message}`);
      left.push({ what, command });
    }
  };
  const child = created.child;
  if (child) {
    const branch = `factory/issue-${child.number}`;
    // A run of the example still going would open a pull request after the cleanup.
    await attempt("the running Factory workflow", `gh run list --workflow ${ISSUE_WORKFLOW}, then gh run cancel <id>`, async () => {
      for (const run of await github.workflowRuns(ISSUE_WORKFLOW)) if (run.status !== "completed" && !knownRuns.has(run.id)) await github.cancelRun(run.id);
    });
    // Closing (not merging) the PR makes factory-pr-cleanup.yml delete the Worker Preview and the Neon branch.
    await attempt(`the pull request of ${branch}`, `gh pr close <number> (find it with: gh pr list --head ${branch} --state all)`, async () => {
      const pr = await github.findPullRequest(branch);
      if (!pr || pr.state !== "open") return;
      const before = new Set((await github.workflowRuns(CLEANUP_WORKFLOW)).map((r) => r.id));
      await github.closePullRequest(pr.number);
      log(`Closed pull request #${pr.number} without merging; waiting for the cleanup of its preview.`);
      let waited = 0;
      for (;;) {
        const run = (await github.workflowRuns(CLEANUP_WORKFLOW)).find((r) => !before.has(r.id));
        if (run?.status === "completed") {
          if (run.conclusion === "success") log(`The preview cleanup finished: ${run.url}`);
          else if (run.conclusion === "skipped") log(`The preview cleanup was skipped (previews are off): ${run.url}`);
          else throw new Error(`the preview cleanup run ${run.conclusion}: ${run.url}. The Worker Preview pr-${pr.number} and the Neon branch preview/pr-${pr.number} may remain`);
          return;
        }
        if (waited >= CLEANUP_WAIT_MS) throw new Error(`no finished preview cleanup run after ${CLEANUP_WAIT_MS / 60_000} minutes${run ? ` (${run.url})` : ""}. Check the PR cleanup workflow in Actions`);
        await ctx.sleep(pollMs);
        waited += pollMs;
      }
    });
    await attempt(`the branch ${branch}`, `gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/${branch}`, () => github.deleteBranch(branch));
    let followUps: IssueRef[] = [];
    await attempt("the follow-up issues of the Skeleton", `gh issue list --state all --search "The Skeleton must grow" (then gh issue delete <number> --yes for each that mentions #${child.number})`, async () => {
      followUps = await github.findSkeletonFollowUps(child.number);
    });
    for (const followUp of followUps) await attempt(`follow-up issue #${followUp.number}`, `gh issue delete ${followUp.number} --yes`, () => github.deleteIssue(followUp.number));
    await attempt(`issue #${child.number}`, `gh issue delete ${child.number} --yes`, () => github.deleteIssue(child.number));
  }
  if (created.parent) {
    const parent = created.parent;
    await attempt(`issue #${parent.number}`, `gh issue delete ${parent.number} --yes`, () => github.deleteIssue(parent.number));
  }
  return left;
}
