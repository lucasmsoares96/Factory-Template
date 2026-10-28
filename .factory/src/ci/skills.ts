// The skills of the repo follow their upstream (ADR 0013).
//   node .factory/src/ci/skills.ts [links]          `.claude/skills/<x>` is a symlink to `../../.agents/skills/<x>`, one per skill
//   node .factory/src/ci/skills.ts check --base <sha>
//        (the PR's `skills-check`, after `skills experimental_install`) fails only when the PR itself changed a skill
//        and the restore does not reproduce it; an upstream change the PR did not make is a notice, never a failure
//   node .factory/src/ci/skills.ts patch --out <dir>
//        (the `fetch` job of factory-skills-update.yml, after the restore on the default branch, no secret) writes
//        `skills.patch` with only the skill paths and prints `changed=true|false` to $GITHUB_OUTPUT
//   node .factory/src/ci/skills.ts publish --in <dir>
//        (the `publish` job, FACTORY_TOKEN) applies the patch on `skills/update`, pushes it, opens or reuses its PR and
//        turns on auto-merge: GitHub merges it once `verify` is green, with no one looking
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { childEnv, runGh } from "../adapters/github/gh.ts";

/** Every path the restore can change. A patch outside them is refused. */
export const SKILL_PATHS = [".agents/skills/", "skills-lock.json"];
export const UPDATE_BRANCH = "skills/update";
export const PATCH_FILE = "skills.patch";

export function isSkillPath(path: string): boolean {
  return SKILL_PATHS.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

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

export type SkillsVerdict = { ok: true; notice: string | null } | { ok: false; reason: string };

/**
 * The PR's `skills-check`. `restored` is what the restore changed in the checkout (dirty or new paths); `prChanged` is
 * what the PR changed against its base. A PR that edits a skill or the lock must commit exactly what the restore gives;
 * a PR that did not touch them is never failed for an upstream change, which `factory-skills-update.yml` takes.
 */
export function skillsVerdict(input: { restored: string[]; prChanged: string[] }): SkillsVerdict {
  const restored = input.restored.filter(isSkillPath);
  const stray = input.restored.filter((p) => !isSkillPath(p));
  if (stray.length > 0) return { ok: false, reason: `The restore changed files outside the skills: ${stray.join(", ")}` };
  if (restored.length === 0) return { ok: true, notice: null };
  const touched = input.prChanged.filter(isSkillPath);
  if (touched.length > 0) {
    return { ok: false, reason: `This pull request changes ${touched.join(", ")}, but the restore from skills-lock.json gives other files: ${restored.join(", ")}. Run \`npx skills@1.7.2 experimental_install\` and commit the result.` };
  }
  return { ok: true, notice: `Upstream skills changed (${restored.join(", ")}). Not this pull request's doing: factory-skills-update.yml takes the new version on its own.` };
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Paths the working tree changed or added, against HEAD. */
function dirtyPaths(cwd: string): string[] {
  return git(cwd, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, ""))
    .map((path) => (path.includes(" -> ") ? path.split(" -> ")[1]! : path));
}

/** The paths of a unified diff (both sides of every `diff --git` line). */
export function patchPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const m of patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    paths.add(m[1]!);
    paths.add(m[2]!);
  }
  return [...paths];
}

function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

/** `gh` with the base variables plus `env` (the token), nothing else of the job's env. */
const gh = (args: string[], env: Record<string, string>) => runGh(args, { env: childEnv(process.env, env) });

if (import.meta.main) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { base: { type: "string" }, out: { type: "string" }, in: { type: "string" } } });
  const cwd = process.cwd();
  const command = positionals[0] ?? "links";

  if (command === "links") {
    const problems = skillLinkProblems(cwd);
    for (const problem of problems) console.error(problem);
    process.exitCode = problems.length ? 1 : 0;
  } else if (command === "check") {
    if (!values.base) throw new Error("check needs --base <sha>");
    const prChanged = git(cwd, "diff", "--name-only", `${values.base}...HEAD`).split("\n").filter(Boolean);
    const verdict = skillsVerdict({ restored: dirtyPaths(cwd), prChanged });
    if (!verdict.ok) {
      console.error(verdict.reason);
      process.exitCode = 1;
    } else if (verdict.notice) console.log(`::notice::${verdict.notice}`);
  } else if (command === "patch") {
    const out = values.out;
    if (!out) throw new Error("patch needs --out <dir>");
    const dirty = dirtyPaths(cwd);
    const stray = dirty.filter((p) => !isSkillPath(p));
    if (stray.length > 0) throw new Error(`The restore changed files outside the skills: ${stray.join(", ")}`);
    mkdirSync(out, { recursive: true });
    if (dirty.length === 0) {
      output("changed", "false");
      console.log("skills are up to date");
    } else {
      git(cwd, "add", "--", ...SKILL_PATHS);
      writeFileSync(join(out, PATCH_FILE), git(cwd, "diff", "--cached", "--binary"));
      output("changed", "true");
      console.log(`skills changed upstream: ${dirty.join(", ")}`);
    }
  } else if (command === "publish") {
    const dir = values.in;
    if (!dir) throw new Error("publish needs --in <dir>");
    const token = process.env.FACTORY_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!token || !repo) throw new Error("publish needs FACTORY_TOKEN and GITHUB_REPOSITORY.");
    const patch = readFileSync(join(dir, PATCH_FILE), "utf8");
    // The patch comes from a job that ran a third-party CLI: it may only touch the skills.
    const outside = patchPaths(patch).filter((p) => !isSkillPath(p));
    if (outside.length > 0) throw new Error(`The skills patch touches other files, refused: ${outside.join(", ")}`);
    git(cwd, "switch", "-C", UPDATE_BRANCH);
    execFileSync("git", ["apply", "--index", join(dir, PATCH_FILE)], { cwd });
    git(cwd, "-c", "user.name=Factory", "-c", "user.email=factory@users.noreply.github.com", "commit", "-q", "-m", "chore(skills): take the upstream versions of the locked skills");
    const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
    execFileSync("git", ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, "push", "--force", `https://github.com/${repo}.git`, `HEAD:refs/heads/${UPDATE_BRANCH}`], { cwd, stdio: "ignore" });
    const env = { GH_TOKEN: token };
    const open = (await gh(["pr", "list", "--repo", repo, "--head", UPDATE_BRANCH, "--state", "open", "--json", "number", "--jq", ".[0].number"], env)).trim();
    const pr =
      open ||
      (await gh(
        ["pr", "create", "--repo", repo, "--head", UPDATE_BRANCH, "--base", process.env.BASE_BRANCH || "main", "--title", "chore(skills): take the upstream versions of the locked skills", "--body", "The locked skills changed upstream. `factory-skills-update.yml` opened this pull request and turned on auto-merge: GitHub merges it once `verify` is green (ADR 0013).\n\n<!-- factory -->"],
        env,
      ))
        .trim()
        .split("/")
        .at(-1)!;
    try {
      await gh(["pr", "merge", pr, "--repo", repo, "--auto", "--merge"], env);
      console.log(`pull request #${pr}: auto-merge on`);
    } catch (error) {
      // The repo setting is off: `pnpm bootstrap factory` turns it on (step `auto-merge`).
      console.log(`::warning::pull request #${pr} is open, but auto-merge could not be turned on (${(error as Error).message.split("\n")[0]}). Run \`pnpm bootstrap factory\` to allow auto-merge.`);
    }
  } else {
    throw new Error("Usage: skills.ts [links | check --base <sha> | patch --out <dir> | publish --in <dir>]");
  }
}
