import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { sessionFailureSchema } from "./session-limit.ts";

/**
 * `result.json`: the only thing, besides the branch bundle and the prints,
 * that crosses from the `work` job (agent, no forge token) to the `publish`
 * job (forge token). Validated with Zod on both sides.
 */

const sha = z.string().regex(/^[0-9a-f]{40,64}$/);
const tokens = z.number().int().nonnegative();
export const usageSchema = z.object({ inputTokens: tokens, outputTokens: tokens });

export const stageRecordSchema = z.object({
  stage: z.enum(["development", "review", "e2e"]),
  outcome: z.enum(["ok", "no-commits", "failed", "timeout", "needs-human"]),
  durationMs: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative().optional(),
  usage: usageSchema.optional(),
  failedCommand: z.string().nullable().optional(),
  /** Resumes of the session to extract its output block (Review). */
  retries: z.number().int().nonnegative().optional(),
  /** Tail of the Stage output, only for a failed Stage. */
  output: z.string().optional(),
});

/**
 * The Pull Request Stage: outside the attempts. `skipped` means the run had
 * commits but no time left for it.
 */
export const pullRequestStageSchema = z.object({
  outcome: z.enum(["ok", "failed", "timeout", "skipped"]),
  durationMs: z.number().int().nonnegative(),
  usage: usageSchema,
  /** Resumes of the session to extract the body block. */
  retries: z.number().int().nonnegative(),
  /** Why there is no body; absent when `ok`. */
  reason: z.string().optional(),
});

export const inlineCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  body: z.string().min(1),
});

/** The Review's verdict on one acceptance criterion of the issue. */
export const criterionVerdictSchema = z.object({
  /** The criterion, as the issue words it. */
  criterion: z.string().min(1),
  met: z.boolean(),
  /** The test or the `@evidence` print that proves it; why not, when it is not met. */
  proof: z.string().min(1),
});

export const reviewSchema = z.object({
  summary: z.string(),
  inline: z.array(inlineCommentSchema),
  /**
   * One verdict per acceptance criterion. A criterion that is not met keeps the run from `ready`; `.default([])`: old results stay valid.
   */
  criteria: z.array(criterionVerdictSchema).default([]),
});

export const evidenceSchema = z.object({
  product: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().regex(/^[\w][\w.-]*\.(png|jpe?g|webp)$/),
});

/**
 * Results written by older runs: `waiting` (a Product issue waiting on its Skeleton follow-up, ADR 0008) is read as a
 * needs-human Escalation; `followUps` is dropped by the schema.
 */
function readLegacyOutcome(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || (raw as { outcome?: unknown }).outcome !== "waiting") return raw;
  return { ...raw, outcome: "escalated", reason: "needs-human" };
}

const resultObject = z.object({
  version: z.literal(1),
  issue: z.number().int().positive(),
  branch: z.string().min(1),
  /** Commit of the base branch the run started from. */
  base: sha,
  /** Head of the branch in the bundle; null when the run made no commits. */
  head: sha.nullable(),
  /**
   * `paused`: a session hit the account's usage limit (`session.limit`); `publish` keeps the commits and the run starts
   * again after the reset.
   */
  outcome: z.enum(["ready", "escalated", "paused"]),
  reason: z.enum(["e2e-failures", "time", "needs-human", "infra"]).nullable(),
  question: z.string().nullable(),
  /** The work the run did: the issue flow, or a round on the issue's open pull request. `.default`: old results stay valid. */
  flow: z.enum(["issue", "pr-feedback", "update-branch"]).default("issue"),
  /** The agent session that failed and ended the run (`paused` at the usage limit, else an `infra` Escalation); null when none did. */
  session: sessionFailureSchema.nullable().default(null),
  attempts: z.array(z.object({ number: z.number().int().positive(), stages: z.array(stageRecordSchema) })),
  review: reviewSchema,
  threadReplies: z.array(z.object({ threadId: z.string().min(1), decision: z.enum(["address", "decline", "defer", "answer"]).default("address"), body: z.string().min(1) })),
  usage: z.object({
    development: usageSchema,
    review: usageSchema,
    pullRequest: usageSchema.default({ inputTokens: 0, outputTokens: 0 }),
  }),
  /** Body the Pull Request Stage wrote (Summary, Evidence, Merge Danger); null when there is none. */
  pullRequestBody: z.string().nullable().default(null),
  /** Null when the Stage did not apply (no commits). */
  pullRequestStage: pullRequestStageSchema.nullable().default(null),
  evidence: z.array(evidenceSchema),
});

export const resultSchema = z.preprocess(readLegacyOutcome, resultObject) as unknown as z.ZodType<z.infer<typeof resultObject>, unknown>;

export type FactoryResult = z.infer<typeof resultSchema>;
export type PullRequestStageRecord = z.infer<typeof pullRequestStageSchema>;
export type StageRecord = z.infer<typeof stageRecordSchema>;
export type ReviewOutput = z.infer<typeof reviewSchema>;
export type CriterionVerdict = z.infer<typeof criterionVerdictSchema>;

export const RESULT_FILE = "result.json";
export const BUNDLE_FILE = "branch.bundle";
export const EVIDENCE_DIR = "evidence";

export async function writeResult(path: string, result: FactoryResult): Promise<void> {
  await writeFile(path, JSON.stringify(resultSchema.parse(result), null, 2) + "\n");
}

export class InvalidResultError extends Error {}

export async function readResult(path: string): Promise<FactoryResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new InvalidResultError(`Cannot read ${path}: ${(error as Error).message}`);
  }
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidResultError(`Invalid ${path}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
