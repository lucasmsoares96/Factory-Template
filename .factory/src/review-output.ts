import type { Extraction } from "./seams/agent.ts";
import { reviewSchema, type ReviewOutput } from "./result.ts";

/**
 * The Review session ends its final message with
 * `<review>{"summary": "...", "inline": [{"path", "line", "body"}], "criteria": [{"criterion", "met", "proof"}]}</review>`.
 * Without a valid block, the whole message becomes the summary.
 */
export function parseReviewOutput(output: string): ReviewOutput {
  return findReviewBlock(output) ?? { summary: output.trim(), inline: [], criteria: [] };
}

function findReviewBlock(output: string): ReviewOutput | null {
  const blocks = [...output.matchAll(/<review>([\s\S]*?)<\/review>/g)];
  const last = blocks.at(-1)?.[1];
  if (last === undefined) return null;
  try {
    const parsed = reviewSchema.safeParse(JSON.parse(last));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The Review's expected block, for the Agent seam to extract again from a resumed session. */
export const reviewExtraction: Extraction = {
  valid: (output) => findReviewBlock(output) !== null,
  ask: 'Your last message has no valid <review> block. Reply with the block again, and nothing else: <review>{"summary": "...", "inline": [{"path": "...", "line": 1, "body": "..."}], "criteria": [{"criterion": "...", "met": true, "proof": "..."}]}</review> with valid JSON, an "inline" array (empty when you have no inline comments) and a "criteria" array with one verdict per acceptance criterion of the issue.',
};
