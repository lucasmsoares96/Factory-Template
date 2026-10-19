import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach } from "vitest";
import { FakeAgent, type AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { FakeCodeHost } from "../src/adapters/fake/fake-code-host.ts";
import { FakeTracker, type FakeIssueInput } from "../src/adapters/fake/fake-tracker.ts";
import { FakeVerify, type VerifyStep } from "../src/adapters/fake/fake-verify.ts";
import { runFactory } from "../src/cli.ts";

const exec = promisify(execFile);

export const HUMAN = "alice";
export const MACHINE_USER = "factory-bot";

export const SPEC_BODY = "# Spec\n\n## Testing Decisions\n\n1. CLI against the fakes.\n";
export const ISSUE_BODY = [
  "## What to build",
  "",
  "Greet the user.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] `greet()` returns a greeting.",
  "",
].join("\n");

/** A spec (#1) and a ready issue (#7) under it, labelled by a writer. */
export function readyIssue(overrides: Partial<FakeIssueInput> = {}): FakeIssueInput[] {
  return [
    { number: 1, title: "Spec", body: SPEC_BODY },
    {
      number: 7,
      title: "Greet the user",
      body: ISSUE_BODY,
      parent: 1,
      labels: { "ready-for-agent": HUMAN },
      ...overrides,
    },
  ];
}

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

export async function tempDir(prefix = "factory-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd })).stdout.trim();
}

/** A repo with one commit on `main`; `src/app.ts` has 30 numbered lines. */
export async function createRepo(): Promise<string> {
  const dir = await tempDir("factory-repo-");
  await git(dir, "init", "--quiet", "--initial-branch=main");
  const lines = Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1};`);
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/app.ts"), lines.join("\n") + "\n");
  await writeFile(join(dir, ".gitignore"), "test-results/\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "--quiet", "-m", "chore: initial commit");
  return dir;
}

/** A second working copy of `origin`, like the checkout of another job. */
export async function cloneRepo(origin: string): Promise<string> {
  const dir = await tempDir("factory-clone-");
  await git(dir, "clone", "--quiet", origin, ".");
  return dir;
}

/** Writes `path` in the repo and commits it, as an agent session would. */
export async function commitFile(cwd: string, path: string, content: string, message: string): Promise<void> {
  await mkdir(dirname(join(cwd, path)), { recursive: true });
  await writeFile(join(cwd, path), content);
  await git(cwd, "add", path);
  await git(cwd, "commit", "--quiet", "-m", message);
}

export interface World {
  tracker: FakeTracker;
  codeHost: FakeCodeHost;
  agent: FakeAgent;
  verify: FakeVerify;
  env: Record<string, string>;
  logs: string[];
  /** Runs `pnpm factory <argv>` against the fakes; returns the exit code. */
  factory(...argv: string[]): Promise<number>;
}

export interface WorldOptions {
  issues?: FakeIssueInput[];
  writers?: string[];
  branches?: Record<string, string>;
  /** Working copy the fake Agent and Verify act on. */
  repo?: string;
  agent?: Partial<Record<"development" | "review", AgentStep[]>>;
  verify?: VerifyStep[];
  env?: Record<string, string>;
}

export function world(options: WorldOptions = {}): World {
  const tracker = new FakeTracker({ issues: options.issues ?? readyIssue(), writers: options.writers ?? [HUMAN] });
  const codeHost = new FakeCodeHost({ branches: options.branches ?? {} });
  const repo = options.repo ?? "/nonexistent";
  const agent = new FakeAgent(repo, options.agent ?? {});
  const verify = new FakeVerify(repo, "test-results/evidence", options.verify ?? []);
  const env = { FACTORY_MACHINE_USER: MACHINE_USER, ...options.env };
  const logs: string[] = [];
  return {
    tracker,
    codeHost,
    agent,
    verify,
    env,
    logs,
    factory: (...argv) =>
      runFactory(argv, { env, log: (line) => logs.push(line), adapters: () => ({ tracker, codeHost, agent, verify }) }),
  };
}

/** The last JSON line the CLI printed. */
export function lastJson(logs: string[]): unknown {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i]!;
    if (line.startsWith("{")) return JSON.parse(line);
  }
  throw new Error(`no JSON output in:\n${logs.join("\n")}`);
}
