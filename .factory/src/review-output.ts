import { reviewSchema, type ReviewOutput } from "./result.ts";

/**
 * The Review session ends its final message with
 * `<review>{"summary": "...", "inline": [{"path", "line", "body"}]}</review>`.
 * Without a valid block, the whole message becomes the summary.
 */
export function parseReviewOutput(output: string): ReviewOutput {
  const blocks = [...output.matchAll(/<review>([\s\S]*?)<\/review>/g)];
  const last = blocks.at(-1)?.[1];
  if (last !== undefined) {
    try {
      const parsed = reviewSchema.safeParse(JSON.parse(last));
      if (parsed.success) return parsed.data;
    } catch {
      // Fall through to the raw message.
    }
  }
  return { summary: output.trim(), inline: [] };
}
