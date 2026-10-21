import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { evidenceDir, LocalCodeHost } from "../adapters/local/local-code-host.ts";
import { ISSUE_FILE } from "../adapters/local/markdown-issues.ts";
import { MarkdownTracker } from "../adapters/local/markdown-tracker.ts";
import { CLAUDE_AUTH, pick } from "../env.ts";
import { Git } from "../git.ts";
import { configVariables, issueBranch } from "../config.ts";
import { IN_BUNDLE, IN_TRACKER, type ContainerRunner } from "../local/container.ts";
import type { Agent } from "../seams/agent.ts";
import type { Verify } from "../seams/verify.ts";
import { claim, type ClaimResult } from "./claim.ts";
import { apply, hasTriageResult, type ApplyRun } from "./triage.ts";
import type { CommandContext } from "./context.ts";
import { publish, type PublishResult } from "./publish.ts";

export { CLAUDE_AUTH };

export interface LocalOptions {
  /** The host repository: the base branch comes from it and the issue branch lands in it. */
  repo: string;
  /** The feature's `issues/` directory; found under `.scratch/*\/issues/` when null. */
  issues: string | null;
  container: ContainerRunner;
  env: Record<string, string | undefined>;
}

export type LocalResult =
  | (ClaimResult & { claimed: false })
  | { triage: ApplyRun; workExitCode: number }
  | (PublishResult & { branch: string; evidence: string; workExitCode: number });

type BaseContext = Omit<CommandContext, "tracker" | "codeHost" | "agent" | "verify">;

/**
 * `pnpm factory local N`: the issue flow of the forge, run on this machine
 * against a Markdown ticket. `claim` and `publish` run here with the local
 * Tracker and CodeHost; `work` runs in a throwaway container that gets the
 * base branch as a bundle, the tickets, Claude's auth and the FACTORY_*
 * settings. The branch lands in the host repo; the review and the evidence
 * go to the ticket, prints and session streams to `.scratch/<feature>/evidence/NN/`.
 * A ticket whose Status is `agent:explore` gets the Triage instead: the
 * container runs `triage`, then `apply` runs here (comment and new Status).
 */
export async function local(base: BaseContext, number: number, options: LocalOptions): Promise<LocalResult> {
  const { config, log } = base;
  const repo = (await git(options.repo, "rev-parse", "--show-toplevel")).trim();
  const issuesDir = options.issues ?? (await findIssues(repo, number));
  const baseRef = `refs/heads/${config.baseBranch}`;
  await git(repo, "rev-parse", "--verify", "--quiet", baseRef).catch(() => {
    throw new Error(`The host repo has no branch ${config.baseBranch} to start from (set FACTORY_BASE_BRANCH).`);
  });

  const tracker = new MarkdownTracker({ dir: issuesDir, self: "factory", human: options.env.USER || "human" });
  const tmp = await mkdtemp(join(tmpdir(), `factory-local-${number}-`));
  try {
    const publishRepo = join(tmp, "publish");
    await git(tmp, "clone", "--quiet", "--no-checkout", repo, publishRepo);
    const ctx: CommandContext = {
      ...base,
      tracker,
      codeHost: new LocalCodeHost({ remote: repo, from: publishRepo, files: tracker.files, config }),
      agent: unavailable<Agent>("Agent"),
      verify: unavailable<Verify>("Verify"),
    };

    const exploring = (await tracker.issue(number)).labels.includes(config.labels.agentExplore);
    const claimed = exploring ? null : await claim(ctx, number, { event: null });
    if (claimed && !claimed.claimed) return claimed;

    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    await mkdir(inDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    await git(repo, "bundle", "create", "--quiet", join(inDir, IN_BUNDLE), baseRef);
    await copyTracker(issuesDir, join(inDir, IN_TRACKER));

    const { exitCode } = await options.container.run({
      repo,
      issue: number,
      command: exploring ? "triage" : "work",
      inDir,
      outDir,
      base: config.baseBranch,
      env: containerEnv(options.env),
    });
    if (!claimed) {
      if (exitCode !== 0) log(`factory: the triage container exited with ${exitCode}`);
      if (!(await hasTriageResult(outDir))) throw new Error("The triage container left no triage.json.");
      return { triage: await apply(ctx, { in: outDir, repo }), workExitCode: exitCode };
    }
    if (exitCode !== 0) log(`factory: the work container exited with ${exitCode}`);

    const file = await tracker.files.file(number);
    const evidence = evidenceDir(issuesDir, file.id);
    await keepSessions(join(outDir, "sessions"), join(evidence, "sessions"));

    const published = await publish(ctx, number, { repo: publishRepo, in: outDir, startSha: claimed.startSha, runUrl: null, pr: null });
    return { ...published, branch: issueBranch(config, number), evidence, workExitCode: exitCode };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Claude's auth and the FACTORY_* settings that are set; never a forge token. */
export function containerEnv(env: Record<string, string | undefined>): Record<string, string> {
  const set = Object.fromEntries(Object.entries(env).filter(([, value]) => value));
  return pick(set, [...CLAUDE_AUTH, ...configVariables()]);
}

/** `.scratch/<feature>/issues/` holding `NN-*.md` for the issue; it must be unique. */
async function findIssues(repo: string, number: number): Promise<string> {
  const scratch = join(repo, ".scratch");
  const features = await readdir(scratch, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const feature of features.filter((f) => f.isDirectory())) {
    const dir = join(scratch, feature.name, "issues");
    const names = await readdir(dir).catch(() => []);
    if (names.some((name) => Number(ISSUE_FILE.exec(name)?.[1]) === number)) found.push(dir);
  }
  if (found.length === 1) return found[0]!;
  if (found.length === 0) throw new Error(`No .scratch/*/issues/${String(number).padStart(2, "0")}-*.md in ${repo}`);
  throw new Error(`Issue #${number} exists in ${found.join(" and ")}: pick one with --issues <dir>`);
}

/** The feature's `issues/` and its top-level files (the spec), for the container's Tracker. */
async function copyTracker(issuesDir: string, to: string): Promise<void> {
  await cp(issuesDir, join(to, "issues"), { recursive: true });
  const feature = dirname(issuesDir);
  for (const entry of await readdir(feature, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) await cp(join(feature, entry.name), join(to, entry.name));
  }
}

async function keepSessions(from: string, to: string): Promise<void> {
  const files = await readdir(from).catch(() => []);
  if (files.length === 0) return;
  await mkdir(to, { recursive: true });
  for (const name of files) await cp(join(from, name), join(to, name));
}

function unavailable<T extends object>(seam: string): T {
  return new Proxy({} as T, {
    get: () => () => Promise.reject(new Error(`The ${seam} runs in the work container, not on the host.`)),
  });
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return new Git(cwd).run(...args);
}
