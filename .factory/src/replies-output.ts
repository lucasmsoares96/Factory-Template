import { z } from "zod";
import type { Extraction } from "./seams/agent.ts";

/** What the agent decided for a review thread. */
export const decisions = ["address", "decline", "defer", "answer"] as const;

export const threadReplySchema = z.object({
  threadId: z.string().min(1),
  decision: z.enum(decisions),
  body: z.string().min(1),
});
export type ThreadReply = z.infer<typeof threadReplySchema>;

const repliesSchema = z.object({ threadReplies: z.array(threadReplySchema) });

/** The replies of the last `<replies>` block of a pr-feedback session; null when there is none or it is invalid. */
export function parseReplies(output: string): ThreadReply[] | null {
  const raw = [...output.matchAll(/<replies>([\s\S]*?)<\/replies>/g)].at(-1)?.[1];
  if (raw === undefined) return null;
  try {
    const parsed = repliesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.threadReplies : null;
  } catch {
    return null;
  }
}

export const repliesExtraction: Extraction = {
  valid: (output) => parseReplies(output) !== null,
  ask: 'Your final message must end with <replies>{"threadReplies": [{"threadId": "...", "decision": "address|decline|defer|answer", "body": "..."}]}</replies>, one entry per thread you answered. Send it now, as valid JSON, and change nothing else.',
};
