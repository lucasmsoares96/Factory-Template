/**
 * Paths the Factory must not change on its own. Ticket 11 mirrors the
 * protected list in the `deny` rules of `.claude/settings.json`.
 */

/** A diff here leads to Escalation without a pull request, with the patch in the comment. */
export const PROTECTED_PATHS = [
  ".github/workflows/",
  ".agents/skills",
  ".claude/skills",
  ".claude/hooks",
  "skills-lock.json",
  ".claude/settings.json",
  ".mcp.json",
];

/** A diff here gets the `harness-change` label and a warning on top of the pull request. */
export const HARNESS_PATHS = ["AGENTS.md", "docs/agents/", "GLOSSARY.md", "CODING_STANDARDS.md", "docs/adr/", ".factory/"];

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((p) => matches(path, p));
}

/** `AGENTS.md` counts at every level of the repo; the rest from the root. */
export function isHarnessPath(path: string): boolean {
  return path === "AGENTS.md" || path.endsWith("/AGENTS.md") || HARNESS_PATHS.some((p) => matches(path, p));
}

/** `dir/` matches what is under it; any other entry matches itself or what is under it. */
function matches(path: string, entry: string): boolean {
  if (entry.endsWith("/")) return path.startsWith(entry);
  return path === entry || path.startsWith(`${entry}/`);
}
