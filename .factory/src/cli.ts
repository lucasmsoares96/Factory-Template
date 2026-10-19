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
}

const USAGE = `Usage: pnpm factory <command> [options]

Commands:
  claim <issue>                          Guard the issue and take the lock (ready-for-agent → in-progress).
  work <issue> --out <dir> [--repo <dir>]
                                         Run Development → Review → E2E; write result.json, the branch bundle and the prints.
  publish <issue> --in <dir> [--repo <dir>] [--start-sha <sha>]
                                         Validate result.json, push, open the PR, review, post evidence, mark ready.
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
    },
  });
  const issue = parseIssue(positionals[0]);
  const config = loadConfig(deps.env);
  const ctx: CommandContext = { ...deps.adapters({ config, repo: values.repo }), config, log: deps.log };

  switch (command) {
    case "claim":
      deps.log(JSON.stringify(await claim(ctx, issue)));
      return 0;
    case "work": {
      const result = await work(ctx, issue, { repo: values.repo, out: required(values.out, "--out") });
      deps.log(JSON.stringify({ issue, outcome: result.outcome, reason: result.reason, attempts: result.attempts.length }));
      return 0;
    }
    default: {
      const startSha = values["start-sha"] || null;
      deps.log(JSON.stringify(await publish(ctx, issue, { repo: values.repo, in: required(values.in, "--in"), startSha })));
      return 0;
    }
  }
}

function parseIssue(value: string | undefined): number {
  const issue = Number(value);
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`Expected an issue number, got: ${value ?? "nothing"}`);
  return issue;
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
