import type { FactoryResult } from "./result.ts";

/**
 * Keys of `result.json` whose strings are not the agent's prose: ids, paths, shas, enums, the attempts' records and the
 * prints. Every other string in the result is text the agent wrote for the forge, and `forForge` cleans it: a field
 * added later is cleaned unless it is listed here.
 */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "version",
  "issue",
  "branch",
  "base",
  "head",
  "startSha",
  "outcome",
  "reason",
  "attempts",
  "usage",
  "pullRequestStage",
  "evidence",
  "path",
  "line",
  "met",
  "threadId",
  "decision",
  "files",
  "patch",
]);

/**
 * The one cleaning of the agent's text before `publish` writes any of it to the forge: no closing keyword (only
 * `publish` closes issues) and no tool attribution line, in every text field of the result. An inline comment left
 * empty is dropped: the forge refuses an empty one.
 */
export function forForge(result: FactoryResult): FactoryResult {
  const clean = cleaned(result) as FactoryResult;
  return { ...clean, review: { ...clean.review, inline: clean.review.inline.filter((c) => c.body !== "") } };
}

function cleaned(value: unknown): unknown {
  if (typeof value === "string") return withoutAttribution(withoutClosingKeywords(value));
  if (Array.isArray(value)) return value.map(cleaned);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, STRUCTURAL_KEYS.has(key) ? v : cleaned(v)]));
  }
  return value;
}

/** The `pr` skill's template ends with a tool attribution line; the Factory's text is the harness's, not the tool's. */
function withoutAttribution(text: string): string {
  return text.replace(/^[ \t]*(?:🤖[ \t]*)?Generated with \[?Claude Code\]?.*$\n?|^[ \t]*Co-Authored-By:.*$\n?/gim, "").trim();
}

const REF = String.raw`(?:[\w.-]+\/[\w.-]+)?#\d+`;
// `\s`, not `[ \t]`: a keyword and its reference on two lines are one closing reference once a verdict is put on one line.
const CLOSING = new RegExp(String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+${REF}(?:\s*(?:,|\band\b)\s*${REF})*`, "gi");

/**
 * `Closes #9` written by the agent would close the wrong issue: only `publish` writes it. A line that is only a closing
 * reference goes; one inside a sentence becomes a placeholder so the rest still reads.
 */
function withoutClosingKeywords(text: string): string {
  const alone = new RegExp(String.raw`^[ \t>*-]*${CLOSING.source}\.?[ \t]*$\n?`, "gim");
  return text.replace(alone, "").replace(CLOSING, "[closing reference removed]").trim();
}
