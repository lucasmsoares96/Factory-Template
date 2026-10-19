import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { CloudflareApi } from "./cloudflare.ts";
import { commonSteps } from "./common.ts";
import { doctor, formatReport } from "./doctor.ts";
import { GhCli } from "./github.ts";
import { clackPrompter } from "./prompter.ts";
import { NeonCli, ResendApi } from "./services.ts";
import { runSteps, type BootstrapDeps } from "./steps.ts";

export type { BootstrapDeps } from "./steps.ts";

const USAGE = `Usage: pnpm bootstrap [command] [options]

Commands:
  (none)                 Set up the common part: Cloudflare token and account, workers.dev, labels.
                         Looks at the current state and skips what already exists, so it is safe to rerun.
  doctor                 Read-only check of secrets, variables, labels and resources; shows what is switched off.
  help                   Show this message.

Options:
  --redo <step>          Redo one step even if it looks done (repeatable): cloudflare-token, workers-dev, labels.

Run \`pnpm bootstrap doctor\` after the wizard and whenever something looks off.
Only \`gh\` (logged in with \`gh auth login\`) must be installed. Nothing is written to disk, secrets included.`;

/** Entry point; returns the process exit code. */
export async function runBootstrap(argv: string[], deps: BootstrapDeps): Promise<number> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { redo: { type: "string", multiple: true } } });
  const [command] = positionals;

  if (command === "help") {
    deps.log(USAGE);
    return 0;
  }
  if (command === "doctor") {
    const report = await doctor(deps);
    deps.log(formatReport(report));
    return report.ok ? 0 : 1;
  }
  if (command !== undefined) {
    deps.log(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  await runSteps(commonSteps, { ...deps, memory: {} }, values.redo ?? []);
  deps.log("Common part done. Run `pnpm bootstrap doctor` to check it.");
  return 0;
}

if (import.meta.main) {
  const env = process.env;
  try {
    process.exitCode = await runBootstrap(process.argv.slice(2), {
      github: new GhCli(),
      cloudflare: (token) => new CloudflareApi(token),
      neon: new NeonCli(env),
      resend: new ResendApi(env.RESEND_API_KEY ?? ""),
      prompter: clackPrompter,
      env,
      log: (line) => console.log(line),
      config: loadConfig(env),
    });
  } catch (error) {
    console.error(`bootstrap: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
