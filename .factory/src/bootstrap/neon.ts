import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BASE_ENV, pick } from "../env.ts";
import type { NeonClient, NeonOrg, NeonProject } from "./clients.ts";

/** Runs `neonctl <args>` and returns stdout. `inherit` hands the terminal over (the browser login prints a URL). */
export type NeonRun = (args: string[], options: { env: Record<string, string>; inherit?: boolean }) => Promise<string>;
/** The same, synchronously: the only kind that can run while the process is exiting. */
export type NeonRunSync = (args: string[], options: { env: Record<string, string> }) => void;

// `pnpm --filter @factory/harness exec` finds the pinned `neonctl` (a devDependency) from any directory of the repo.
const NEONCTL = ["--filter", "@factory/harness", "exec", "neonctl"];

export const runNeonctl: NeonRun = (args, { env, inherit }) =>
  new Promise((resolve, reject) => {
    if (inherit) {
      // The browser login prints its URL for the case the browser does not open: the person must see it.
      const child = spawn("pnpm", [...NEONCTL, ...args], { env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve("") : reject(new Error(`neonctl ${args[0]} failed (exit ${code}).`))));
      return;
    }
    execFile("pnpm", [...NEONCTL, ...args], { env, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      // Only the subcommand and the tail of stderr are reported: stdout may hold a connection string.
      reject(new Error(`neonctl ${args[0]} failed: ${stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300) || error.message}`));
    });
  });

export const runNeonctlSync: NeonRunSync = (args, { env }) => {
  execFileSync("pnpm", [...NEONCTL, ...args], { env, stdio: "ignore", timeout: 20_000 });
};

const project = z.object({ id: z.string(), name: z.string() });
const orgs = z.union([z.array(z.object({ id: z.string(), name: z.string() })), z.object({ organizations: z.array(z.object({ id: z.string(), name: z.string() })) })]);
const projects = z.union([z.array(project), z.object({ projects: z.array(project) })]);
const created = z.object({ project });
const branch = z.object({ id: z.string(), name: z.string(), default: z.boolean().optional(), primary: z.boolean().optional() });
const branches = z.union([z.array(branch), z.object({ branches: z.array(branch) })]);
const apiKey = z.object({ key: z.string() });

/**
 * `neonctl` driven as a child process, always with `--config-dir <throwaway>` so the login of this run never touches
 * `~/.config/neon`, and `-o json` (table output can omit fields). The credentials file is never read: only the CLI does.
 * With `apiKey`, the CLI gets it as `NEON_API_KEY` and no login happens.
 * Docs read 2026-10-20: neon.com/docs/reference/{cli-auth,neon-cli,cli-connection-string,cli-projects}.
 */
export class NeonCli implements NeonClient {
  private readonly apiKey: string | undefined;
  private readonly env: Record<string, string | undefined>;
  private readonly run: NeonRun;
  private readonly runSync: NeonRunSync;
  private dir: string | undefined;

  constructor(options: { apiKey?: string; env?: Record<string, string | undefined>; run?: NeonRun; runSync?: NeonRunSync } = {}) {
    this.apiKey = options.apiKey;
    this.env = options.env ?? process.env;
    this.run = options.run ?? runNeonctl;
    this.runSync = options.runSync ?? runNeonctlSync;
  }

  private configDir(): string {
    this.dir ??= mkdtempSync(join(tmpdir(), "factory-neon-"));
    return this.dir;
  }

  private childEnv(): Record<string, string> {
    return { ...pick(this.env, BASE_ENV), ...(this.apiKey ? { NEON_API_KEY: this.apiKey } : {}) };
  }

  private call(args: string[], inherit = false): Promise<string> {
    return this.run([...args, "--config-dir", this.configDir()], { env: this.childEnv(), inherit });
  }

  async login(): Promise<void> {
    if (this.apiKey) return;
    await this.call(["auth"], true);
  }

  async listOrgs(): Promise<NeonOrg[]> {
    const parsed = orgs.parse(JSON.parse(await this.call(["orgs", "list", "-o", "json"])));
    return Array.isArray(parsed) ? parsed : parsed.organizations;
  }

  async listProjects(orgId?: string): Promise<NeonProject[]> {
    const parsed = projects.parse(JSON.parse(await this.call(["projects", "list", ...orgFlag(orgId), "-o", "json"])));
    return (Array.isArray(parsed) ? parsed : parsed.projects).map(({ id, name }) => ({ id, name }));
  }

  async createProject(name: string, orgId?: string): Promise<NeonProject> {
    // --no-secrets keeps the password out of the output we parse.
    const made = created.parse(JSON.parse(await this.call(["projects", "create", "--name", name, ...orgFlag(orgId), "--no-secrets", "-o", "json"]))).project;
    return { id: made.id, name: made.name };
  }

  async createApiKey(name: string, projectId: string): Promise<string> {
    // `--project-id` alone: the CLI looks the organization up from the project. The key is only in this return value.
    return apiKey.parse(JSON.parse(await this.call(["api-keys", "create", "--name", name, "--project-id", projectId, "-o", "json"]))).key;
  }

  async defaultBranchName(projectId: string): Promise<string> {
    const parsed = branches.parse(JSON.parse(await this.call(["branches", "list", "--project-id", projectId, "-o", "json"])));
    const all = Array.isArray(parsed) ? parsed : parsed.branches;
    const found = all.find((b) => b.default === true || b.primary === true);
    if (!found) throw new Error("neonctl branches list shows no default branch.");
    return found.name;
  }

  async renameBranch(projectId: string, from: string, to: string): Promise<void> {
    await this.call(["branches", "rename", from, to, "--project-id", projectId]);
  }

  async connectionString(projectId: string, options: { pooled: boolean; orgId?: string }): Promise<string> {
    const out = await this.call([
      "connection-string",
      "--project-id", projectId,
      ...orgFlag(options.orgId),
      ...(options.pooled ? ["--pooled"] : []),
      "--role-name", "neondb_owner",
      "--database-name", "neondb",
    ]);
    const uri = out.trim();
    if (!/^postgres(ql)?:\/\//.test(uri)) throw new Error("neonctl connection-string did not answer a connection string.");
    return uri;
  }

  async close(): Promise<void> {
    this.closeSync();
  }

  /** Logout (best effort: it revokes the refresh token server-side), then remove the directory. */
  closeSync(): void {
    const dir = this.dir;
    if (!dir) return;
    this.dir = undefined;
    try {
      this.runSync(["logout", "--config-dir", dir], { env: this.childEnv() });
    } catch {
      // Not logged in, offline or the CLI is gone: the directory goes anyway.
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

const orgFlag = (orgId?: string) => (orgId ? ["--org-id", orgId] : []);
