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
import { parseReviewOutput } from "../review-output.ts";
import type { Usage } from "../seams/agent.ts";
import type { CommandContext } from "./context.ts";

const MINUTE = 60_000;
const OUTPUT_TAIL = 4000;

/**
 * The loop of the `work` job: attempts of Development → Review → E2E on a
 * branch built from the base branch, each Stage in a fresh session. Writes
 * `result.json`, the branch bundle and the prints into `out`.
 */
export async function work(ctx: CommandContext, number: number, options: { repo: string; out: string }): Promise<FactoryResult> {
  const { tracker, agent, verify, config } = ctx;
  const git = new Git(options.repo);
  const branch = issueBranch(config, number);
  const issue = await tracker.issue(number);
  const base = await resolveBase(git, config.baseBranch);
  await git.run("checkout", "--quiet", "-B", branch, base);

  const usage = { development: zeroUsage(), review: zeroUsage() };
  const attempts: FactoryResult["attempts"] = [];
  let review: ReviewOutput = { summary: "", inline: [] };
  let feedback: string | null = null;
  let lastReviewed: string | null = null;
  let ready = false;

  for (let attempt = 1; attempt <= config.maxAttempts && !ready; attempt++) {
    const stages: StageRecord[] = [];
    attempts.push({ number: attempt, stages });

    const devStart = Date.now();
    const dev = await agent.run(
      "development",
      developmentPrompt({ issue, log: await git.log(base, "HEAD"), feedback }),
      { timeoutMs: config.timeouts.development * MINUTE, model: config.models.development },
    );
    add(usage.development, dev.usage);
    if (dev.commits === 0) {
      stages.push({ stage: "development", outcome: "no-commits", durationMs: Date.now() - devStart, commits: 0, usage: dev.usage });
      feedback = "The previous Development session made no commits. Implement the issue and commit the work.";
      continue;
    }
    stages.push({ stage: "development", outcome: "ok", durationMs: Date.now() - devStart, commits: dev.commits, usage: dev.usage });

    const reviewStart = Date.now();
    const reviewRun = await agent.run(
      "review",
      reviewPrompt({ issue, log: await git.log(base, "HEAD"), since: lastReviewed }),
      { timeoutMs: config.timeouts.review * MINUTE, model: config.models.review },
    );
    add(usage.review, reviewRun.usage);
    review = parseReviewOutput(reviewRun.output);
    lastReviewed = await git.head();
    stages.push({ stage: "review", outcome: "ok", durationMs: Date.now() - reviewStart, commits: reviewRun.commits, usage: reviewRun.usage });

    const e2eStart = Date.now();
    await rm(join(options.repo, config.evidenceDir), { recursive: true, force: true });
    const e2e = await verify.run({ timeoutMs: config.timeouts.e2e * MINUTE });
    if (e2e.ok) {
      stages.push({ stage: "e2e", outcome: "ok", durationMs: Date.now() - e2eStart });
      ready = true;
    } else {
      const output = e2e.output.slice(-OUTPUT_TAIL);
      stages.push({ stage: "e2e", outcome: "failed", durationMs: Date.now() - e2eStart, failedCommand: e2e.failedCommand, output });
      feedback = `E2E failed running \`${e2e.failedCommand ?? "factory:verify"}\`:\n${output}`;
    }
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
    reason: ready ? null : "e2e-failures",
    question: null,
    attempts,
    review,
    threadReplies: [],
    usage,
    evidence,
  };
  await writeResult(join(options.out, RESULT_FILE), result);
  return result;
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
