import { isProtectedPath, type MergeMode } from "../config.ts";
import { catalog, LANGUAGES, messages } from "../messages.ts";
import type { CodeHost, PrCheck } from "../seams/code-host.ts";
import type { CommandContext } from "./context.ts";

/** Every condition of a merge without a person, in the order the comment and the output name them. */
export type MergeCondition = "protected" | "verify" | "preview" | "criteria" | "deploy";

export type MergeOutcome =
  | { pr: number; mode: MergeMode; merged: true }
  | { mode: "human"; merged: false; reason: "mode" }
  | { pr?: number; mode: MergeMode; merged: false; reason: "no-pr" | "not-factory" | "not-ready" | "working" }
  | { pr: number; mode: MergeMode; merged: false; reason: "conditions"; unmet: MergeCondition[]; protected?: string[] }
  | { pr: number; mode: MergeMode; merged: false; reason: "refused"; detail: string };

/** The jobs of `factory-pr.yml` that make or test a preview; `preview comment` and `preview-label` only report. */
const PREVIEW_JOB = /^preview(-plan$| deploy \(| smoke \()/;
const PASSED = new Set(["success", "skipped"]);
/** A deploy that ended like this stops every merge without a person until one passes. */
const DEPLOY_FAILED = new Set(["failure", "timed_out", "cancelled", "startup_failure", "action_required", "stale"]);

/**
 * The Merge Mode's decision (ADR 0016), run by `factory-merge.yml` with the default branch's code when the checks of a
 * pull request end. Deterministic: in `human` it merges nothing; in `safe` it merges the open, ready Factory pull request
 * of `branch` only when no file of its diff is protected, `verify` passed, no preview job failed, every acceptance
 * criterion has a met verdict and the last deploy of the base branch did not fail. It reads with `reads` (the job token)
 * and merges, labels and comments with the Factory's token, so the merge starts the deploy of the base branch.
 */
export async function merge(ctx: CommandContext, input: { branch: string; reads: CodeHost }): Promise<MergeOutcome> {
  const { config } = ctx;
  const mode = config.mergeMode;
  if (mode === "human") return { mode, merged: false, reason: "mode" };

  const { reads } = input;
  const pr = await reads.openPrFor(input.branch);
  if (!pr) return { mode, merged: false, reason: "no-pr" };
  const issue = Number(pr.branch.slice(config.branchPrefix.length));
  if (!pr.branch.startsWith(config.branchPrefix) || !Number.isInteger(issue) || issue <= 0 || pr.fork || pr.base !== config.baseBranch) {
    return { pr: pr.number, mode, merged: false, reason: "not-factory" };
  }
  if (pr.state !== "open" || pr.draft) return { pr: pr.number, mode, merged: false, reason: "not-ready" };
  // A feedback round or a branch update is about to push: its result gets checks of its own.
  if (pr.labels.includes(config.labels.working)) return { pr: pr.number, mode, merged: false, reason: "working" };

  const [files, checks, body, deploy] = await Promise.all([reads.changedFiles(pr.number), reads.prChecks(pr.headSha), reads.pullRequestBody(pr.number), reads.lastDeploy()]);
  const protectedFiles = files.filter(isProtectedPath);
  const previewJobs = checks.filter((c) => PREVIEW_JOB.test(c.name));
  const held: Record<MergeCondition, boolean> = {
    protected: protectedFiles.length === 0,
    verify: checks.some((c) => c.name === "verify" && c.conclusion === "success"),
    preview: previewJobs.every((c) => c.conclusion !== null && PASSED.has(c.conclusion)),
    criteria: allCriteriaMet(body),
    deploy: deploy === null || !DEPLOY_FAILED.has(deploy),
  };
  const unmet = (Object.keys(held) as MergeCondition[]).filter((c) => !held[c]);
  if (unmet.length > 0) {
    return { pr: pr.number, mode, merged: false, reason: "conditions", unmet, ...(protectedFiles.length > 0 ? { protected: protectedFiles } : {}) };
  }

  const result = await ctx.codeHost.merge(pr.number, pr.headSha);
  if (!result.ok) return { pr: pr.number, mode, merged: false, reason: "refused", detail: result.reason };
  await ctx.codeHost.labelPr(pr.number, config.labels.autoMerged);
  await ctx.codeHost.commentPr(pr.number, messages(config.language).autoMerged(mode, config.baseBranch, hadPreview(previewJobs)));
  return { pr: pr.number, mode, merged: true };
}

/** A preview ran when one of its smokes did. */
function hadPreview(jobs: PrCheck[]): boolean {
  return jobs.some((c) => c.name.startsWith("preview smoke (") && c.conclusion === "success");
}

/** The headings `publish` gives the verdicts, in every language: a body edited into another language still counts. */
const VERDICT_HEADINGS = new Set(LANGUAGES.map((language) => catalog.verdictsHeading[language]?.() ?? catalog.verdictsHeading.en()));

/**
 * The verdicts section of the body (`publish` writes it from the final Review): at least one verdict, and every one
 * checked. The section ends at the next heading or at the closing line.
 */
export function allCriteriaMet(body: string): boolean {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => VERDICT_HEADINGS.has(line.trim()));
  if (start < 0) return false;
  const items: boolean[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line) || /^Closes #\d+/.test(line)) break;
    const item = /^\s*[-*] \[([ xX])\]/.exec(line);
    if (item) items.push(item[1] !== " ");
  }
  return items.length > 0 && items.every(Boolean);
}
