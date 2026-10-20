import { describe, expect, it } from "vitest";
import { FactoryVerify } from "../src/adapters/factory-verify.ts";
import { dockerCli } from "../src/local/docker.ts";
import { AGENT_ENV_ALLOWLIST, BASE_ENV, pick, VERIFY_ENV } from "../src/env.ts";
import { containerEnv } from "../src/commands/local.ts";
import { allowlisted } from "../src/adapters/sandcastle/agent.ts";
import { tempDir } from "./helpers.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const SECRETS = { GITHUB_TOKEN: "ghp_x", GH_TOKEN: "ghp_y", CLOUDFLARE_API_TOKEN: "cf", NEON_API_KEY: "neon", FORGEJO_TOKEN: "fj" };

describe("shared env allowlists", () => {
  it("pick keeps named keys and prefixes, and nothing else", () => {
    expect(pick({ A: "1", B: "2", TURBO_X: "3", C: undefined }, ["A", "C"], ["TURBO_"])).toEqual({ A: "1", TURBO_X: "3" });
  });

  it("the agent allowlist and the container env share one definition of Claude's auth", () => {
    const env = { ...SECRETS, PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k", DATABASE_URL: "db" };
    expect(Object.keys(allowlisted(env)).sort()).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "DATABASE_URL", "PATH"]);
    expect(Object.keys(containerEnv(env)).sort()).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(AGENT_ENV_ALLOWLIST).toEqual(expect.arrayContaining(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]));
  });

  it("no allowlist contains a forge or cloud token", () => {
    for (const key of [...AGENT_ENV_ALLOWLIST, ...BASE_ENV, ...VERIFY_ENV]) expect(key).not.toMatch(/GITHUB|GH_|FORGEJO|CLOUDFLARE|NEON/);
  });

  it("factory:verify children do not see forge tokens", async () => {
    const repo = await tempDir("factory-verify-env-");
    const script = "node -e \"console.log(JSON.stringify(Object.keys(process.env)))\"";
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "p", private: true, scripts: { "factory:verify": script } }));
    const env = { ...process.env, ...SECRETS, TURBO_FORCE: "1" };

    const run = await new FactoryVerify({ repo, env }).run({ timeoutMs: 60_000 });

    expect(run.ok).toBe(true);
    const seen = JSON.parse(run.output.split("\n").find((l) => l.startsWith("["))!) as string[];
    for (const key of Object.keys(SECRETS)) expect(seen).not.toContain(key);
    expect(seen).toContain("TURBO_FORCE");
  });

  it("the docker CLI child gets no forge token, only the explicit env", async () => {
    Object.assign(process.env, SECRETS);
    try {
      // A `docker` shim on PATH that prints its environment.
      const bin = await tempDir("factory-docker-shim-");
      await writeFile(join(bin, "docker"), "#!/bin/sh\nenv\n", { mode: 0o755 });
      const shimmed = await withPath(bin, () => dockerCli([], { env: { EXPLICIT: "yes" } }));
      expect(shimmed.stdout).toContain("EXPLICIT=yes");
      for (const key of Object.keys(SECRETS)) expect(shimmed.stdout).not.toContain(`${key}=`);
    } finally {
      for (const key of Object.keys(SECRETS)) delete process.env[key];
    }
  });
});

async function withPath<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = before;
  }
}
