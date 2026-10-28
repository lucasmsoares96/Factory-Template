import type { IssueRef, PullRequestInfo } from "./clients.ts";
import { LANGUAGES, messages, type Language } from "../messages.ts";
import { LANGUAGE_VARIABLE } from "./common.ts";
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
export function parentBody(product: ProductIdentity, language: Language): string {
  return messages(language).exampleParentBody(product.id, product.title);
}

/** The child issue: a Product-only text override that the Skeleton already renders and the Product's E2E can read. */
export function childBody(product: ProductIdentity, parent: number, language: Language): string {
  return messages(language).exampleChildBody(product.id, product.title, parent);
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

    // The issues are public text: the repo's FACTORY_LANGUAGE, the language step's answer, not this shell's env.
    const variable = (await github.listVariables())[LANGUAGE_VARIABLE];
    const language = LANGUAGES.find((l) => l === variable) ?? ctx.config.language;
    const m = messages(language);
    created.parent = await github.createIssue({ title: m.exampleParentTitle(product.title), body: parentBody(product, language), labels: [] });
    log(`Created the parent spec #${created.parent.number}: ${created.parent.url}`);
    created.child = await github.createIssue({ title: m.exampleChildTitle(product.title), body: childBody(product, created.parent.number, language), labels: [] });
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
    // Always: pass, fail, timeout or error. Deleting is the default, and also what Ctrl-C picks; keeping is a choice.
    let keep = false;
    try {
      if (pr && outcome !== "interrupted") {
        log(`Pull request: ${pr.url}`);
        if (previewUrls.length) log(`Preview: ${previewUrls.join(" ")}`);
        keep =
          (await ctx.prompter.choose({
            id: "example-delete",
            message: "What should happen to the example?",
            options: [
              { value: "delete", label: "Delete it: the issues, the pull request, its branch and its preview (recommended)" },
              { value: "keep", label: "Keep it: review or merge the pull request yourself, and delete the rest later" },
            ],
            onCancel: "delete",
          })) === "keep";
      }
    } catch (error) {
      log(`Skipping the question, deleting the example: ${(error as Error).message}`);
    }
    if (keep && created.child && created.parent && pr) {
      keptReport(ctx, created.parent, created.child, pr);
    } else {
      const left = await cleanUp(ctx, created, knownRuns, pollMs);
      if (left.length > 0) {
        log("Some of the example is still there. Remove it by hand:");
        for (const item of left) log(`  ${item.what}: ${item.command}`);
      } else if (created.parent) {
        log("The example is deleted: the issues, the pull request, its branch and its preview.");
      }
    }
    ctx.example?.interrupt?.hold(false);
  }
  if (outcome === "ready") {
    log("The Factory solved the example: the pull request is ready for review.");
    return 0;
  }
  log(`${reason || `The example ended with: ${outcome}.`}`);
  log("The example did not come out ready. Your Factory setup itself is fine; look at the run above, or try again later.");
  return 1;
}

/** The example stays: what is left and the commands that delete it later. */
function keptReport(ctx: StepContext, parent: IssueRef, child: IssueRef, pr: PullRequestInfo) {
  const branch = `factory/issue-${child.number}`;
  ctx.log(
    [
      "The example stays. What is left:",
      `  pull request #${pr.number} (${branch}) with its preview: ${pr.url}`,
      `  issue #${child.number} and its parent spec #${parent.number}`,
      "Merging the pull request closes the issue and deletes its preview. To delete it all instead:",
      `  gh pr close ${pr.number} --delete-branch   (factory-pr-cleanup.yml then deletes the preview and its Neon branch)`,
      `  gh issue delete ${child.number} --yes && gh issue delete ${parent.number} --yes`,
      `  and any "The Skeleton must grow" issue that mentions #${child.number}.`,
    ].join("\n"),
  );
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
