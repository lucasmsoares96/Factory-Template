import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Runs `generate` and returns the paths it changed, as `git status` sees them
 * (committed files it rewrote differently, new files that are not ignored).
 * On a clean checkout this is exactly "`git diff` is empty after `pnpm generate`";
 * locally, edits that generation leaves alone are not reported.
 */
export function filesChangedBy(generate: () => void, cwd: string): string[] {
  const before = dirtyFiles(cwd);
  generate();
  const after = dirtyFiles(cwd);
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

/** Every path that differs from HEAD (or is untracked and not ignored) → a hash of its content. */
function dirtyFiles(cwd: string): Map<string, string> {
  const status = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    encoding: "utf8",
  });
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  const files = new Map<string, string>();
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (!entry) continue;
    const path = entry.slice(3);
    // A rename lists its source path in the next entry.
    if (entry[0] === "R" || entry[0] === "C") i++;
    const file = join(root, path);
    files.set(path, existsSync(file) ? createHash("sha1").update(readFileSync(file)).digest("hex") : "deleted");
  }
  return files;
}
