import { z } from "zod";
import type { FactoryConfig } from "./config.ts";
import { messages, type Language } from "./messages.ts";
import { tokensLine } from "./report.ts";
import { MAX_EXTRACTION_RETRIES, type Extraction } from "./seams/agent.ts";

/**
 * The Retro session ends its final message with `<retro>{"summary": "...", "candidates": [...]}</retro>`.
 *
 * The block is extracted with the Agent seam's resume (at most `MAX_EXTRACTION_RETRIES` times). With no valid block,
 * the run fails with a clear error and nothing is published: a Retro never guesses.
 */

export const RETRO_CATEGORIES = ["navigation", "automated-check", "coding-standard", "agents-md", "tool-economy", "no-op", "information-access"] as const;
export const RETRO_SEVERITIES = ["high", "medium", "low"] as const;

const text = z.string().min(1);

export const candidateSchema = z.object({
  category: z.enum(RETRO_CATEGORIES),
  severity: z.enum(RETRO_SEVERITIES),
  /** One line. */
  title: text,
  /** What to change, and where, in Markdown. */
  proposal: text,
  /** The moments of the run that justify it: a session and an excerpt, or a link to a thread or comment. */
  evidence: z.array(text).min(1),
});
export type RetroCandidate = z.infer<typeof candidateSchema>;

export const retroBlockSchema = z.object({
  /** What went wrong in the run, in a few lines. */
  summary: text,
  candidates: z.array(candidateSchema),
});
export type RetroBlock = z.infer<typeof retroBlockSchema>;

/** What crosses from `retro` (no forge token) to `retro-publish` (forge token): `retro.json`. */
export const retroResultSchema = retroBlockSchema.extend({
  issue: z.number().int().positive(),
  pr: z.number().int().positive().nullable(),
  /** The issue's title, for the Retro issue's title. */
  title: z.string(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  retries: z.number().int().nonnegative(),
});
export type RetroResult = z.infer<typeof retroResultSchema>;
export const RETRO_FILE = "retro.json";

/** The valid block of the last `<retro>` tag, with the candidates most severe first; null when there is none. */
export function parseRetro(output: string): RetroBlock | null {
  const last = [...output.matchAll(/<retro>([\s\S]*?)<\/retro>/g)].at(-1)?.[1];
  if (last === undefined) return null;
  let json: unknown;
  try {
    json = JSON.parse(last);
  } catch {
    return null;
  }
  const parsed = retroBlockSchema.safeParse(json);
  if (!parsed.success) return null;
  const rank = (c: RetroCandidate) => RETRO_SEVERITIES.indexOf(c.severity);
  return { ...parsed.data, candidates: parsed.data.candidates.toSorted((a, b) => rank(a) - rank(b)) };
}

export const retroExtraction: Extraction = {
  valid: (output) => parseRetro(output) !== null,
  ask: `Your last message has no valid <retro> block. Reply with the block again, and nothing else: <retro>{"summary": "...", "candidates": [{"category": "${RETRO_CATEGORIES.join("|")}", "severity": "high|medium|low", "title": "...", "proposal": "...", "evidence": ["..."]}]}</retro> with valid JSON. Every candidate needs at least one piece of evidence; "candidates" is empty when the record supports none.`,
};

export function retroFailure(timedOut: boolean): string {
  return timedOut
    ? "The Retro session timed out. Nothing was published; dispatch factory-retro.yml again to retry."
    : `The Retro produced no valid <retro> block after ${MAX_EXTRACTION_RETRIES} resumes. Nothing was published; dispatch factory-retro.yml again to retry.`;
}

/** Hidden marker of the Retro issue of one origin, so a second run edits it instead of opening another. */
export const retroMarker = (issue: number) => `<!-- factory:retro:issue-${issue} -->`;

/** The body of the Retro issue, rendered by the harness from the validated fields. The marker stays first. */
export function retroIssueBody(result: RetroResult, options: { runUrl: string | null; pricing: FactoryConfig["pricing"]; language: Language }): string {
  const m = messages(options.language);
  const origin = [`#${result.issue}`, ...(result.pr ? [`#${result.pr}`] : [])].join(", ");
  const lines = [retroMarker(result.issue), m.retroDisclaimer(), "", m.retroOrigin(origin, options.runUrl), "", m.retroWhatWentWrong(), "", result.summary, "", m.retroCandidates()];
  result.candidates.forEach((c, i) => {
    lines.push("", `### ${i + 1}. ${c.title}`, "", m.retroSeverity(m.retroCategory(c.category), c.severity), "", c.proposal, "", m.retroEvidence());
    for (const e of c.evidence) lines.push(`- ${e}`);
  });
  lines.push("", "---", tokensLine(result.usage.inputTokens, result.usage.outputTokens, options.pricing, options.language));
  return lines.join("\n");
}
