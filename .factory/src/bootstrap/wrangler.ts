import { execFile, spawn } from "node:child_process";
import { z } from "zod";
import { BASE_ENV, pick } from "../env.ts";
import { WranglerNotInstalled, type WranglerAuth } from "./clients.ts";

/** Runs `wrangler <args>` and returns stdout. `inherit` hands the terminal over (the browser login prints a URL). */
export type WranglerRun = (args: string[], options: { env: Record<string, string>; inherit?: boolean }) => Promise<string>;

// `pnpm --filter @factory/harness exec` finds the pinned `wrangler` (a devDependency) from any directory of the repo.
const WRANGLER = ["--filter", "@factory/harness", "exec", "wrangler"];

/**
 * What `pnpm exec` prints when the `wrangler` binary (or the harness package that holds it) is not there. Not
 * `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`: pnpm prints that for any non-zero exit of wrangler, such as "not logged in".
 */
const NOT_INSTALLED = /Command "wrangler" not found|No projects matched/;

export const wranglerMissing = (stderr: string): boolean => NOT_INSTALLED.test(stderr);

export const runWrangler: WranglerRun = (args, { env, inherit }) =>
  new Promise((resolve, reject) => {
    if (inherit) {
      const child = spawn("pnpm", [...WRANGLER, ...args], { env, stdio: "inherit" });
      child.on("error", (error) => reject((error as NodeJS.ErrnoException).code === "ENOENT" ? new WranglerNotInstalled() : error));
      child.on("exit", (code) => (code === 0 ? resolve("") : reject(new Error(`wrangler ${args[0]} failed (exit ${code}).`))));
      return;
    }
    execFile("pnpm", [...WRANGLER, ...args], { env, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || wranglerMissing(stderr)) return reject(new WranglerNotInstalled());
      // stdout may hold a token: only the subcommand and the tail of stderr are reported.
      reject(new Error(`wrangler ${args[0]} failed: ${stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300) || error.message}`));
    });
  });

const authToken = z.object({ type: z.string(), token: z.string().min(1) });

/**
 * wrangler's saved OAuth login. `wrangler auth token --json` prints `{ type, token }` and refreshes an expired OAuth
 * token itself (docs "General commands", wrangler 4.151.2, read 2026-10-20). The child gets no `CLOUDFLARE_*` variable,
 * so the answer is always the saved login, never an environment token. The token is returned, never logged or stored.
 */
export class WranglerCli implements WranglerAuth {
  private readonly run: WranglerRun;
  private readonly env: Record<string, string>;

  constructor(options: { env?: Record<string, string | undefined>; run?: WranglerRun } = {}) {
    this.env = pick(options.env ?? process.env, BASE_ENV);
    this.run = options.run ?? runWrangler;
  }

  async savedToken(): Promise<string | undefined> {
    try {
      const parsed = authToken.safeParse(JSON.parse(await this.run(["auth", "token", "--json"], { env: this.env })));
      return parsed.success && parsed.data.type === "oauth" ? parsed.data.token : undefined;
    } catch (error) {
      // An install problem is not "no saved login": the caller must be able to say so.
      if (error instanceof WranglerNotInstalled) throw error;
      return undefined;
    }
  }

  async login(): Promise<void> {
    await this.run(["login"], { env: this.env, inherit: true });
  }
}
