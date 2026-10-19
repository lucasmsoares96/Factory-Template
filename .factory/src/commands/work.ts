import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { issueBranch } from "../config.ts";
import { Git } from "../git.ts";
import { developmentPrompt, reviewPrompt } from "../prompts.ts";
import {
  BUNDLE_FILE,
  EVIDENCE_DIR,
  RESULT_FILE,
  writeResult,
  type FactoryResult,
  type ReviewOutput,
  type StageRecord,
} from "../result.ts";
import { summaryMarkdown } from "../report.ts";
import { parseReviewOutput } from "../review-output.ts";
import type { Usage } from "../seams/agent.ts";
import type { CommandContext } from "./context.ts";

const MINUTE = 60_000;
const OUTPUT_TAIL = 4000;

type Reason = NonNullable<FactoryResult["reason"]>;

/**
 * The loop of the `work` job: attempts of Development → Review → E2E on a
 * branch built from the base branch, each Stage in a fresh session. A failed
 * or timed-out Stage ends the attempt and feeds the next Development; after
 * `maxAttempts`, at the global time limit or when Development needs a human,
 * the run escalates. Writes `result.json`, the branch bundle and the prints
 * into `out`, and the per-Stage report into the job summary.
 */
export async function work(ctx: CommandContext, number: number, options: { repo: string; out: string }): Promise<FactoryResult> {
  const { tracker, agent, verify, config } = ctx;
  const deadline = ctx.now() + config.timeouts.total * MINUTE;
  const git = new Git(options.repo);
  const branch = issueBranch(config, number);
  const issue = await tracker.issue(number);
  const base = await resolveBase(git, config.baseBranch);
  await git.run("checkout", "--quiet", "-B", branch, base);

  const usage = { development: zeroUsage(), review: zeroUsage() };
  const attempts: FactoryResult["attempts"] = [];
  const reviews: (ReviewOutput & { attempt: number })[] = [];
  let feedback: string | null = null;
  let lastReviewed: string | null = null;
  let ready = false;
  let reason: Reason = "e2e-failures";
  let question: string | null = null;

  /** A Stage's timeout, cut to what is left of the global limit; null when nothing is left. */
  const budget = (minutes: number): number | null => {
    const left = deadline - ctx.now();
    return left > 0 ? Math.min(minutes * MINUTE, left) : null;
  };
  const outOfTime = () => ctx.now() >= deadline;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    let timeoutMs = budget(config.timeouts.development);
    if (timeoutMs === null) {
      reason = "time";
      break;
    }
    const stages: StageRecord[] = [];
    attempts.push({ number: attempt, stages });

    // Development
    let started = ctx.now();
    const dev = await agent.run(
      "development",
      developmentPrompt({ issue, base: config.baseBranch, log: await git.log(base, "HEAD"), feedback }),
      { timeoutMs, model: config.models.development },
    );
    add(usage.development, dev.usage);
    const devRecord = { stage: "development" as const, durationMs: ctx.now() - started, commits: dev.commits, usage: dev.usage };
    const asked = needsHuman(dev.output);
    if (asked !== null) {
      stages.push({ ...devRecord, outcome: "needs-human" });
      reason = "needs-human";
      question = asked;
      break;
    }
    if (dev.timedOut) {
      stages.push({ ...devRecord, outcome: "timeout", output: tail(dev.output) });
      if (outOfTime()) {
        reason = "time";
        break;
      }
      feedback = `The previous Development session timed out after ${minutes(timeoutMs)} min. Its commits are on the branch; finish the work in smaller steps.`;
      continue;
    }
    if (dev.commits === 0) {
      stages.push({ ...devRecord, outcome: "no-commits" });
      feedback = "The previous Development session made no commits. Implement the issue and commit the work.";
      continue;
    }
    stages.push({ ...devRecord, outcome: "ok" });

    // Review
    timeoutMs = budget(config.timeouts.review);
    if (timeoutMs === null) {
      reason = "time";
      break;
    }
    started = ctx.now();
    const reviewRun = await agent.run(
      "review",
      reviewPrompt({ issue, log: await git.log(base, "HEAD"), since: lastReviewed, findings: reviews }),
      { timeoutMs, model: config.models.review },
    );
    add(usage.review, reviewRun.usage);
    const reviewRecord = { stage: "review" as const, durationMs: ctx.now() - started, commits: reviewRun.commits, usage: reviewRun.usage };
    if (reviewRun.timedOut) {
      stages.push({ ...reviewRecord, outcome: "timeout", output: tail(reviewRun.output) });
      if (outOfTime()) {
        reason = "time";
        break;
      }
      feedback = `The Review session after the previous attempt timed out after ${minutes(timeoutMs)} min. Keep the change small and focused.`;
      continue;
    }
    reviews.push({ attempt, ...parseReviewOutput(reviewRun.output) });
    lastReviewed = await git.head();
    stages.push({ ...reviewRecord, outcome: "ok" });

    // E2E
    timeoutMs = budget(config.timeouts.e2e);
    if (timeoutMs === null) {
      reason = "time";
      break;
    }
    started = ctx.now();
    await rm(join(options.repo, config.evidenceDir), { recursive: true, force: true });
    const e2e = await verify.run({ timeoutMs });
    const e2eRecord = { stage: "e2e" as const, durationMs: ctx.now() - started };
    if (e2e.ok) {
      stages.push({ ...e2eRecord, outcome: "ok" });
      ready = true;
      break;
    }
    const output = tail(e2e.output);
    const command = e2e.failedCommand ?? "factory:verify";
    stages.push({ ...e2eRecord, outcome: e2e.timedOut ? "timeout" : "failed", failedCommand: e2e.failedCommand, output });
    if (outOfTime()) {
      reason = "time";
      break;
    }
    feedback = e2e.timedOut
      ? `E2E timed out after ${minutes(timeoutMs)} min running \`${command}\`:\n${output}`
      : `E2E failed running \`${command}\`:\n${output}`;
  }

  const head = (await git.countCommits(base, "HEAD")) > 0 ? await git.head() : null;
  await mkdir(options.out, { recursive: true });
  if (head) await git.run("bundle", "create", "--quiet", join(options.out, BUNDLE_FILE), `refs/heads/${branch}`, `^${base}`);
  const evidence = ready ? await collectEvidence(join(options.repo, config.evidenceDir), join(options.out, EVIDENCE_DIR)) : [];

  const result: FactoryResult = {
    version: 1,
    issue: number,
    branch,
    base,
    head,
    outcome: ready ? "ready" : "escalated",
    reason: ready ? null : reason,
    question,
    attempts,
    review: combineReviews(reviews),
    threadReplies: [],
    usage,
    evidence,
  };
  await writeResult(join(options.out, RESULT_FILE), result);
  await ctx.stepSummary(summaryMarkdown(result, config));
  return result;
}

/** The question of a Development session that ends with `<needs-human>…</needs-human>`. */
function needsHuman(output: string): string | null {
  const question = [...output.matchAll(/<needs-human>([\s\S]*?)<\/needs-human>/g)].at(-1)?.[1]?.trim();
  return question ? question : null;
}

/** One review for the PR: the summary of every attempt, the inline findings of all of them. */
function combineReviews(reviews: (ReviewOutput & { attempt: number })[]): ReviewOutput {
  if (reviews.length === 0) return { summary: "", inline: [] };
  const summary =
    reviews.length === 1 ? reviews[0]!.summary : reviews.map((r) => `**Attempt ${r.attempt}.** ${r.summary}`).join("\n\n");
  const seen = new Set<string>();
  const inline = reviews
    .flatMap((r) => r.inline)
    .filter((c) => {
      const key = JSON.stringify([c.path, c.line, c.body]);
      return seen.has(key) ? false : (seen.add(key), true);
    });
  return { summary, inline };
}

function tail(output: string): string {
  return output.slice(-OUTPUT_TAIL);
}

function minutes(ms: number): number {
  return Math.round(ms / MINUTE);
}

async function resolveBase(git: Git, baseBranch: string): Promise<string> {
  try {
    return await git.revParse(baseBranch);
  } catch {
    return await git.revParse(`origin/${baseBranch}`);
  }
}

/** Copies `<from>/<product>/<print>` into `<to>/<product>/<print>`, sorted by Product. */
async function collectEvidence(from: string, to: string): Promise<FactoryResult["evidence"]> {
  const evidence: FactoryResult["evidence"] = [];
  const products = await readdir(from, { withFileTypes: true }).catch(() => []);
  for (const product of products.filter((p) => p.isDirectory()).map((p) => p.name).sort()) {
    const prints = (await readdir(join(from, product))).filter((name) => /\.(png|jpe?g|webp)$/.test(name)).sort();
    for (const name of prints) {
      await mkdir(join(to, product), { recursive: true });
      await cp(join(from, product, name), join(to, product, name));
      evidence.push({ product, name });
    }
  }
  return evidence;
}

function zeroUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0 };
}

function add(total: Usage, run: Usage): void {
  total.inputTokens += run.inputTokens;
  total.outputTokens += run.outputTokens;
}
