import type { FactoryConfig } from "../config.ts";
import type { AccountsClient, CloudflareClient, GitHubClient, NeonClient, Prompter, ResendClient } from "./clients.ts";

/** The part of a Product's identity (ticket 07) the wizard reads; it never rewrites the file. */
export interface ProductIdentity {
  id: string;
  title: string;
  emailFrom: string;
  /** Empty until the person sets it in `product.config.ts`. */
  domain: string;
}

export interface BootstrapDeps {
  github: GitHubClient;
  /** Builds the Cloudflare client once a token is at hand. */
  cloudflare: (token: string) => CloudflareClient;
  /** Builds a Neon client: with the API key of the environment, or without one (then `login()` opens the browser). */
  neon: (options: { apiKey?: string }) => NeonClient;
  /** The production database, for the accounts the Production module creates. */
  accounts: AccountsClient;
  /** Builds the Resend client once a key is at hand. */
  resend: (key: string) => ResendClient;
  /** Reads `apps/<id>/product.config.ts`. */
  product: (id: string) => Promise<ProductIdentity>;
  sleep: (ms: number) => Promise<void>;
  prompter: Prompter;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  config: FactoryConfig;
  /** A person can answer prompts (stdin is a TTY). Unset means no: CI and agents never get asked. */
  interactive?: boolean;
}

/** Values held in memory for the length of one run. Nothing here reaches disk. */
export interface StepContext extends BootstrapDeps {
  /** The steps named by `--redo` in this run (set by `runSteps`). */
  redo?: string[];
  memory: { cloudflareToken?: string; accountId?: string; resendKey?: string; resendDeferred?: boolean; neon?: NeonClient; neonOrg?: { id?: string }; databaseUrl?: string };
}

export interface Step {
  id: string;
  title: string;
  /** Reads the current state; a step that is `done` is skipped. */
  check(ctx: StepContext): Promise<{ done: boolean; detail?: string }>;
  run(ctx: StepContext): Promise<void>;
}

/** Runs each step whose state is not done, plus every step named by `redo`. No local state is kept. */
export async function runSteps(steps: Step[], ctx: StepContext, redo: string[]): Promise<void> {
  const known = steps.map((s) => s.id);
  const unknown = redo.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new Error(`Unknown step: ${unknown.join(", ")}. Steps: ${known.join(", ")}.`);

  for (const step of steps) {
    const state = await step.check(ctx);
    if (state.done && !redo.includes(step.id)) {
      ctx.log(`- ${step.title}: already done${state.detail ? ` (${state.detail})` : ""}`);
      continue;
    }
    ctx.log(`- ${step.title}: ${redo.includes(step.id) ? "redoing" : "running"}`);
    await step.run({ ...ctx, redo });
  }
}
