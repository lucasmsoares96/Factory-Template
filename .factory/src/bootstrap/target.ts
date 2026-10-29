import { execFile } from "node:child_process";
import type { BootstrapDeps } from "./steps.ts";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/name` of a GitHub remote URL (https, ssh or scp-like), or `undefined` when it is not one. */
export function parseRemote(url: string): string | undefined {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1] && REPO.test(match[1]) ? match[1] : undefined;
}

/** The repo of the `origin` remote of the current directory, or `undefined` (no remote, or not GitHub). */
export function gitOrigin(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["remote", "get-url", "origin"], (error, stdout) => resolve(error ? undefined : parseRemote(stdout)));
  });
}

const NO_ORIGIN = "This clone has no GitHub `origin` remote, so the bootstrap does not know which repository to set up. Configure it with `git remote add origin https://github.com/<owner>/<name>.git`, or pass `--repo <owner>/<name>`.";

/**
 * Picks the one repository every `gh` call of this run goes to (`--repo`, else `origin`, never `upstream`) and,
 * before any step, shows it with its visibility and asks to confirm it. Without a terminal `--repo` is required and
 * must equal `origin`. Returns `false` (after logging why) when the run must stop with nothing written.
 */
export async function chooseTarget(deps: BootstrapDeps, repoArg: string | undefined): Promise<boolean> {
  const origin = await deps.origin?.();
  if (repoArg !== undefined && !REPO.test(repoArg)) {
    deps.log(`--repo must look like owner/name, got "${repoArg}".`);
    return false;
  }
  if (!deps.interactive) {
    if (repoArg === undefined) {
      deps.log("No terminal to confirm the repository: pass `--repo <owner>/<name>`, equal to the `origin` remote.");
      return false;
    }
    if (origin === undefined) {
      deps.log(NO_ORIGIN);
      return false;
    }
    if (repoArg.toLowerCase() !== origin.toLowerCase()) {
      deps.log(`Without a terminal \`--repo\` must equal the \`origin\` remote (${origin}), got ${repoArg}.`);
      return false;
    }
  }
  const target = repoArg ?? origin;
  if (target === undefined) {
    deps.log(NO_ORIGIN);
    return false;
  }
  deps.github.target(target);
  const info = await deps.github.repo();
  const shown = `${info.fullName} (${info.visibility})`;
  if (!deps.interactive) {
    deps.log(`Repository: ${shown}`);
    return true;
  }
  if (!(await deps.prompter.confirm({ id: "repo-confirm", message: `Set up ${shown}?`, initial: true }))) {
    deps.log("Not confirmed; nothing was written.");
    return false;
  }
  return true;
}
