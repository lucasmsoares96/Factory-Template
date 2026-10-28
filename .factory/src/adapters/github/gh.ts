import { execFile } from "node:child_process";
import { BASE_ENV, pick } from "../../env.ts";

/**
 * Runs `gh <args>` with exactly `env` as its environment (nothing of the parent's is added) and `input` on stdin;
 * resolves with stdout, rejects with gh's stderr.
 */
export type GhRunner = (args: string[], options: { env: Record<string, string>; input?: string }) => Promise<string>;

/** Where a signed-in `gh` finds its credentials and host, beyond the `HOME` of `BASE_ENV`: for a human's own `gh auth login`. */
export const GH_AUTH_ENV = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_HOST", "GH_CONFIG_DIR", "XDG_CONFIG_HOME"];

/** What git and gh get: the base variables every tool needs, plus `extra` (the token they authenticate with). Never the parent's secrets. */
export function childEnv(parent: Record<string, string | undefined>, extra: Record<string, string>): Record<string, string> {
  return { ...pick(parent, BASE_ENV), ...extra };
}

/** The one place the Factory spawns `gh`. */
export const runGh: GhRunner = (args, { env, input }) =>
  new Promise((resolve, reject) => {
    const child = execFile("gh", args, { env, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(new Error("The GitHub CLI (`gh`) is required and was not found. Install it from https://cli.github.com and run `gh auth login`."));
      }
      reject(new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || error.message}`));
    });
    child.stdin?.end(input ?? "");
  });
