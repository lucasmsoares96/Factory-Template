import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { adaptersFromEnv } from "./adapters/index.ts";
import { claim } from "./commands/claim.ts";
import type { Adapters, CommandContext } from "./commands/context.ts";
import { CLAUDE_AUTH, local } from "./commands/local.ts";
import { claimPrFeedback, claimUpdateBranch, scanBranches, type PrClaim } from "./commands/pr-claim.ts";
import { publish } from "./commands/publish.ts";
import { resolveBase, work, type WorkFlow } from "./commands/work.ts";
import { Git } from "./git.ts";
import { loadConfig, type FactoryConfig } from "./config.ts";
import { DockerContainerRunner, type ContainerRunner } from "./local/container.ts";
import { dockerCli } from "./local/docker.ts";

export interface FactoryDeps {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  /** Built only when a command needs them; `repo` is the checkout the command works in. */
  adapters: (input: { config: FactoryConfig; repo: string }) => Adapters;
  /** Clock in milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Where `local` runs the work job; defaults to a Docker container. */
  container?: (config: FactoryConfig) => ContainerRunner;
}

const USAGE = `Usage: pnpm factory <command> [options]

Commands:
  claim <issue> [--event <name>]         Guard the issue and take the lock (ready-for-agent → in-progress).
                                         --event labeled: explain a Blocked Issue with one "Waiting on" comment.
  work <issue> --out <dir> [--repo <dir>] [--flow pr-feedback|update-branch --pr <n>]
                                         Run Development → Review → E2E; write result.json, the branch bundle and the prints.
                                         --flow: continue the branch of PR <n> (merge the base branch first).
  pr-feedback --pr <n> --actor <login>   Guard a comment on a Factory PR (writer, not the machine user, factory/issue-N,
                                         open threads) and print the claim; the pr-feedback workflow then runs work and publish.
  update-branch <issue>                  Guard an update of the Factory branch of an issue (in-progress, open PR).
  update-branch --scan [--repo <dir>]    After a push to the base branch: dispatch update-branch for each Factory PR that
                                         now conflicts with it (git merge-tree).
  publish <issue> --in <dir> [--repo <dir>] [--start-sha <sha>] [--run-url <url>] [--pr <n>]
                                         Re-check the forge, validate result.json, push with a lease, then open the
                                         PR with review and evidence, or escalate. --pr: the run continues PR <n>.
  local <issue> [--issues <dir>] [--repo <dir>]
                                         The issue flow on this machine for a Markdown ticket
                                         (.scratch/<feature>/issues/NN-*.md): claim and publish here, work in a
                                         throwaway Docker container. Needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.
  help                                   Show this message.

Settings come from .factory/src/config.ts and FACTORY_* variables.`;

/** Entry point of every command; returns the process exit code. Each command prints one JSON line. */
export async function runFactory(argv: string[], deps: FactoryDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    deps.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (!["claim", "work", "publish", "local", "pr-feedback", "update-branch"].includes(command)) {
    deps.log(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  const { positionals, values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      repo: { type: "string", default: process.cwd() },
      out: { type: "string" },
      in: { type: "string" },
      "start-sha": { type: "string" },
      event: { type: "string" },
      "run-url": { type: "string" },
      pr: { type: "string" },
      issues: { type: "string" },
      actor: { type: "string" },
      flow: { type: "string" },
      scan: { type: "boolean" },
    },
  });
  // Parsed on use: `pr-feedback` and `update-branch --scan` take no issue.
  const issueArg = () => parseIssue(positionals[0]);
  const summaryFile = deps.env.GITHUB_STEP_SUMMARY;
  const base = (config: FactoryConfig) => ({
    config,
    log: deps.log,
    now: deps.now ?? Date.now,
    stepSummary: async (markdown: string) => {
      if (summaryFile) await appendFile(summaryFile, `${markdown}\n`);
    },
  });

  if (command === "local") {
    if (!CLAUDE_AUTH.some((key) => deps.env[key])) {
      throw new Error("`factory local` needs Claude's auth: set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY.");
    }
    // Locally the Factory writes as `factory` unless a machine user is set.
    const env = { ...deps.env, FACTORY_MACHINE_USER: deps.env.FACTORY_MACHINE_USER || "factory" };
    const config = loadConfig(env);
    const container = deps.container?.(config) ?? new DockerContainerRunner({ docker: dockerCli, config, log: deps.log });
    const result = await local(base(config), issueArg(), { repo: values.repo, issues: values.issues ?? null, container, env });
    deps.log(JSON.stringify(result));
    return 0;
  }

  const config = loadConfig(deps.env);
  const ctx: CommandContext = { ...deps.adapters({ config, repo: values.repo }), ...base(config) };

  const writeOutputs = async (claim: PrClaim) => {
    if (!deps.env.GITHUB_OUTPUT) return;
    const lines = claim.claimed
      ? [`claimed=true`, `issue=${claim.issue}`, `pr=${claim.pr}`, `branch=${claim.branch}`, `start_sha=${claim.startSha}`]
      : [`claimed=false`, `reason=${claim.reason}`];
    await appendFile(deps.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  };

  switch (command) {
    case "pr-feedback": {
      const claim = await claimPrFeedback(ctx, { pr: parseIssue(values.pr), actor: values.actor ?? "" });
      deps.log(JSON.stringify(claim));
      await writeOutputs(claim);
      return 0;
    }
    case "update-branch": {
      if (values.scan) {
        const git = new Git(values.repo);
        const result = await scanBranches(ctx, git, await resolveBase(git, config.baseBranch));
        deps.log(JSON.stringify(result));
        return 0;
      }
      const claim = await claimUpdateBranch(ctx, issueArg());
      deps.log(JSON.stringify(claim));
      await writeOutputs(claim);
      return 0;
    }
    case "claim": {
      const result = await claim(ctx, issueArg(), { event: values.event ?? null });
      deps.log(JSON.stringify(result));
      // The workflow reads these to decide whether `work` and `publish` run, and where the lease starts.
      if (deps.env.GITHUB_OUTPUT) {
        const lines = [`claimed=${result.claimed}`];
        if (result.claimed) lines.push(`start_sha=${result.startSha ?? ""}`, `branch=${result.branch}`);
        else lines.push(`reason=${result.reason}`);
        await appendFile(deps.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
      }
      return 0;
    }
    case "work": {
      const issue = issueArg();
      const result = await work(ctx, issue, { repo: values.repo, out: required(values.out, "--out"), ...(flowOf(values) ? { flow: flowOf(values)! } : {}) });
      deps.log(JSON.stringify({ issue, outcome: result.outcome, reason: result.reason, attempts: result.attempts.length }));
      return 0;
    }
    default: {
      const issue = issueArg();
      const result = await publish(ctx, issue, {
        repo: values.repo,
        in: required(values.in, "--in"),
        startSha: values["start-sha"] || null,
        runUrl: values["run-url"] || runUrlFromEnv(deps.env),
        pr: values.pr ? parseIssue(values.pr) : null,
      });
      deps.log(JSON.stringify(result));
      return 0;
    }
  }
}

/** `--flow pr-feedback|update-branch` with the PR it continues; undefined for the issue flow. */
function flowOf(values: { flow?: string; pr?: string }): WorkFlow | undefined {
  if (values.flow === undefined) return undefined;
  if (values.flow !== "pr-feedback" && values.flow !== "update-branch") throw new Error(`Unknown --flow: ${values.flow}. Known: pr-feedback, update-branch.`);
  return { kind: values.flow, pr: parseIssue(values.pr) };
}

function parseIssue(value: string | undefined): number {
  const issue = Number(value);
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`Expected an issue number, got: ${value ?? "nothing"}`);
  return issue;
}

/** The Actions run link, from the default variables of a GitHub or Forgejo runner. */
function runUrlFromEnv(env: Record<string, string | undefined>): string | null {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = env;
  return server && repo && run ? `${server}/${repo}/actions/runs/${run}` : null;
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`Missing ${flag}`);
  return value;
}

if (import.meta.main) {
  const env = process.env;
  try {
    process.exitCode = await runFactory(process.argv.slice(2), {
      env,
      log: (line) => console.log(line),
      adapters: (input) => adaptersFromEnv(env, input),
    });
  } catch (error) {
    console.error(`factory: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
