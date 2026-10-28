import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { triagePrompt } from "../prompts.ts";
import {
  checkReferences,
  fallbackVerdict,
  parseVerdicts,
  triageComment,
  triageExtraction,
  triageResultSchema,
  TRIAGE_FILE,
  type TriageResult,
  type TriageTag,
  type Verdict,
} from "../triage-output.ts";
import { trustedExplore } from "../guard.ts";
import type { Issue } from "../seams/tracker.ts";
import { SessionLimitError, type AgentRun } from "../seams/agent.ts";
import { messages } from "../messages.ts";
import { sessionFailure, sessionLimitComment } from "../session-limit.ts";
import type { CommandContext } from "./context.ts";

const MINUTE = 60_000;

export interface TriageRun {
  triaged: number[];
  /** Left out: the label is not trusted (`trustedExplore`), the issue is gone from Triage, or it waits for the usage limit to reset. */
  skipped: number[];
  fallback: number[];
  /** The session stopped at the agent's usage limit: no verdict, the batch waits for the reset. */
  paused: number[];
  retries: number;
}

/**
 * The read-only half (job `work`, no forge token): reads the issues in
 * Triage (all of them, or the numbers given), runs ONE Triage session over
 * the batch and writes `triage.json` into `out`. Changes nothing on the
 * forge. Issues whose `agent:explore` is not trusted (put by someone with
 * `write`+, or the Factory's swap of a writer's `ready-for-agent`: `trustedExplore`)
 * are not read: their text never reaches the Agent. The references each verdict cites are checked
 * in `repo` (the checkout): `checkReferences`.
 */
export async function triage(ctx: CommandContext, options: { issues: number[]; out: string; repo: string }): Promise<TriageRun> {
  const { tracker, agent, config } = ctx;
  const chosen = await triageBatch(ctx, options.issues);
  const skipped = chosen.skipped;
  const batch: Issue[] = [];
  for (const number of chosen.batch) batch.push(await tracker.issue(number));

  const result: TriageResult = { issues: [], usage: { inputTokens: 0, outputTokens: 0 }, retries: 0, paused: null };
  const fallback: number[] = [];
  if (batch.length > 0) {
    const numbers = batch.map((i) => i.number);
    let run: AgentRun;
    try {
      run = await agent.run("triage", triagePrompt({ issues: batch, language: config.language }), {
        timeoutMs: config.timeouts.triage * MINUTE,
        model: config.models.triage,
        extract: triageExtraction(numbers),
      });
    } catch (error) {
      if (!(error instanceof SessionLimitError)) throw error;
      result.paused = { issues: numbers, session: sessionFailure("triage", error, ctx.now()) };
      return finish(result, options.out, skipped, []);
    }
    result.usage = run.usage;
    result.retries = run.retries;
    const found = run.timedOut ? new Map<number, Verdict>() : parseVerdicts(run.output);
    for (const number of numbers) {
      const verdict = found.get(number);
      if (verdict) {
        result.issues.push(await checkReferences(verdict, options.repo));
      } else {
        fallback.push(number);
        result.issues.push(fallbackVerdict(number, run.timedOut ? "timeout" : "invalid", run.output, config));
      }
    }
  }
  return finish(result, options.out, skipped, fallback);
}

async function finish(result: TriageResult, out: string, skipped: number[], fallback: number[]): Promise<TriageRun> {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, TRIAGE_FILE), `${JSON.stringify(result, null, 2)}\n`);
  return { triaged: result.issues.map((v) => v.number), skipped, fallback, paused: result.paused?.issues ?? [], retries: result.retries };
}

/**
 * The issues a Triage run reads: those given, or every one labelled `agent:explore`, minus those whose label is not
 * trusted (`trustedExplore`) and those paused at the agent's usage limit (`resume` starts their Triage after the reset).
 */
export async function triageBatch(ctx: CommandContext, issues: number[] = []): Promise<{ batch: number[]; skipped: number[] }> {
  const { tracker, config } = ctx;
  const explore = config.labels.agentExplore;
  const wanted = issues.length > 0 ? issues : (await tracker.labeled(explore)).sort((a, b) => a - b);
  const paused = new Set(await tracker.labeled(config.labels.sessionLimit));
  const batch: number[] = [];
  const skipped: number[] = [];
  for (const number of wanted) {
    if (paused.has(number)) {
      skipped.push(number);
      continue;
    }
    const origin = await tracker.labelOrigin(number, explore);
    if (origin === null || !(await trustedExplore(tracker, config, origin))) skipped.push(number);
    else batch.push(number);
  }
  return { batch, skipped };
}

export interface ApplyRun {
  applied: { issue: number; tag: TriageTag; label: string; product: string | null }[];
  /** Left in Triage, waiting for the agent's usage limit to reset. */
  paused: number[];
  skipped: { issue: number; reason: string }[];
}

const PRODUCT_ID = /^[a-z][a-z0-9-]*$/;

/**
 * The write half (job `apply`, forge token). Trusts nothing in `triage.json`
 * but its shape: for each verdict it reads the forge again (still in Triage,
 * label trusted as in `triage`), posts the one marked comment, then swaps
 * `agent:explore` for the label of the verdict (the swap is the lock) and,
 * only once the swap held, removes `needs-triage`, a state label the verdict
 * replaces. Order matters: the comment first, because `ready-for-agent`
 * starts a run whose guard looks for it. `easy-call` → `ready-for-agent`,
 * `needs-a-human` → `ready-for-human`, `blocked` → `needs-info`; a duplicate
 * is never queued.
 * It adds `product:<id>` when the verdict names a Product that exists under
 * `apps/` and the issue has no `product:` label yet.
 */
export async function apply(ctx: CommandContext, options: { in: string; repo: string }): Promise<ApplyRun> {
  const { tracker, config } = ctx;
  const { labels } = config;
  const raw = JSON.parse(await readFile(join(options.in, TRIAGE_FILE), "utf8"));
  const result = triageResultSchema.parse(raw);
  const products = new Set(await readdir(join(options.repo, "apps")).catch(() => [] as string[]));
  const run: ApplyRun = { applied: [], paused: [], skipped: [] };

  if (result.paused) {
    const { session } = result.paused;
    const wait = { flow: "triage" as const, resumeAt: session.limit?.resumeAt ?? new Date(ctx.now()).toISOString(), head: null, pr: null };
    const next = messages(config.language).sessionLimitTriage(labels.agentExplore);
    for (const number of result.paused.issues) {
      const issue = await tracker.issue(number);
      const origin = await tracker.labelOrigin(number, labels.agentExplore);
      if (issue.state !== "open" || !issue.labels.includes(labels.agentExplore) || origin === null || !(await trustedExplore(tracker, config, origin))) {
        run.skipped.push({ issue: number, reason: "no longer in Triage" });
        continue;
      }
      await tracker.addLabel(number, labels.sessionLimit);
      await tracker.comment(number, sessionLimitComment({ wait, failure: session, next, runUrl: null }, config));
      run.paused.push(number);
    }
  }

  for (const verdict of result.issues) {
    const number = verdict.number;
    const issue = await tracker.issue(number);
    const origin = await tracker.labelOrigin(number, labels.agentExplore);
    if (issue.state !== "open" || !issue.labels.includes(labels.agentExplore) || origin === null) {
      run.skipped.push({ issue: number, reason: "no longer in Triage" });
      continue;
    }
    if (!(await trustedExplore(tracker, config, origin))) {
      run.skipped.push({ issue: number, reason: "label not put by someone with write access" });
      continue;
    }
    const tag: TriageTag = verdict.duplicateOf !== null && verdict.tag === "easy-call" ? "needs-a-human" : verdict.tag;
    const target = { "easy-call": labels.readyForAgent, "needs-a-human": labels.readyForHuman, blocked: labels.needsInfo }[tag];

    await tracker.comment(number, triageComment(verdict, tag, config.language));
    // The product label goes first: `ready-for-agent` starts a run, which must already find its Product.
    let product: string | null = null;
    const has = issue.labels.some((l) => l.startsWith(labels.productPrefix));
    if (!has && verdict.product !== null && PRODUCT_ID.test(verdict.product) && products.has(verdict.product)) {
      product = verdict.product;
      await tracker.addLabel(number, `${labels.productPrefix}${product}`);
    }
    if (!(await tracker.swapLabel(number, labels.agentExplore, target))) {
      run.skipped.push({ issue: number, reason: "lost the label while applying" });
      continue;
    }
    if (issue.labels.includes(labels.needsTriage)) await tracker.removeLabel(number, labels.needsTriage);
    run.applied.push({ issue: number, tag, label: target, product });
  }
  return run;
}

/** Whether a directory holds a `triage.json` (the local flow's container may leave none). */
export async function hasTriageResult(dir: string): Promise<boolean> {
  return (await readdir(dir).catch(() => [] as string[])).includes(TRIAGE_FILE);
}
