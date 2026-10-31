import type { FactoryConfig } from "../config.ts";
import { missingVariables, MissingVariables, type QuestionId } from "./questions.ts";
import type { AccountsClient, CloudflareClient, GitHubClient, NeonClient, Prompter, ResendClient, StripeClient, TokenClient, ToolsClient, WranglerAuth } from "./clients.ts";

/** The part of a Product's identity (ticket 07) the wizard reads; it never rewrites the file. */
export interface ProductIdentity {
  id: string;
  title: string;
  emailFrom: string;
  /** Empty until the person sets it in `product.config.ts`. */
  domain: string;
  /** The Product lists the billing Feature in `src/features/index.ts` (unset: unknown, as in a fake). */
  billing?: boolean;
  /** The Entitlements the Product's `billing({ entitlements })` declares (unset: none known). */
  entitlements?: string[];
}

export interface BootstrapDeps {
  github: GitHubClient;
  /** Node, pnpm and `gh` on this machine, checked before any step. */
  tools: ToolsClient;
  /** Builds the Cloudflare client once a token is at hand. */
  cloudflare: (token: string) => CloudflareClient;
  /** wrangler's saved login: the Cloudflare credential on this machine once the CI secret is set. */
  wrangler: WranglerAuth;
  /** Builds a Neon client: with the API key of the environment, or without one (then `login()` opens the browser). */
  neon: (options: { apiKey?: string }) => NeonClient;
  /** The production database, for the accounts the Production module creates. */
  accounts: AccountsClient;
  /** Builds the Resend client once a key is at hand. */
  resend: (key: string) => ResendClient;
  /** Builds the Stripe client once a key is at hand. */
  stripe: (key: string) => StripeClient;
  /** Builds the client of the owner's fine-grained token once it is at hand. */
  token: (token: string) => TokenClient;
  /** Reads `apps/<id>/product.config.ts`. */
  product: (id: string) => Promise<ProductIdentity>;
  /** The ids of the Products in `apps/`, sorted. */
  listProducts: () => Promise<string[]>;
  /** `owner/name` of the `origin` remote of the clone, `undefined` when there is none. */
  origin?: () => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
  prompter: Prompter;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  config: FactoryConfig;
  /** A person can answer prompts (stdin is a TTY). Unset means no: CI and agents never get asked. */
  interactive?: boolean;
  /** The example issue of `bootstrap factory`: poll interval and timeout (ms; defaults 30 s and 40 min) and the Ctrl-C hook. */
  example?: {
    pollMs?: number;
    timeoutMs?: number;
    /** Aborted by the first Ctrl-C while `hold(true)` is on: the flow then cleans up instead of the process exiting. */
    interrupt?: { signal: AbortSignal; hold(on: boolean): void };
  };
}

/** Values held in memory for the length of one run. Nothing here reaches disk. */
export interface StepContext extends BootstrapDeps {
  /** The steps named by `--redo` in this run (set by `runSteps`). */
  redo?: string[];
  memory: { cloudflareToken?: string; accountId?: string; resendKey?: string; resendDeferred?: boolean; stripeKeys?: { sandbox?: string; live?: string; ci?: string }; noWranglerLogin?: boolean; neon?: NeonClient; neonOrg?: { id?: string }; databaseUrl?: string; neonKeyDeclined?: boolean; previewProject?: Record<string, string> };
}

export interface Step {
  id: string;
  title: string;
  /** The required questions `run` may ask. Without a terminal, the run checks their variables before the first step. */
  asks?: QuestionId[] | ((ctx: StepContext) => Promise<QuestionId[]>);
  /** Whether `run` will ask them, when that is not simply "the step is not done". */
  needs?(ctx: StepContext): Promise<boolean>;
  /** Reads the current state; a step that is `done` is skipped. */
  check(ctx: StepContext): Promise<{ done: boolean; detail?: string }>;
  run(ctx: StepContext): Promise<void>;
}

/** Runs each step whose state is not done, plus every step named by `redo`. No local state is kept. */
export async function runSteps(steps: Step[], ctx: StepContext, redo: string[]): Promise<void> {
  const known = steps.map((s) => s.id);
  const unknown = redo.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new Error(`Unknown step: ${unknown.join(", ")}. Steps: ${known.join(", ")}.`);

  if (ctx.interactive === false) await requireVariables(steps, ctx, redo);

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

/**
 * Without a terminal, before the first step: every variable that the steps with work will need and the environment lacks.
 * A step has work when it is not done or is named by `redo`; the failure lists all the missing variables, not the first.
 */
async function requireVariables(steps: Step[], ctx: StepContext, redo: string[]): Promise<void> {
  const ids: QuestionId[] = [];
  for (const step of steps) {
    if (!step.asks) continue;
    if (redo.includes(step.id) || (step.needs ? await step.needs({ ...ctx, redo }) : !(await step.check({ ...ctx, redo })).done)) ids.push(...(typeof step.asks === "function" ? await step.asks({ ...ctx, redo }) : step.asks));
  }
  const missing = missingVariables(ids, ctx.env);
  if (missing.length > 0) throw new MissingVariables(missing);
}
