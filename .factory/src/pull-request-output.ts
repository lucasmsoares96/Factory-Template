import type { Extraction } from "./seams/agent.ts";

/**
 * The Pull Request Stage ends its final message with the body of the PR in
 * `<pull-request>…</pull-request>`. Without a valid block there is no body.
 */
export function parsePullRequestBody(output: string): string | null {
  const last = [...output.matchAll(/<pull-request>([\s\S]*?)<\/pull-request>/g)].at(-1)?.[1]?.trim();
  return last ? last : null;
}

/** The expected block, for the Agent seam to extract again from a resumed session. */
export const pullRequestExtraction: Extraction = {
  valid: (output) => parsePullRequestBody(output) !== null,
  ask: "Your last message has no valid <pull-request> block. Reply with the block again, and nothing else: <pull-request>the PR body in Markdown</pull-request>, not empty.",
};
