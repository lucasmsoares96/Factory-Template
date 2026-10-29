import type { Prompter } from "./clients.ts";

export type Module = "common" | "domain" | "product" | "previews" | "billing" | "factory";

/**
 * - `required`: without a terminal the run cannot go on without it (checked before the first step, when its step has work).
 * - `conditional`: asked only in some situations (several Neon orgs, a Product without a domain); asked without it, the run stops naming the variable.
 * - `optional`: the code skips or defers the question without a terminal, or `default` answers it.
 * - `terminal`: a question for a person only (a confirmation, a choice); no variable answers it.
 */
type Kind = "required" | "conditional" | "optional" | "terminal";

export interface Question {
  /** The environment variable that answers the question when nobody can; `null` for a `terminal` question. */
  env: string | null;
  purpose: string;
  module: Module;
  kind: Kind;
  /** The answer without a terminal and without the variable. */
  default?: string;
  /** Only the first ask of a run takes the variable; a loop that asks again gets the default (or an empty answer). */
  once?: true;
}

const q = (module: Module, kind: Kind, env: string | null, purpose: string, extra: Pick<Question, "default" | "once"> = {}): Question => ({ module, kind, env, purpose, ...extra });
const terminal = (module: Module, purpose: string) => q(module, "terminal", null, purpose);

/**
 * Every question the wizard asks, by id: the one declaration behind the prompts, `pnpm bootstrap env` and the check that
 * runs before the first step without a terminal. The `Prompter` takes only these ids, and a test keeps every one of
 * them tied to a variable (or to a terminal).
 */
export const QUESTIONS = {
  "repo-confirm": terminal("common", "Confirm the repository to set up"),
  "install-gh": terminal("common", "Install the GitHub CLI"),
  "login-gh": terminal("common", "Sign in to the GitHub CLI"),
  "cloudflare-token": q("common", "required", "CLOUDFLARE_API_TOKEN", "Cloudflare API token (stored as a secret); not needed once the secret exists"),
  "cloudflare-account": q("common", "conditional", "CLOUDFLARE_ACCOUNT_ID", "Cloudflare account, when the credential sees more than one"),
  "workers-dev-subdomain": q("common", "required", "WORKERS_DEV_SUBDOMAIN", "workers.dev subdomain of the account; not needed once it exists"),
  "factory-language": q("common", "required", "FACTORY_LANGUAGE", "Language of the Factory's public text (en or pt-BR); not needed once the variable exists"),
  "product-domain": q("domain", "conditional", "PRODUCT_DOMAIN", "Domain of a Product whose product.config.ts has none"),
  "resend-setup": terminal("domain", "Whether to set Resend up now"),
  "resend-key": q("domain", "optional", "RESEND_API_KEY", "Full-access Resend key, used for this run only; without it Resend is deferred"),
  "neon-org": q("product", "conditional", "NEON_ORG_ID", "Neon organization, when the login sees more than one"),
  "neon-project-pick": q("product", "conditional", "NEON_PROJECT_ID", "Neon project, when several have the Product's name"),
  "default-account-email": q("product", "required", "DEFAULT_ACCOUNT_EMAIL", "Email of the Product's default account; not needed once the account exists"),
  "default-account-password": q("product", "required", "DEFAULT_ACCOUNT_PASSWORD", "Password of the default account (stored as a secret); not needed once the account exists"),
  "default-account-password-confirm": q("product", "required", "DEFAULT_ACCOUNT_PASSWORD", "The same password, typed again"),
  "preview-neon-key": q("previews", "optional", "PREVIEW_NEON_API_KEY", "Neon API key limited to the preview project, when Neon will not mint one; without it previews stay off"),
  "preview-account-password": q("previews", "optional", "PREVIEW_ACCOUNT_PASSWORD", "Password of the default account in the previews (different from production); without it the step is skipped"),
  "preview-account-password-confirm": q("previews", "optional", "PREVIEW_ACCOUNT_PASSWORD", "The same password, typed again"),
  "stripe-sandbox-key": q("billing", "required", "STRIPE_SANDBOX_KEY", "Restricted key of the Stripe sandbox that Previews use"),
  "stripe-live-key": q("billing", "required", "STRIPE_LIVE_KEY", "Restricted key of the real Stripe account"),
  "stripe-sandbox-key-check": terminal("billing", "Stripe sandbox key to check billing in the doctor"),
  "stripe-live-key-check": terminal("billing", "Stripe live key to check billing in the doctor"),
  "billing-currency": q("billing", "required", "BILLING_CURRENCY", "Currency of the prices (ISO code, e.g. usd); not needed once the plans are recorded"),
  "billing-fixed-name": q("billing", "optional", "BILLING_FIXED_PLAN_NAME", "Name of one fixed plan; empty means none", { default: "", once: true }),
  "billing-fixed-seats": q("billing", "optional", "BILLING_FIXED_PLAN_SEATS", "Seats of the fixed plan", { default: "1" }),
  "billing-fixed-price": q("billing", "optional", "BILLING_FIXED_PLAN_PRICE", "Monthly price of the fixed plan", { default: "1" }),
  "billing-per-seat-price": q("billing", "optional", "BILLING_PER_SEAT_PRICE", "Monthly price per Seat of the per-Seat plan; empty means none", { default: "" }),
  "billing-free": q("billing", "optional", "BILLING_FREE_PLAN", "Whether there is a Free plan (true or false)", { default: "true" }),
  "billing-annual": q("billing", "optional", "BILLING_ANNUAL", "Whether the paid plans are sold yearly too (true or false)", { default: "false" }),
  "billing-annual-discount": q("billing", "optional", "BILLING_ANNUAL_DISCOUNT", "Discount of the yearly price, in percent", { default: "0" }),
  "billing-trial-days": q("billing", "optional", "BILLING_TRIAL_DAYS", "Days of free trial on the paid plans", { default: "0" }),
  "billing-setup": terminal("billing", "Whether to set billing up after the Production module"),
  "factory-token": q("factory", "required", "FACTORY_TOKEN", "Fine-grained token limited to this repository (stored as a secret); not needed once the secret exists"),
  "merge-mode": q("factory", "optional", "FACTORY_MERGE_MODE", "Merge Mode (human, safe or all)", { default: "human" }),
  "merge-mode-confirm": terminal("factory", "Typed confirmation of the Merge Mode all"),
  "example-issue": terminal("factory", "Whether to run the example issue"),
  "example-product": terminal("factory", "Which Product the example changes"),
  "example-delete": terminal("factory", "What happens to the example"),
  "destroy-confirm": terminal("common", "Typed confirmation of destroy"),
} as const satisfies Record<string, Question>;

export type QuestionId = keyof typeof QUESTIONS;

/** Variables the steps read that no question carries (they never prompt). Listed by `pnpm bootstrap env` with their module. */
const READS: { module: Module; env: string; purpose: string }[] = [
  { module: "product", env: "NEON_API_KEY", purpose: "Neon API key; without it neonctl signs in through the browser" },
  { module: "previews", env: "NEON_API_KEY", purpose: "Neon API key; without it neonctl signs in through the browser" },
  { module: "factory", env: "CLAUDE_CODE_OAUTH_TOKEN", purpose: "Claude's OAuth token (or ANTHROPIC_API_KEY, or an existing secret)" },
  { module: "factory", env: "ANTHROPIC_API_KEY", purpose: "Claude's API key, when there is no OAuth token" },
];

/** What `pnpm bootstrap env` prints for some modules: each variable once, with its purpose and whether it is required. */
export function describeVariables(modules: Module[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (env: string, purpose: string, note: string) => {
    if (seen.has(env)) return;
    seen.add(env);
    lines.push(`  ${env}  ${purpose}${note}`);
  };
  for (const module of modules) {
    for (const question of Object.values<Question>(QUESTIONS)) {
      if (question.module !== module || question.env === null) continue;
      const note = question.kind === "required" ? " (required without a terminal)" : question.default !== undefined ? ` (optional, default ${question.default === "" ? "none" : question.default})` : question.kind === "conditional" ? " (only if asked)" : " (optional)";
      add(question.env, question.purpose, note);
    }
    for (const read of READS) if (read.module === module) add(read.env, read.purpose, " (optional)");
  }
  return lines;
}

/** The variables that answer the questions of `ids` and are neither set nor defaulted: what a run without a terminal lacks. */
export function missingVariables(ids: QuestionId[], env: Record<string, string | undefined>): { env: string; purpose: string }[] {
  const missing = new Map<string, string>();
  for (const id of ids) {
    const question: Question = QUESTIONS[id];
    if (question.kind !== "required" || question.env === null || question.default !== undefined) continue;
    if (!env[question.env]) missing.set(question.env, question.purpose);
  }
  return [...missing].map(([name, purpose]) => ({ env: name, purpose }));
}

/** Thrown before the first step of a run without a terminal when variables are missing: it lists all of them. */
export class MissingVariables extends Error {
  readonly variables: { env: string; purpose: string }[];
  constructor(variables: { env: string; purpose: string }[]) {
    super(`No terminal to ask, and these environment variables are not set:\n${variables.map((v) => `  ${v.env}  ${v.purpose}`).join("\n")}\nSet them and run again (\`pnpm bootstrap env\` lists them all).`);
    this.variables = variables;
  }
}

const YES = new Set(["true", "yes", "y", "1"]);
const NO = new Set(["false", "no", "n", "0"]);

/**
 * The prompter of a run without a terminal: each question is answered by its variable (or its default), never by a person.
 * A question with neither stops the run naming the variable; one that only a person can answer says so.
 */
export function envPrompter(inner: Prompter, env: Record<string, string | undefined>): Prompter {
  const taken = new Set<QuestionId>();
  const answer = (id: QuestionId): string => {
    const question: Question = QUESTIONS[id];
    if (question.env === null) throw new Error(`"${question.purpose}" needs a terminal, and there is none.`);
    const value = taken.has(id) && question.once ? undefined : env[question.env] || undefined;
    taken.add(id);
    if (value !== undefined) return value;
    if (question.default !== undefined) return question.default;
    throw new MissingVariables([{ env: question.env, purpose: question.purpose }]);
  };
  const pick = <T extends string>(id: QuestionId, options: { value: T }[]): T | undefined => {
    const value = answer(id);
    const found = options.find((o) => o.value === value);
    if (!found) throw new Error(`${QUESTIONS[id].env}=${value} is not one of ${options.map((o) => o.value).join(", ")}.`);
    return found.value;
  };
  return {
    note: (message) => inner.note(message),
    link: (message, url) => inner.link(message, url),
    spinner: (message) => inner.spinner(message),
    text: async ({ id }) => answer(id),
    password: async ({ id }) => answer(id),
    select: async ({ id, options }) => pick(id, options) as never,
    choose: async ({ id, options, onCancel }) => (pick(id, options) ?? onCancel) as never,
    confirm: async ({ id }) => {
      const value = answer(id).toLowerCase();
      if (YES.has(value)) return true;
      if (NO.has(value)) return false;
      throw new Error(`${QUESTIONS[id].env}=${value} is not true or false.`);
    },
  };
}
