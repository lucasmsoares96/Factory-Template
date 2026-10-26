/**
 * Paths the Factory may change, but that a person must review with special care: a workflow runs with the repo's
 * secrets, and skills, `.claude/` and `.mcp.json` steer every agent. A diff here never stops a run (ADR 0012): the
 * pull request gets the `harness-change` label and a warning that names these files.
 */
export const SENSITIVE_PATHS = [
  ".github/workflows/",
  ".agents/skills",
  ".claude/",
  "skills-lock.json",
  ".mcp.json",
];

/** A diff here gets the `harness-change` label and a caution on top of the pull request. */
export const HARNESS_PATHS = ["AGENTS.md", "docs/agents/", "GLOSSARY.md", "CODING_STANDARDS.md", "docs/adr/", ".factory/"];

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATHS.some((p) => matches(path, p));
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
