import { spawn } from "node:child_process";

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface DockerOptions {
  /**
   * Extra variables for the `docker` process. `docker create -e NAME` reads
   * the value from here, so secrets never appear on a command line.
   */
  env?: Record<string, string>;
  /** Stream the output to this terminal instead of capturing it. */
  inherit?: boolean;
}

/** The `docker` CLI, as a function so tests can script it. */
export type DockerCli = (args: string[], options?: DockerOptions) => Promise<DockerResult>;

export const dockerCli: DockerCli = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      env: { ...process.env, ...options.env },
      stdio: options.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** Runs `docker <args>` and throws with its stderr when it fails. */
export async function must(docker: DockerCli, args: string[], options?: DockerOptions): Promise<DockerResult> {
  const result = await docker(args, options);
  if (result.code !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  return result;
}
