import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { adaptersFromEnv } from "./adapters/index.ts";
import { claim } from "./commands/claim.ts";
import type { Adapters, CommandContext } from "./commands/context.ts";
import { publish } from "./commands/publish.ts";
import { work } from "./commands/work.ts";
import { loadConfig, type FactoryConfig } from "./config.ts";

export interface FactoryDeps {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  /** Built only when a command needs them; `repo` is the checkout the command works in. */
  adapters: (input: { config: FactoryConfig; repo: string }) => Adapters;
  /** Clock in milliseconds; defaults to `Date.now`. */
  now?: () => number;
}

const USAGE = `Usage: pnpm factory <command> [options]

Commands:
  claim <issue> [--event <name>]         Guard the issue and take the lock (ready-for-agent → in-progress).
                                         --event labeled: explain a Blocked Issue with one "Waiting on" comment.
  work <issue> --out <dir> [--repo <dir>]
                                         Run Development → Review → E2E; write result.json, the branch bundle and the prints.
  publish <issue> --in <dir> [--repo <dir>] [--start-sha <sha>] [--run-url <url>] [--pr <n>]
                                         Re-check the forge, validate result.json, push with a lease, then open the
                                         PR with review and evidence, or escalate. --pr: the run continues PR <n>.
  help                                   Show this message.

Settings come from .factory/src/config.ts and FACTORY_* variables.`;

/** Entry point of every command; returns the process exit code. Each command prints one JSON line. */
export async function runFactory(argv: string[], deps: FactoryDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    deps.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (!["claim", "work", "publish"].includes(command)) {
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
    },
  });
  const issue = parseIssue(positionals[0]);
  const config = loadConfig(deps.env);
  const summaryFile = deps.env.GITHUB_STEP_SUMMARY;
  const ctx: CommandContext = {
    ...deps.adapters({ config, repo: values.repo }),
    config,
    log: deps.log,
    now: deps.now ?? Date.now,
    stepSummary: async (markdown) => {
      if (summaryFile) await appendFile(summaryFile, `${markdown}\n`);
    },
  };

  switch (command) {
    case "claim":
      deps.log(JSON.stringify(await claim(ctx, issue, { event: values.event ?? null })));
      return 0;
    case "work": {
      const result = await work(ctx, issue, { repo: values.repo, out: required(values.out, "--out") });
      deps.log(JSON.stringify({ issue, outcome: result.outcome, reason: result.reason, attempts: result.attempts.length }));
      return 0;
    }
    default: {
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
