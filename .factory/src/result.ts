import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

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
  /** Tail of the Stage output, only for a failed Stage. */
  output: z.string().optional(),
});

export const inlineCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  body: z.string().min(1),
});

export const reviewSchema = z.object({
  summary: z.string(),
  inline: z.array(inlineCommentSchema),
});

export const evidenceSchema = z.object({
  product: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().regex(/^[\w][\w.-]*\.(png|jpe?g|webp)$/),
});

export const resultSchema = z.object({
  version: z.literal(1),
  issue: z.number().int().positive(),
  branch: z.string().min(1),
  /** Commit of the base branch the run started from. */
  base: sha,
  /** Head of the branch in the bundle; null when the run made no commits. */
  head: sha.nullable(),
  outcome: z.enum(["ready", "escalated"]),
  reason: z.enum(["e2e-failures", "time", "needs-human", "infra"]).nullable(),
  question: z.string().nullable(),
  attempts: z.array(z.object({ number: z.number().int().positive(), stages: z.array(stageRecordSchema) })),
  review: reviewSchema,
  threadReplies: z.array(z.object({ threadId: z.string().min(1), body: z.string().min(1) })),
  usage: z.object({ development: usageSchema, review: usageSchema }),
  evidence: z.array(evidenceSchema),
});

export type FactoryResult = z.infer<typeof resultSchema>;
export type StageRecord = z.infer<typeof stageRecordSchema>;
export type ReviewOutput = z.infer<typeof reviewSchema>;

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
