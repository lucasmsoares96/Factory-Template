import { join } from "node:path";
import { diffLines, filterToDiff } from "../diff.ts";
import { Git } from "../git.ts";
import { BUNDLE_FILE, EVIDENCE_DIR, RESULT_FILE, readResult, type FactoryResult } from "../result.ts";
import type { EvidenceGroup, PullRequest } from "../seams/code-host.ts";
import type { CommandContext } from "./context.ts";

export interface PublishResult {
  issue: number;
  outcome: FactoryResult["outcome"];
  pr: number;
  url: string;
}

/**
 * The `publish` job: the only one with the forge token. Validates the
 * artifacts of `work`, then pushes the branch with a lease, opens the draft PR,
 * submits the review, posts the evidence and marks the PR ready.
 */
export async function publish(
  ctx: CommandContext,
  number: number,
  options: { repo: string; in: string; startSha: string | null },
): Promise<PublishResult> {
  const { tracker, codeHost, config } = ctx;
  const result = await readResult(join(options.in, RESULT_FILE));
  if (result.issue !== number) throw new Error(`result.json is for #${result.issue}, not #${number}`);
  if (result.outcome !== "ready" || result.head === null) {
    throw new Error(`Escalation is not implemented yet (outcome ${result.outcome}, reason ${result.reason})`);
  }

  const git = new Git(options.repo);
  await git.run("fetch", "--quiet", join(options.in, BUNDLE_FILE), `+refs/heads/${result.branch}:refs/heads/${result.branch}`);
  const head = await git.revParse(result.branch);
  if (head !== result.head) throw new Error(`Bundle head ${head} does not match result.json head ${result.head}`);
  const lines = await diffLines(git, result.base, head);

  const push = await codeHost.push({ branch: result.branch, sha: head, expectedSha: options.startSha });
  if (!push.ok) throw new Error(`Run discarded: ${push.reason}`);

  const issue = await tracker.issue(number);
  const pr: PullRequest = await codeHost.openDraftPr({
    branch: result.branch,
    base: config.baseBranch,
    title: `Fix #${number}: ${issue.title}`,
    body: `Closes #${number}\n\nImplemented by the Factory.`,
  });
  await codeHost.submitReview(pr.number, {
    event: "COMMENT",
    body: result.review.summary || "No findings.",
    comments: filterToDiff(result.review.inline, lines),
  });
  if (result.evidence.length > 0) await codeHost.postEvidence(pr.number, evidenceGroups(result, options.in));
  await codeHost.markReady(pr.number);
  return { issue: number, outcome: result.outcome, pr: pr.number, url: pr.url };
}

/** Prints grouped by Product, in the order `work` listed them. */
function evidenceGroups(result: FactoryResult, dir: string): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();
  for (const { product, name } of result.evidence) {
    const group = groups.get(product) ?? { product, images: [] };
    group.images.push({ name, path: join(dir, EVIDENCE_DIR, product, name) });
    groups.set(product, group);
  }
  return [...groups.values()];
}
