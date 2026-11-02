import type { Extraction } from "./seams/agent.ts";
import { reviewSchema, type ReviewOutput } from "./result.ts";

/**
 * The Review session ends its final message with
 * `<review>{"summary": "...", "inline": [{"path", "line", "body"}], "criteria": [{"id", "met", "proof"}]}</review>`.
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

/** What is wrong with the criteria ids of a block against the issue's `count` criteria (numbered 1..count), or null. */
export function idProblems(criteria: ReviewOutput["criteria"], count: number): { missing: number[]; repeated: number[]; unknown: number[] } | null {
  const seen = new Map<number, number>();
  for (const v of criteria) seen.set(v.id ?? 0, (seen.get(v.id ?? 0) ?? 0) + 1);
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !seen.has(n));
  const repeated = [...seen].filter(([id, times]) => times > 1 && id >= 1 && id <= count).map(([id]) => id);
  const unknown = [...seen.keys()].filter((id) => id < 1 || id > count);
  return missing.length + repeated.length + unknown.length > 0 ? { missing, repeated, unknown } : null;
}

/** The Review's expected block for an issue with `count` criteria, for the Agent seam to extract again from a resumed session. */
export function reviewExtraction(count: number): Extraction {
  const invalid = (output: string) => {
    const block = findReviewBlock(output);
    return block === null || count === 0 ? null : idProblems(block.criteria, count);
  };
  return {
    valid: (output) => findReviewBlock(output) !== null && invalid(output) === null,
    ask: [
      'Your last message has no valid <review> block, or its "criteria" do not match the numbered acceptance criteria of the issue.',
      'Reply with the block again, and nothing else: <review>{"summary": "...", "inline": [{"path": "...", "line": 1, "body": "..."}], "criteria": [{"id": 1, "met": true, "proof": "..."}]}</review>',
      `with valid JSON, an "inline" array (empty when you have no inline comments) and a "criteria" array with exactly one verdict for each number from 1 to ${count}, each number once.`,
    ].join(" "),
  };
}
