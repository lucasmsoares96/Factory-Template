import { execFileSync } from "node:child_process";

/**
 * A migration that reached the base branch is published: it may already run
 * in production, so it is never edited, renamed or deleted. Compares the
 * working tree (committed or not) with the merge base and lists every
 * published file that changed under `dir`.
 */
export function findChangedPublishedMigrations({
  dir,
  base,
  cwd = process.cwd(),
}: {
  dir: string;
  base: string;
  cwd?: string;
}): string[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  return git("diff", "--name-status", "--no-renames", mergeBase, "--", dir)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t") as [string, string])
    .filter(([status]) => status !== "A")
    .map(([status, path]) => `${path} (${status === "D" ? "deleted" : "modified"})`);
}

/**
 * The ref published migrations are compared against: `--base`, else the pull
 * request's base branch on GitHub Actions, else `origin/main`, else `main`.
 * Undefined when none exists in this clone.
 */
export function resolveBaseRef({ base, cwd = process.cwd() }: { base?: string; cwd?: string }) {
  const candidates = base
    ? [base]
    : [process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`, "origin/main", "main"];
  return candidates.find((ref): ref is string => {
    if (!ref) return false;
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
}
