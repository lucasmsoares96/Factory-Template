import type { FactoryConfig } from "../config.ts";
import type { CloudflareClient, GitHubClient, NeonClient, Prompter, ResendClient } from "./clients.ts";

export interface BootstrapDeps {
  github: GitHubClient;
  /** Builds the Cloudflare client once a token is at hand. */
  cloudflare: (token: string) => CloudflareClient;
  neon: NeonClient;
  resend: ResendClient;
  prompter: Prompter;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  config: FactoryConfig;
}

/** Values held in memory for the length of one run. Nothing here reaches disk. */
export interface StepContext extends BootstrapDeps {
  memory: { cloudflareToken?: string; accountId?: string };
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
    await step.run(ctx);
  }
}
