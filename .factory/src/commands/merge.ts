import { isProtectedPath, type MergeMode } from "../config.ts";
import { TRIAGE_MARKER } from "../guard.ts";
import { catalog, LANGUAGES, messages } from "../messages.ts";
import type { CodeHost, PrCheck, PullRequest } from "../seams/code-host.ts";
import type { CommandContext } from "./context.ts";

/** Every condition of a merge without a person, in the order the comment and the output name them. */
export type MergeCondition = "protected" | "door" | "verify" | "preview" | "criteria" | "deploy";

/** The decision on one pull request. */
export type PrDecision =
  | { pr: number; merged: true }
  | { pr: number; merged: false; reason: "not-ready" | "working" | "behind" }
  | { pr: number; merged: false; reason: "conditions"; unmet: MergeCondition[]; protected?: string[] }
  | { pr: number; merged: false; reason: "refused"; detail: string };

export type MergeOutcome = { mode: "human"; decisions: [] } | { mode: MergeMode; decisions: PrDecision[] };

/** The jobs of `factory-pr.yml` that make or test a preview; `preview comment` and `preview-label` only report. */
const PREVIEW_JOB = /^preview(-plan$| deploy \(| smoke \()/;
const PASSED = new Set(["success", "skipped"]);
/** A deploy that ended like this stops every merge without a person until one passes. */
const DEPLOY_FAILED = new Set(["failure", "timed_out", "cancelled", "startup_failure", "action_required", "stale"]);

export interface MergeInput {
  /** Reads the forge (the job token: `actions: read`, which the Factory's fine-grained token lacks). */
  reads: CodeHost;
  /** Labels with the job token: a label written with `FACTORY_TOKEN` would start the PR workflow again. */
  label: (pr: number, label: string) => Promise<void>;
}

/**
 * The Merge Mode's decision (ADR 0016), run by `factory-merge.yml` with the default branch's code whenever the PR
 * workflow ends. Deterministic, and it takes nothing from the event: in `human` it merges nothing; in `safe` it reads
 * every open Factory pull request and merges each ready one whose diff touches nothing protected, whose `verify` passed,
 * whose preview jobs did not fail, whose acceptance criteria all have a met verdict, while the last deploy of the base
 * branch did not fail; `all` does the same without the protected list. The merge and the comment go with the Factory's token, so the merge starts the deploy.
 */
export async function merge(ctx: CommandContext, input: MergeInput): Promise<MergeOutcome> {
  const { config } = ctx;
  const mode = config.mergeMode;
  if (mode === "human") return { mode, decisions: [] };

  const factoryPrs = (await input.reads.openPullRequests()).filter((pr) => isFactoryPr(ctx, pr)).sort((a, b) => a.number - b.number);
  if (factoryPrs.length === 0) return { mode, decisions: [] };
  const deploy = await input.reads.lastDeploy();
  const decisions: PrDecision[] = [];
  for (const pr of factoryPrs) decisions.push(await decide(ctx, input, pr, deploy));
  return { mode, decisions };
}

/** A `factory/issue-N` branch of this repository, into the base branch. */
function isFactoryPr(ctx: CommandContext, pr: PullRequest): boolean {
  const { branchPrefix, baseBranch } = ctx.config;
  return pr.branch.startsWith(branchPrefix) && /^[1-9]\d*$/.test(pr.branch.slice(branchPrefix.length)) && !pr.fork && pr.base === baseBranch;
}

async function decide(ctx: CommandContext, input: MergeInput, pr: PullRequest, deploy: string | null): Promise<PrDecision> {
  const { config } = ctx;
  const { reads } = input;
  if (pr.state !== "open" || pr.draft) return { pr: pr.number, merged: false, reason: "not-ready" };
  // A feedback round or a branch update is about to push: its result gets checks of its own.
  if (pr.labels.includes(config.labels.working)) return { pr: pr.number, merged: false, reason: "working" };
  // The owner's token bypasses the ruleset: a head behind the base was never verified with it. The scan updates it.
  if (await reads.behindBase(pr.headSha)) return { pr: pr.number, merged: false, reason: "behind" };

  const [files, checks, body] = await Promise.all([reads.changedFiles(pr.number), reads.prChecks(pr.headSha), reads.pullRequestBody(pr.number)]);
  const protectedFiles = files.filter(isProtectedPath);
  const previewJobs = checks.filter((c) => PREVIEW_JOB.test(c.name));
  const held: Record<MergeCondition, boolean> = {
    protected: config.mergeMode === "all" || protectedFiles.length === 0,
    door: config.mergeMode === "all" || !(await declaredOneWay(ctx, pr, body)),
    verify: checks.some((c) => c.name === "verify" && c.conclusion === "success"),
    preview: previewJobs.every((c) => c.conclusion !== null && PASSED.has(c.conclusion)),
    criteria: allCriteriaMet(body),
    deploy: deploy === null || !DEPLOY_FAILED.has(deploy),
  };
  const unmet = (Object.keys(held) as MergeCondition[]).filter((c) => !held[c]);
  if (unmet.length > 0) return { pr: pr.number, merged: false, reason: "conditions", unmet, ...(unmet.includes("protected") ? { protected: protectedFiles } : {}) };

  const result = await ctx.codeHost.merge(pr.number, pr.headSha);
  if (!result.ok) return { pr: pr.number, merged: false, reason: "refused", detail: result.reason };
  await input.label(pr.number, config.labels.autoMerged);
  await ctx.codeHost.commentPr(pr.number, messages(config.language).autoMerged(config.mergeMode, config.baseBranch, hadPreview(previewJobs), protectedFiles));
  return { pr: pr.number, merged: true };
}

/** The Door field of a line, in every language of the catalog: `**Door:**` or `**Porta:**`. */
const DOOR_FIELD = /\*\*(?:Door|Porta):\*\*(.*)/i;
const ONE_WAY = /one-way/i;

/**
 * Whether the pull request declares a one-way door: in the Door field of its Merge Danger section (the `pr` skill's
 * heading, from it to the next heading; text elsewhere decides nothing), or in the Door line of a Triage comment of its
 * issue. It can only hold a merge, never free one, so any source saying one-way is enough, whoever wrote it, and an
 * issue that cannot be read counts as one-way.
 */
async function declaredOneWay(ctx: CommandContext, pr: PullRequest, body: string): Promise<boolean> {
  if (mergeDangerOneWay(body)) return true;
  const issue = Number(pr.branch.slice(ctx.config.branchPrefix.length));
  const comments = await ctx.tracker.issue(issue).then((i) => i.comments, () => null);
  if (comments === null) return true;
  return comments.some((c) => c.body.includes(TRIAGE_MARKER) && c.body.split(/\r?\n/).some((line) => ONE_WAY.test(DOOR_FIELD.exec(line)?.[1] ?? "")));
}

/** The Door field of a `## Merge Danger` section says one-way. */
export function mergeDangerOneWay(body: string): boolean {
  let inside = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) inside = /^#{1,6}\s+Merge Danger\s*$/i.test(line.trim());
    else if (inside && ONE_WAY.test(DOOR_FIELD.exec(line)?.[1] ?? "")) return true;
  }
  return false;
}

/** A preview ran when one of its smokes did. */
function hadPreview(jobs: PrCheck[]): boolean {
  return jobs.some((c) => c.name.startsWith("preview smoke (") && c.conclusion === "success");
}

/** The headings `publish` gives the verdicts, in every language: a body edited into another language still counts. */
const VERDICT_HEADINGS = new Set(LANGUAGES.map((language) => catalog.verdictsHeading[language]?.() ?? catalog.verdictsHeading.en()));

/**
 * The verdicts section `publish` writes from the final Review: at least one verdict, and every one checked. It is the
 * last such heading, since `publish` puts it after the agent's own text (which could carry a heading of its own), and
 * it ends at the next heading or at the closing line.
 */
export function allCriteriaMet(body: string): boolean {
  const lines = body.split(/\r?\n/);
  const start = lines.findLastIndex((line) => VERDICT_HEADINGS.has(line.trim()));
  if (start < 0) return false;
  const items: boolean[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line) || /^Closes #\d+/.test(line)) break;
    const item = /^\s*[-*] \[([ xX])\]/.exec(line);
    if (item) items.push(item[1] !== " ");
  }
  return items.length > 0 && items.every(Boolean);
}
