import type { Git } from "./git.ts";
import type { InlineComment } from "./seams/code-host.ts";

/** New-side lines covered by the hunks of `base...head`, by path. */
export type DiffLines = Map<string, Set<number>>;

export async function diffLines(git: Git, base: string, head: string): Promise<DiffLines> {
  const diff = await git.run("-c", "core.quotePath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "--unified=3", `${base}...${head}`);
  const lines: DiffLines = new Map();
  let current: Set<number> | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4);
      current = path === "/dev/null" ? null : new Set();
      if (current) lines.set(path.replace(/^b\//, ""), current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) current.add(n);
    }
  }
  return lines;
}

/** Keeps the inline comments a forge can anchor: those on a line of a diff hunk. */
export function filterToDiff(comments: InlineComment[], lines: DiffLines): InlineComment[] {
  return comments.filter((c) => lines.get(c.path)?.has(c.line) ?? false);
}
