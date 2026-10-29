import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach } from "vitest";
import { FakeAgent, type AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { FakeCodeHost, type FakePullRequestSeed } from "../src/adapters/fake/fake-code-host.ts";
import { FakeTracker, type FakeIssueInput } from "../src/adapters/fake/fake-tracker.ts";
import { FakeVerify, type SkeletonCheckStep, type VerifyStep } from "../src/adapters/fake/fake-verify.ts";
import { FACTORY_MARKER } from "../src/marker.ts";
import type { Stage } from "../src/seams/agent.ts";
import { runFactory } from "../src/cli.ts";

const exec = promisify(execFile);

export const HUMAN = "alice";

/** `text` without the hidden Factory marker the write adapters add. */
export const unmarked = (text: string): string => text.replace(`\n\n${FACTORY_MARKER}`, "");
/** The repo owner: the Factory writes with the owner's token, so it is a writer and the author of its own texts. */
export const OWNER = "owner";

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
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 })));
});

export async function tempDir(prefix = "factory-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd })).stdout.trim();
}

/**
 * Fixture repos are built once per test file and copied with `fs.cp`:
 * spawning git is the slow part of these tests (hundreds of ms per call on a
 * loaded machine), so each test starts from a copy instead of init + commit + clone.
 */
let template: Promise<string> | null = null;

/** An origin with one commit on `main` (`src/app.ts` has 30 numbered lines) and a clone of it. */
async function buildTemplate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "factory-template-"));
  const origin = join(root, "origin");
  await mkdir(join(origin, "src"), { recursive: true });
  const lines = Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1};`);
  await writeFile(join(origin, "src/app.ts"), lines.join("\n") + "\n");
  await writeFile(join(origin, ".gitignore"), "test-results/\n");
  await git(origin, "init", "--quiet", "--initial-branch=main");
  await git(origin, "add", ".");
  await git(origin, "commit", "--quiet", "-m", "chore: initial commit");
  await git(root, "clone", "--quiet", origin, "clone");
  return join(root, "clone");
}

afterAll(async () => {
  await Promise.all([...derived.values()].map(async (base) => rm(await base.catch(() => ""), { recursive: true, force: true, maxRetries: 3 })));
  derived.clear();
  if (template) await rm(dirname(await template), { recursive: true, force: true });
  template = null;
});

/**
 * A working copy of the fixture repo, like the checkout of one job: `main`
 * with one commit, `src/app.ts` with 30 numbered lines. Every checkout of a
 * test file shares that first commit, so bundles move between them.
 */
export async function checkout(): Promise<string> {
  template ??= buildTemplate();
  const dir = await tempDir("factory-repo-");
  await cp(await template, dir, { recursive: true });
  return dir;
}

const derived = new Map<string, Promise<string>>();

/**
 * Like `checkout()`, but starting from a commit the file's tests share: `setup` runs once per test file
 * (on the first call for `key`) and every call returns a fresh copy, so the git round-trips of `setup`
 * are not repeated per test.
 */
export async function derivedCheckout(key: string, setup: (dir: string) => Promise<void>): Promise<string> {
  if (!derived.has(key)) {
    derived.set(
      key,
      (async () => {
        const base = await mkdtemp(join(tmpdir(), "factory-derived-"));
        await cp(await (template ??= buildTemplate()), base, { recursive: true });
        await setup(base);
        return base;
      })(),
    );
  }
  const dir = await tempDir("factory-repo-");
  await cp(await derived.get(key)!, dir, { recursive: true });
  return dir;
}

/** Writes `path` in the repo and commits it, as an agent session would. */
export async function commitFile(cwd: string, path: string, content: string, message: string): Promise<void> {
  await commitFiles(cwd, { [path]: content }, message);
}

/** Writes every file and commits them together. */
export async function commitFiles(cwd: string, files: Record<string, string>, message: string): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), content);
  }
  await git(cwd, "add", "--", ...Object.keys(files));
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
  prs?: FakePullRequestSeed[];
  /** Clock of the run, in ms; defaults to the real one. */
  now?: () => number;
  /** Working copy the fake Agent and Verify act on. */
  repo?: string;
  agent?: Partial<Record<Stage, AgentStep[]>>;
  verify?: VerifyStep[];
  /** Scripts the Skeleton check (`Verify.checkSkeleton`); by default it passes and writes nothing. */
  skeletonCheck?: SkeletonCheckStep[];
  env?: Record<string, string>;
  /** The code host of the job token (`jobToken: true`); the forge token's one when absent. */
  jobCodeHost?: FakeCodeHost;
}

export function world(options: WorldOptions = {}): World {
  const tracker = new FakeTracker({
    issues: options.issues ?? readyIssue(),
    writers: [...(options.writers ?? [HUMAN]), OWNER],
    self: OWNER,
  });
  const codeHost = new FakeCodeHost({ branches: options.branches ?? {}, prs: options.prs ?? [], self: OWNER });
  const repo = options.repo ?? "/nonexistent";
  const agent = new FakeAgent(repo, options.agent ?? {});
  const verify = new FakeVerify(repo, "test-results/evidence", options.verify ?? [], options.skeletonCheck);
  const env: Record<string, string> = { ...options.env };
  const logs: string[] = [];
  return {
    tracker,
    codeHost,
    agent,
    verify,
    env,
    logs,
    factory: (...argv) =>
      runFactory(argv, {
        env,
        log: (line) => logs.push(line),
        adapters: ({ jobToken }) => ({ tracker, codeHost: (jobToken && options.jobCodeHost) || codeHost, agent, verify }),
        ...(options.now ? { now: options.now } : {}),
      }),
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

/** A manual clock for the global time limit: steps call `advance(minutes)`. */
export function manualClock() {
  let ms = 0;
  return { now: () => ms, advance: (minutes: number) => void (ms += minutes * 60_000) };
}
