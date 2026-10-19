// The symlink half of `skills-check`: `.claude/skills/<x>` must be a symlink to
// `../../.agents/skills/<x>`, one for each skill folder, and nothing else.
// (The lock half is `skills experimental_install` + `git diff --exit-code`.)
// `node .factory/src/ci/skills.ts` checks the current directory.
import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/** What is wrong, one line each; empty when the links are as they should be. */
export function skillLinkProblems(repo: string): string[] {
  const skills = join(repo, ".agents/skills");
  const links = join(repo, ".claude/skills");
  const folders = existsSync(skills) ? readdirSync(skills, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  const entries = existsSync(links) ? readdirSync(links) : [];
  const problems: string[] = [];
  for (const name of folders) {
    const link = join(links, name);
    if (!entries.includes(name)) problems.push(`.claude/skills/${name} is missing`);
    else if (!lstatSync(link).isSymbolicLink()) problems.push(`.claude/skills/${name} is not a symlink`);
    else if (readlinkSync(link) !== `../../.agents/skills/${name}`) problems.push(`.claude/skills/${name} points to ${readlinkSync(link)}`);
  }
  for (const name of entries) if (!folders.includes(name)) problems.push(`.claude/skills/${name} has no .agents/skills/${name}`);
  return problems;
}

if (import.meta.main) {
  const problems = skillLinkProblems(process.cwd());
  for (const problem of problems) console.error(problem);
  process.exitCode = problems.length ? 1 : 0;
}
