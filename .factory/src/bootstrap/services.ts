import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BASE_ENV, pick } from "../env.ts";
import type { NeonClient, NeonProject, ResendClient, ResendDomain } from "./clients.ts";

const exec = promisify(execFile);

/** Neon through `neonctl` (a devDependency); it reads `NEON_API_KEY` from the environment. */
export class NeonCli implements NeonClient {
  private readonly env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.env = env;
  }

  async findProject(name: string): Promise<NeonProject | null> {
    const { stdout } = await exec("pnpm", ["exec", "neonctl", "projects", "list", "--output", "json"], {
      env: pick(this.env, [...BASE_ENV, "NEON_API_KEY"]),
    });
    const parsed = JSON.parse(stdout) as { projects?: NeonProject[] } | NeonProject[];
    const projects = Array.isArray(parsed) ? parsed : (parsed.projects ?? []);
    return projects.find((p) => p.name === name) ?? null;
  }
}

/** Resend over its REST API; the key stays in memory. */
export class ResendApi implements ResendClient {
  private readonly key: string;
  private readonly fetchFn: typeof fetch;

  constructor(key: string, fetchFn: typeof fetch = fetch) {
    this.key = key;
    this.fetchFn = fetchFn;
  }

  async findDomain(name: string): Promise<ResendDomain | null> {
    const response = await this.fetchFn("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${this.key}` } });
    if (!response.ok) throw new Error(`Resend refused the request (${response.status}).`);
    const body = (await response.json()) as { data?: ResendDomain[] };
    return (body.data ?? []).find((d) => d.name === name) ?? null;
  }
}
