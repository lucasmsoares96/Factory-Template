import { z } from "zod";
import type { Extraction } from "./seams/agent.ts";
import { inlineCommentSchema } from "./result.ts";
import type { StageText } from "./secret-text.ts";

/**
 * The Visual Review session ends its final message with
 * `<visual-review>{"summary": "...", "inline": [{"path", "line", "body"}]}</visual-review>`: what it measured, fixed and
 * left for a person. Without a valid block, the whole message becomes the summary.
 */
const outputSchema = z.object({ summary: z.string(), inline: z.array(inlineCommentSchema) });
export type VisualReviewOutput = z.infer<typeof outputSchema>;

function findBlock(output: string): VisualReviewOutput | null {
  const last = [...output.matchAll(/<visual-review>([\s\S]*?)<\/visual-review>/g)].at(-1)?.[1];
  if (last === undefined) return null;
  try {
    const parsed = outputSchema.safeParse(JSON.parse(last));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseVisualReviewOutput(output: string): VisualReviewOutput {
  return findBlock(output) ?? { summary: output.trim(), inline: [] };
}

/** The texts the Visual Review publishes (summary and inline comments), as the scanner sees them. */
export function visualReviewTexts(review: VisualReviewOutput): StageText[] {
  return [
    { name: "visual review summary", text: review.summary },
    ...review.inline.map((c, i) => ({ name: `visual review inline comment ${i + 1}`, text: c.body })),
  ].filter((t) => t.text !== "");
}

export const visualReviewExtraction: Extraction = {
  valid: (output) => findBlock(output) !== null,
  ask: [
    "Your last message has no valid <visual-review> block.",
    'Reply with the block again, and nothing else: <visual-review>{"summary": "...", "inline": [{"path": "...", "line": 1, "body": "..."}]}</visual-review>',
    'with valid JSON and an "inline" array (empty when you have no inline comments).',
  ].join(" "),
};
