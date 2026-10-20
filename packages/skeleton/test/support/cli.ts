import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../../bin/skeleton.ts", import.meta.url));

/** Runs the `skeleton` CLI the way a Product's scripts do. */
export function skeleton(args: string[], { cwd, env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}
