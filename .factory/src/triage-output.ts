import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { TRIAGE_MARKER } from "./guard.ts";
import { MAX_EXTRACTION_RETRIES, type Extraction } from "./seams/agent.ts";

/**
 * The Triage session ends its final message with
 * `<triage>{"issues": [{...one verdict per issue}]}</triage>`.
 *
 * The block is extracted with the Agent seam's resume (at most
 * `MAX_EXTRACTION_RETRIES` times, asking only for the block). Fallback when
 * it is still not valid, or the session timed out: every issue without a
 * valid verdict gets `needs-a-human` (`fallbackVerdict`). A human decides;
 * nothing is ever queued for an agent on a guess. The session's last words go
 * into the comment, so the work is not lost.
 */

export const TRIAGE_TAGS = ["easy-call", "needs-a-human", "blocked"] as const;
export type TriageTag = (typeof TRIAGE_TAGS)[number];

const text = z.string().min(1);

export const verdictSchema = z
  .object({
    number: z.number().int().positive(),
    tag: z.enum(TRIAGE_TAGS),
    difficulty: text,
    files: z.array(text).default([]),
    /** What the issue claims about the code, and whether it holds. */
    claims: z.array(text).default([]),
    questions: z.array(text).default([]),
    approach: text,
    /**
     * Every import, export, function, route or file the approach cites, and where the Triage found it
     * (`foundAt`: a repo-relative `path` or `path:line`). `checked` is set by the harness, not the agent
     * (`checkReferences`): the file exists in the checkout and holds `symbol`.
     */
    references: z.array(z.object({ symbol: text, foundAt: text, checked: z.boolean().optional() })).default([]),
    door: z.object({ kind: z.enum(["one-way", "two-way"]), blastRadius: text }),
    /** What each seam under test catches and what it lets through. */
    seams: z.array(z.object({ seam: text, catches: z.string(), misses: z.string() })).default([]),
    product: z.string().nullable().default(null),
    duplicateOf: z.number().int().positive().nullable().default(null),
    /** Set by the harness, not the agent: this verdict is the fallback. */
    fallback: z.string().optional(),
  })
  // An easy-call without seams would be refused by the guard anyway.
  .refine((v) => v.tag !== "easy-call" || v.seams.length > 0, { message: "an easy-call names the seams under test", path: ["seams"] });

export type Verdict = z.infer<typeof verdictSchema>;

/** What crosses from `triage` (no forge token) to `apply` (forge token): `triage.json`. */
export const triageResultSchema = z.object({
  issues: z.array(verdictSchema),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  retries: z.number().int().nonnegative(),
});
export type TriageResult = z.infer<typeof triageResultSchema>;
export const TRIAGE_FILE = "triage.json";

/** The valid verdicts of the last `<triage>` block, by issue number. Entries that do not validate are dropped. */
export function parseVerdicts(output: string): Map<number, Verdict> {
  const found = new Map<number, Verdict>();
  const last = [...output.matchAll(/<triage>([\s\S]*?)<\/triage>/g)].at(-1)?.[1];
  if (last === undefined) return found;
  let json: unknown;
  try {
    json = JSON.parse(last);
  } catch {
    return found;
  }
  const rows = (json as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(rows)) return found;
  for (const row of rows) {
    const parsed = verdictSchema.safeParse(row);
    // The harness owns `fallback`: an agent cannot claim it.
    if (parsed.success && !found.has(parsed.data.number)) {
      const { fallback: _ignored, ...verdict } = parsed.data;
      // The harness owns `checked` too: `checkReferences` sets it.
      found.set(verdict.number, { ...verdict, references: verdict.references.map(({ symbol, foundAt }) => ({ symbol, foundAt })) });
    }
  }
  return found;
}

/** Valid when every issue of the batch has a valid verdict. */
export function triageExtraction(numbers: number[]): Extraction {
  return {
    valid: (output) => {
      const found = parseVerdicts(output);
      return numbers.every((n) => found.has(n));
    },
    ask: `Your last message has no valid <triage> block for issues ${numbers.map((n) => `#${n}`).join(", ")}. Reply with the block again, and nothing else: <triage>{"issues": [{"number": 1, "tag": "easy-call|needs-a-human|blocked", "difficulty": "...", "files": [], "claims": [], "questions": [], "approach": "...", "references": [{"symbol": "...", "foundAt": "path:line"}], "door": {"kind": "one-way|two-way", "blastRadius": "..."}, "seams": [{"seam": "...", "catches": "...", "misses": "..."}], "product": null, "duplicateOf": null}]}</triage> with valid JSON, one entry per issue, and at least one seam for every easy-call.`,
  };
}

const TAIL = 3000;

/** The verdict of an issue the Triage did not answer: a human decides. */
export function fallbackVerdict(number: number, why: "timeout" | "invalid", lastWords: string): Verdict {
  const reason =
    why === "timeout"
      ? "The Triage session timed out."
      : `The Triage produced no valid verdict after ${MAX_EXTRACTION_RETRIES} resumes.`;
  const tail = lastWords.trim().slice(-TAIL);
  return {
    number,
    tag: "needs-a-human",
    difficulty: "unknown",
    files: [],
    claims: [],
    questions: [`${reason} Decide by hand: add the seams and \`ready-for-agent\`, or ask for another \`agent:explore\`.`],
    references: [],
    approach: tail ? `The session's last words (untrusted, not checked):\n\n${tail}` : "The session left no usable text.",
    door: { kind: "one-way", blastRadius: "unknown: nobody has assessed this issue" },
    seams: [],
    product: null,
    duplicateOf: null,
    fallback: reason,
  };
}

/** Whether `text` holds `symbol` as a whole name: `line` is not found in `line7`, nor `/api/note` in `/api/notes`. */
function holdsName(text: string, symbol: string): boolean {
  const name = symbol.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

/**
 * Marks each reference `checked` when the file of its `foundAt` (without a `:line` suffix) is inside `repo`
 * and its text holds `symbol` as a whole name (`holdsName`; the line itself is not checked). A reference that
 * fails stays in the verdict, marked unchecked.
 */
export async function checkReferences(verdict: Verdict, repo: string): Promise<Verdict> {
  const root = await realpath(repo);
  const references = await Promise.all(
    verdict.references.map(async ({ symbol, foundAt }) => {
      const path = foundAt.replace(/:\d+(?:-\d+)?$/, "");
      const file = await realpath(resolve(root, path)).catch(() => null);
      const inside = file !== null && !isAbsolute(path) && !relative(root, file).startsWith("..") && file !== root;
      const text = inside ? await readFile(file, "utf8").catch(() => "") : "";
      return { symbol, foundAt, checked: holdsName(text, symbol) };
    }),
  );
  return { ...verdict, references };
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

/** The single marked comment of a verdict, rendered by the harness from the validated fields. */
export function triageComment(v: Verdict, appliedTag: TriageTag): string {
  const lines = [TRIAGE_MARKER, "> *This was generated by AI during triage.*", ""];
  lines.push(`## Triage: ${appliedTag}`);
  if (v.fallback) lines.push("", `**${v.fallback}** (no valid verdict; fallback to a human)`);
  if (v.duplicateOf !== null) lines.push("", `Duplicate of #${v.duplicateOf}. Close one of them.`);
  lines.push("", `**Difficulty:** ${v.difficulty}`);
  if (v.files.length) lines.push("", "**Files**", bullets(v.files.map((f) => `\`${f}\``)));
  if (v.claims.length) lines.push("", "**Claims checked**", bullets(v.claims));
  if (v.questions.length) lines.push("", "**Open questions**", bullets(v.questions));
  lines.push("", "**Approach**", v.approach);
  const cite = (r: Verdict["references"][number]) => `\`${r.symbol}\` at \`${r.foundAt}\``;
  const checked = v.references.filter((r) => r.checked === true);
  const unchecked = v.references.filter((r) => r.checked !== true);
  if (checked.length) lines.push("", "**References checked**", bullets(checked.map(cite)));
  if (unchecked.length) lines.push("", "**Not found in the code (unchecked)**", bullets(unchecked.map(cite)));
  lines.push("", `**Door:** ${v.door.kind}. Blast radius: ${v.door.blastRadius}`);
  if (v.seams.length) {
    lines.push("", "**Seams under test**");
    for (const s of v.seams) lines.push(`- ${s.seam}. Catches: ${s.catches || "n/a"}. Lets through: ${s.misses || "n/a"}`);
  }
  return lines.join("\n");
}
