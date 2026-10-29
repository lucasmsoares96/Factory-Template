import { spawn } from "node:child_process";
import { pick, VERIFY_ENV, VERIFY_ENV_PREFIXES } from "../env.ts";
import type { Verify, VerifyRun } from "../seams/verify.ts";

const COMMAND = ["pnpm", "factory:verify"];
/** The checks of a Skeleton change, in order: the first to fail stops the rest. */
const SKELETON_COMMANDS = [
  ["pnpm", "install", "--no-frozen-lockfile"],
  ["pnpm", "generate"],
  ["pnpm", "typecheck"],
  ["pnpm", "lint"],
];
/** Output kept in memory; `work` keeps a shorter tail in result.json. */
const OUTPUT_LIMIT = 1024 * 1024;
const KILL_GRACE_MS = 5000;

export interface FactoryVerifyOptions {
  repo: string;
  env?: Record<string, string | undefined>;
  /** Mirror the output to this stream as it comes (the job log). */
  echo?: NodeJS.WritableStream;
}

/**
 * Verify seam: the Product contract `pnpm factory:verify` in the working copy,
 * in its own process group so a timeout stops turbo, Vite and the browsers too.
 */
export class FactoryVerify implements Verify {
  private readonly options: FactoryVerifyOptions;

  constructor(options: FactoryVerifyOptions) {
    this.options = options;
  }

  run({ timeoutMs }: { timeoutMs: number }): Promise<VerifyRun> {
    return this.execute(COMMAND, this.options.repo, timeoutMs);
  }

  async checkSkeleton({ dir, timeoutMs }: { dir: string; timeoutMs: number }): Promise<VerifyRun> {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    for (const command of SKELETON_COMMANDS) {
      const left = deadline - Date.now();
      const step = left > 0 ? await this.execute(command, dir, left) : { ok: false, failedCommand: command.join(" "), output: "", timedOut: true };
      output += step.output;
      if (!step.ok) return { ...step, output };
    }
    return { ok: true, failedCommand: null, output, timedOut: false };
  }

  private execute(commandLine: readonly string[], cwd: string, timeoutMs: number): Promise<VerifyRun> {
    const [command, ...args] = commandLine as [string, ...string[]];
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: pick(this.options.env ?? process.env, VERIFY_ENV, VERIFY_ENV_PREFIXES),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let timedOut = false;
      const collect = (chunk: Buffer) => {
        this.options.echo?.write(chunk);
        output = (output + chunk.toString()).slice(-OUTPUT_LIMIT);
      };
      const kill = (signal: NodeJS.Signals) => {
        try {
          process.kill(-child.pid!, signal);
        } catch {
          // Already gone.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill("SIGTERM");
        setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS).unref();
      }, timeoutMs);
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        kill("SIGKILL");
        const ok = !timedOut && code === 0;
        resolve({ ok, failedCommand: ok ? null : commandLine.join(" "), output, timedOut });
      });
    });
  }
}
