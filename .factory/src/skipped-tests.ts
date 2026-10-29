import type { Git } from "./git.ts";

/**
 * A skipped or focused test proves nothing: Playwright and Vitest report the
 * suite green without running it. After Development, the lines the branch adds
 * to test files are checked for these markers, deterministically.
 */
export interface SkippedTest {
  path: string;
  /** Line number in the new file. */
  line: number;
  text: string;
}

const TEST_FILE = /(?:\.(?:spec|test)\.[cm]?[jt]sx?$)|(?:(?:^|\/)e2e\/)/;
const MARKER =
  /\b(?:test|it|describe)(?:\.describe)?(?:\.(?:parallel|serial))?\.(?:skip|fixme|only)\b|\bx(?:it|describe)\s*\(|\btest\.describe(?:\.(?:parallel|serial))?\.(?:skip|fixme|only)\b/;
const STRING = /(["'`])(?:\\.|(?!\1).)*\1/g;

/**
 * Whether an added line uses a marker as code. Strings and `//` comments are
 * cut away and lines that start like a block comment are skipped. Known false
 * positives, accepted: the marker inside a multi-line template literal or in
 * the middle of a block comment, and a conditional `test.skip(cond, reason)`
 * inside a test body (that one is a skip too).
 */
export function usesMarker(line: string): boolean {
  const trimmed = line.trim();
  if (/^(?:\/\/|\/\*|\*)/.test(trimmed)) return false;
  return MARKER.test(trimmed.replace(STRING, '""').replace(/\/\/.*$/, ""));
}

/** The skipped or focused tests added by `base...HEAD`, in file and line order. */
export async function addedSkippedTests(git: Git, base: string): Promise<SkippedTest[]> {
  const diff = await git.run("-c", "core.quotePath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "--unified=0", `${base}...HEAD`);
  const found: SkippedTest[] = [];
  let path: string | null = null;
  let line = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      path = row.startsWith("+++ b/") && TEST_FILE.test(row.slice(6)) ? row.slice(6) : null;
    } else if (row.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
    } else if (row.startsWith("+")) {
      if (path !== null && usesMarker(row.slice(1))) found.push({ path, line, text: row.slice(1).trim() });
      line++;
    }
  }
  return found;
}

/** The feedback of a Development session that left skipped or focused tests. */
export function skippedTestsFeedback(found: SkippedTest[]): string {
  return [
    "Development added skipped or focused tests, so the attempt fails even if E2E would pass:",
    ...found.map((f) => `- \`${f.path}:${f.line}\`: \`${f.text}\``),
    "A skipped or focused test proves nothing: make the test run and pass.",
  ].join("\n");
}
