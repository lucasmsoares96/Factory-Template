import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_ENV_ALLOWLIST, SandcastleAgent } from "../src/adapters/sandcastle/agent.ts";
import { checkout, git, tempDir } from "./helpers.ts";

/**
 * The real adapter (Sandcastle 0.12 + noSandbox in a child process) driving a
 * fake `claude` on PATH. The fake records its argv, stdin and env, may run a
 * shell command in the repo, and answers in Claude Code's stream-json.
 */
async function fakeClaude(behaviour: { run?: string; sleep?: boolean; exit?: number; result?: string; results?: string[] } = {}) {
  const bin = await tempDir("factory-bin-");
  const record = join(bin, "record.json");
  const lines = [
    { type: "system", subtype: "init", session_id: "session-1" },
    { type: "assistant", message: { content: [{ type: "text", text: "Working on it." }] } },
    {
      type: "result",
      subtype: "success",
      result: behaviour.result ?? "Done.",
      usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 40 },
    },
  ];
  const calls = join(bin, "calls.jsonl");
  const script = `#!/usr/bin/env node
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const stdin = fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin, env: process.env, cwd: process.cwd() }));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ argv: process.argv.slice(2), stdin }) + "\\n");
const nth = fs.readFileSync(${JSON.stringify(calls)}, "utf8").trim().split("\\n").length - 1;
// Claude Code keeps its sessions under HOME; Sandcastle checks the file exists before it resumes.
const dir = process.env.HOME + "/.claude/projects/-fake";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + "/session-1.jsonl", "{}\\n");
const results = ${JSON.stringify(behaviour.results ?? null)};
${behaviour.run ? `execSync(${JSON.stringify(behaviour.run)}, { stdio: "ignore" });` : ""}
${behaviour.sleep ? "setInterval(() => {}, 1000);" : `for (const line of ${JSON.stringify(lines)}) console.log(JSON.stringify(line.type === "result" && results ? { ...line, result: results[Math.min(nth, results.length - 1)] } : line));
process.exit(${behaviour.exit ?? 0});`}
`;
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
  return {
    path: `${bin}:${process.env.PATH}`,
    allCalls: async () =>
      (await readFile(calls, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; stdin: string }),
    recorded: async () =>
      JSON.parse(await readFile(record, "utf8")) as { argv: string[]; stdin: string; env: Record<string, string>; cwd: string },
  };
}

async function setup(behaviour: Parameters<typeof fakeClaude>[0] = {}) {
  const claude = await fakeClaude(behaviour);
  const repo = await checkout();
  // The agent's HOME has no git config: the job sets the identity on the clone.
  await git(repo, "config", "user.name", "Factory");
  await git(repo, "config", "user.email", "factory@localhost");
  const sessions = await tempDir("factory-sessions-");
  const env = {
    PATH: claude.path,
    HOME: await tempDir("factory-home-"),
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
    DATABASE_URL: "postgres://postgres:postgres@postgres:5432/postgres",
    CI: "true",
    // Must never reach the agent:
    FACTORY_TOKEN: "forge-token",
    GITHUB_TOKEN: "github-token",
    GH_TOKEN: "gh-token",
    AWS_SECRET_ACCESS_KEY: "aws",
    NODE_OPTIONS: "--require /tmp/evil.js",
  };
  const agent = new SandcastleAgent({ repo, sessionsDir: sessions, env });
  return { claude, repo, sessions, agent };
}

const options = { timeoutMs: 60_000, model: "claude-opus-5-5" };

describe("Sandcastle Agent", () => {
  it("runs Claude Code headless in the repo with only the allowlisted env", async () => {
    const { claude, repo, agent } = await setup();

    await agent.run("development", "Implement issue #7.", options);

    const seen = await claude.recorded();
    expect(seen.stdin).toBe("Implement issue #7.");
    expect(seen.argv).toEqual(expect.arrayContaining(["--print", "--output-format", "stream-json", "--model", "claude-opus-5-5"]));
    expect(seen.cwd).toBe(await git(repo, "rev-parse", "--show-toplevel"));
    expect(seen.env).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      DATABASE_URL: "postgres://postgres:postgres@postgres:5432/postgres",
      CI: "true",
    });
    // The shell that launches `claude` adds its own bookkeeping variables (and macOS
    // its text encoding); nothing else gets through.
    const shellAdded = new Set(["PWD", "OLDPWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING"]);
    const leaked = Object.keys(seen.env).filter((k) => !AGENT_ENV_ALLOWLIST.includes(k) && !shellAdded.has(k));
    expect(leaked).toEqual([]);
    expect(AGENT_ENV_ALLOWLIST).toEqual(["PATH", "HOME", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "DATABASE_URL", "CI"]);
  });

  it("reports the final message, the tokens and the commits of the session, and keeps its stream-json", async () => {
    const { repo, sessions, agent } = await setup({
      run: "echo 'export const greet = () => \"hi\";' > src/greet.ts && git add . && git commit -qm 'feat: greet #7' || true",
      result: "Implemented greet().",
    });

    const run = await agent.run("development", "Implement issue #7.", options);

    expect(run).toEqual({
      commits: 1,
      output: "Implemented greet().",
      usage: { inputTokens: 330, outputTokens: 40 },
      retries: 0,
      timedOut: false,
    });
    expect(await git(repo, "log", "-1", "--format=%s")).toBe("feat: greet #7");
    // Sandcastle leaves nothing in the working tree for the agent to commit by mistake.
    expect(await git(repo, "status", "--porcelain", "--ignored")).toBe("");
    const files = await readdir(sessions);
    expect(files.filter((f) => f.endsWith(".jsonl"))).toEqual(["01-development.jsonl"]);
    const stream = (await readFile(join(sessions, "01-development.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(stream.map((e) => e.type)).toEqual(["system", "assistant", "result"]);

    await agent.run("review", "Review it.", options);
    expect((await readdir(sessions)).filter((f) => f.endsWith(".jsonl"))).toEqual(["01-development.jsonl", "02-review.jsonl"]);
  });

  it("resumes the same session to extract the block, up to twice, adding the tokens", async () => {
    const { claude, sessions, agent } = await setup({ results: ["No block.", "Still no.", "<review>ok</review>"] });
    const extract = { valid: (output: string) => output.includes("<review>"), ask: "Emit the <review> block." };

    const run = await agent.run("review", "Review it.", { ...options, extract });

    const calls = await claude.allCalls();
    expect(calls.map((c) => c.stdin)).toEqual(["Review it.", "Emit the <review> block.", "Emit the <review> block."]);
    expect(calls.map((c) => c.argv.includes("--resume") && c.argv[c.argv.indexOf("--resume") + 1])).toEqual([false, "session-1", "session-1"]);
    expect(run).toMatchObject({ output: "<review>ok</review>", retries: 2, timedOut: false, usage: { inputTokens: 990, outputTokens: 120 } });
    expect((await readdir(sessions)).filter((f) => f.endsWith(".jsonl"))).toEqual(["01-review-resume1.jsonl", "01-review-resume2.jsonl", "01-review.jsonl"]);
  });

  it("gives up after 2 resumes and keeps the first message", async () => {
    const { claude, agent } = await setup({ results: ["First.", "no", "no", "<review>too late</review>"] });
    const extract = { valid: (output: string) => output.includes("<review>"), ask: "Emit the block." };

    const run = await agent.run("review", "Review it.", { ...options, extract });

    expect(await claude.allCalls()).toHaveLength(3);
    expect(run).toMatchObject({ output: "First.", retries: 2 });
  });

  it("does not resume without an extraction, or when the first message is valid", async () => {
    const { claude, agent } = await setup({ result: "<review>ok</review>" });
    const extract = { valid: (output: string) => output.includes("<review>"), ask: "Emit the block." };

    expect(await agent.run("review", "Review it.", options)).toMatchObject({ retries: 0 });
    expect(await agent.run("review", "Review it.", { ...options, extract })).toMatchObject({ retries: 0 });
    expect(await claude.allCalls()).toHaveLength(2);
  });

  it("stops a session at its timeout, killing the agent", async () => {
    const { agent } = await setup({ sleep: true });

    const started = Date.now();
    const run = await agent.run("development", "Implement issue #7.", { ...options, timeoutMs: 3000 });

    expect(run.timedOut).toBe(true);
    expect(run.commits).toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("fails the run when Claude Code fails (an infra failure for the job)", async () => {
    const { agent } = await setup({ exit: 1 });
    await expect(agent.run("development", "Implement issue #7.", options)).rejects.toThrow(/claude-code exited with code 1/);
  });
});
