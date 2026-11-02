/**
 * The reason a child process gave on stderr, for an error message. `pnpm exec` wraps a failure in its own frame
 * ("ELIFECYCLE", "pnpm recursive exec failed"), which is noise: the `ERROR:` line of the tool is what says why.
 * stdout is never used here (it may hold a connection string or a token).
 */
export function stderrReason(stderr: string): string {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  const framed = (line: string) => /^(\S*\s)?(ERR_PNPM_|ELIFECYCLE|WARN\b)/.test(line) || /pnpm recursive exec failed|Command failed with exit code/i.test(line) || /^\s*(\w+ )?(pnpm|npm) (error|ERR)/i.test(line);
  const reasons = lines.filter((line) => /\b(ERROR|Error):/.test(line) && !framed(line));
  const picked = reasons.length > 0 ? reasons.slice(-2) : lines.filter((line) => !framed(line)).slice(-3);
  return (picked.length > 0 ? picked : lines.slice(-3)).join(" ").slice(0, 300);
}
