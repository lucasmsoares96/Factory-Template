import { z } from "zod";
import type { StripeClient, StripePlanSpec } from "./clients.ts";
import { entitlementMetadata, missingEntitlements, type EntitlementValue } from "./entitlements.ts";
import { keyCreationUrl, keyMode, type KeyMode } from "./billing-permissions.ts";
import { productionEnvironment, productSecretName, secretScope } from "./domain.ts";
import { previewScope } from "./previews.ts";
import type { QuestionId } from "./questions.ts";
import type { ProductIdentity, Step, StepContext } from "./steps.ts";

/** Where the Worker's billing answers Stripe's events (the Better Auth Stripe plugin's route). */
export const WEBHOOK_PATH = "/api/auth/stripe/webhook";

const ENV_KEYS = { sandbox: "STRIPE_SANDBOX_KEY", live: "STRIPE_LIVE_KEY" } as const;
const KEY_TRIES = 3;

/** The secrets and variables billing records for a Product, all with the `<ID>_` prefix. */
export function billingNames(productId: string) {
  return {
    /** Secret in the production environment: the real account's key, which the Worker and the bootstrap both use. */
    liveKey: productSecretName(productId, "STRIPE_SECRET_KEY"),
    /** Secret in the preview environment: the sandbox's key. */
    sandboxKey: productSecretName(productId, "PREVIEW_STRIPE_SECRET_KEY"),
    /** Secret in the production environment: the signing secret of the events endpoint. */
    webhookSecret: productSecretName(productId, "STRIPE_WEBHOOK_SECRET"),
    /** Variable: what the person answered about the plans (no secret in it), so a rerun asks nothing. */
    plans: productSecretName(productId, "BILLING_PLANS"),
    /** Variable: set once the plans, payment methods and portal are written in both accounts. */
    synced: productSecretName(productId, "BILLING_SYNCED"),
  };
}

export const webhookUrl = (product: ProductIdentity) => `https://${product.domain}${WEBHOOK_PATH}`;

/** What `pnpm bootstrap env <id>` adds for billing after the variables it reads: what the module records on the forge. */
export function billingRecorded(productId: string): string[] {
  const names = billingNames(productId);
  return [
    `Secrets recorded (${productionEnvironment(productId)} unless noted):`,
    `  ${names.liveKey}`,
    `  ${names.webhookSecret}`,
    `  ${names.sandboxKey}  (in the ${productId}-preview environment)`,
    "Variables recorded:",
    `  ${names.plans}  the answers about the plans`,
    `  ${names.synced}  the plans are written in both accounts`,
  ];
}

const Answers = z.object({
  currency: z.string(),
  fixed: z.array(z.object({ name: z.string(), seats: z.number(), amount: z.number() })),
  perSeat: z.number().nullable(),
  free: z.boolean(),
  annual: z.boolean(),
  discount: z.number(),
  trialDays: z.number(),
  /** What each plan (by key) grants, by Entitlement name. A record made before Entitlements existed has none. */
  entitlements: z.record(z.string(), z.record(z.string(), z.union([z.boolean(), z.number()]))).default({}),
});
export type BillingAnswers = z.infer<typeof Answers>;

const slug = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The plans as Stripe gets them. A per-Seat plan sells at least one Seat more than the biggest fixed plan gives (its minimum). */
export function planSpecs(productId: string, answers: BillingAnswers): StripePlanSpec[] {
  const { currency, trialDays } = answers;
  const prices = (key: string, monthly: number) => [
    { lookupKey: `${productId}_${key}_monthly`, amount: monthly, interval: "month" as const },
    ...(answers.annual ? [{ lookupKey: `${productId}_${key}_yearly`, amount: Math.round((monthly * 12 * (100 - answers.discount)) / 100), interval: "year" as const }] : []),
  ];
  const specs: StripePlanSpec[] = [];
  if (answers.free) specs.push({ key: "free", name: "Free", kind: "free", seats: 1, trialDays: 0, currency, prices: [] });
  for (const plan of answers.fixed) {
    const key = slug(plan.name);
    specs.push({ key, name: plan.name, kind: "fixed", seats: plan.seats, trialDays, currency, prices: prices(key, plan.amount) });
  }
  if (answers.perSeat !== null) {
    const minSeats = Math.max(0, ...answers.fixed.map((plan) => plan.seats)) + 1;
    specs.push({ key: "per-seat", name: "Per Seat", kind: "per_seat", seats: null, minSeats, trialDays, currency, prices: prices("per-seat", answers.perSeat) });
  }
  return specs;
}

function fractionDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2;
}

type Parsed<T> = { value: T } | { error: string };

async function ask<T>(ctx: StepContext, id: QuestionId, message: string, parse: (answer: string) => Parsed<T>): Promise<T> {
  for (let attempt = 1; attempt <= KEY_TRIES; attempt++) {
    const parsed = parse((await ctx.prompter.text({ id, message })).trim());
    if ("value" in parsed) return parsed.value;
    ctx.log(`  ${parsed.error}`);
  }
  throw new Error(`No valid answer to "${message}" after ${KEY_TRIES} tries.`);
}

const number = (min: number, whole: boolean, what: string) => (answer: string): Parsed<number> => {
  const value = Number(answer.replace(",", "."));
  return answer !== "" && Number.isFinite(value) && value >= min && (!whole || Number.isInteger(value)) ? { value } : { error: `${what} must be ${whole ? "a whole number" : "a number"} of at least ${min}.` };
};

/** The questions of the module, in the order of the issue. Nothing is stored here: the caller records the answers. */
export async function askAnswers(ctx: StepContext): Promise<BillingAnswers> {
  const currency = await ask<string>(ctx, "billing-currency", "Currency of the prices (ISO code, e.g. usd, brl, eur)", (answer) => (/^[a-z]{3}$/i.test(answer) ? { value: answer.toLowerCase() } : { error: "Use a three-letter ISO currency code." }));
  const digits = fractionDigits(currency);
  const toMinor = (major: number) => Math.round(major * 10 ** digits);
  const fixed: BillingAnswers["fixed"] = [];
  for (;;) {
    const name = (await ctx.prompter.text({ id: "billing-fixed-name", message: "Name of a fixed plan (a set number of Seats for a monthly price; empty = no more)" })).trim();
    if (!name) break;
    if (!slug(name) || ["free", "per-seat"].includes(slug(name)) || fixed.some((plan) => slug(plan.name) === slug(name))) {
      ctx.log(`  "${name}" is empty or already a plan name.`);
      continue;
    }
    const seats = await ask(ctx, "billing-fixed-seats", `Seats of ${name}`, number(1, true, "Seats"));
    const price = await ask(ctx, "billing-fixed-price", `Monthly price of ${name} in ${currency.toUpperCase()}`, number(0.01, false, "The price"));
    fixed.push({ name, seats, amount: toMinor(price) });
  }
  const perSeatAnswer = (await ctx.prompter.text({ id: "billing-per-seat-price", message: `Monthly price per Seat of the per-Seat plan in ${currency.toUpperCase()} (empty = no per-Seat plan)` })).trim();
  let perSeat: number | null = null;
  if (perSeatAnswer) {
    const parsed = number(0.01, false, "The price")(perSeatAnswer);
    if ("error" in parsed) throw new Error(parsed.error);
    perSeat = toMinor(parsed.value);
  }
  const free = await ctx.prompter.confirm({ id: "billing-free", message: "Is there a Free plan (1 Seat, no price)?", initial: true });
  if (fixed.length === 0 && perSeat === null && !free) throw new Error("A Product with billing needs at least one plan.");
  const annual = await ctx.prompter.confirm({ id: "billing-annual", message: "Sell the paid plans yearly too?", initial: false });
  const discount = annual ? await ask<number>(ctx, "billing-annual-discount", "Discount of the yearly price against 12 months, in percent (one for all plans; 0 = none)", (answer) => {
    const value = Number(answer.replace(",", "."));
    return answer !== "" && value >= 0 && value < 100 ? { value } : { error: "The discount is a percentage from 0 to 99." };
  }) : 0;
  const trialDays = await ask(ctx, "billing-trial-days", "Days of free trial on the paid plans (0 = none)", number(0, true, "The days"));
  return { currency, fixed, perSeat, free, annual, discount, trialDays, entitlements: {} };
}

const entitlementAnswer = (answer: string): Parsed<EntitlementValue> => {
  const word = answer.toLowerCase();
  if (["on", "yes", "true"].includes(word)) return { value: true };
  if (["off", "no", "false"].includes(word)) return { value: false };
  return number(0, true, "An Entitlement")(answer);
};

/**
 * Asks, for each plan and each of `names`, whether the plan grants the Entitlement (on, off or a number) and returns the
 * answers added to the ones already recorded.
 */
export async function askEntitlements(ctx: StepContext, product: ProductIdentity, answers: BillingAnswers, names: readonly string[]): Promise<BillingAnswers["entitlements"]> {
  const granted: BillingAnswers["entitlements"] = Object.fromEntries(Object.entries(answers.entitlements).map(([plan, values]) => [plan, { ...values }]));
  for (const spec of planSpecs(product.id, answers)) {
    for (const name of names) {
      const value = await ask(ctx, "billing-entitlement", `Entitlement "${name}" in the plan ${spec.name}: on, off or a number`, entitlementAnswer);
      granted[spec.key] = { ...granted[spec.key], [name]: value };
    }
  }
  return granted;
}

/**
 * The key of one account for this run: memory, then the environment, then (with a person to ask) a hidden prompt after the
 * pre-filled creation link. A key of the other account, or one lacking permissions, is named and asked again.
 */
export async function stripeKey(ctx: StepContext, product: ProductIdentity, mode: KeyMode): Promise<string> {
  const kept = ctx.memory.stripeKeys?.[mode];
  if (kept) return kept;
  const fromEnv = ctx.env[ENV_KEYS[mode]] || undefined;
  if (!fromEnv && !ctx.interactive) throw new Error(`No Stripe ${mode} key: export ${ENV_KEYS[mode]} or run in a terminal.`);
  const label = mode === "sandbox" ? "the sandbox that Previews use" : "the real account";
  let announced = false;
  for (let attempt = 1; attempt <= KEY_TRIES; attempt++) {
    let key = attempt === 1 ? fromEnv : undefined;
    if (!key) {
      if (!announced) {
        ctx.prompter.link(`Create a restricted key in ${label} (name and permissions are filled in; only click Create key, then copy it):`, keyCreationUrl(`${product.id}-billing-${mode === "sandbox" ? "sandbox" : "live"}`, mode));
        announced = true;
      }
      key = (await ctx.prompter.password({ id: `stripe-${mode}-key`, message: `Paste the ${mode} key (hidden; stored only as a secret)` })).trim();
    }
    const problem = await keyProblem(ctx, key, mode);
    if (!problem) {
      ctx.memory.stripeKeys = { ...ctx.memory.stripeKeys, [mode]: key };
      return key;
    }
    ctx.log(`  ${problem}`);
  }
  throw new Error(`No usable Stripe ${mode} key after ${KEY_TRIES} tries.`);
}

async function keyProblem(ctx: StepContext, key: string, mode: KeyMode): Promise<string | undefined> {
  const found = keyMode(key);
  if (!found) return "That is not a Stripe key (it starts with rk_test_, rk_live_, sk_test_ or sk_live_).";
  if (found !== mode) return `That is a ${found} key; this one must be from ${mode === "sandbox" ? "the sandbox" : "the real account"}.`;
  try {
    const missing = await ctx.stripe(key).missingPermissions();
    if (missing.length > 0) return `The key lacks ${missing.join(", ")}: create it again with the link above.`;
  } catch (error) {
    return `Stripe refused the key: ${(error as Error).message}`;
  }
  return undefined;
}

export function keysStep(product: ProductIdentity): Step {
  const names = billingNames(product.id);
  return {
    id: "keys",
    title: `Stripe keys (${names.sandboxKey}, ${names.liveKey})`,
    asks: ["stripe-sandbox-key", "stripe-live-key"],
    async check(ctx) {
      const live = (await ctx.github.listSecrets(await secretScope(ctx, product.id))).includes(names.liveKey);
      const sandbox = (await ctx.github.listSecrets(await previewScope(ctx, product.id))).includes(names.sandboxKey);
      return { done: live && sandbox };
    },
    async run(ctx) {
      const redo = ctx.redo?.includes("keys") ?? false;
      const sandboxSet = (await ctx.github.listSecrets(await previewScope(ctx, product.id))).includes(names.sandboxKey);
      const liveSet = (await ctx.github.listSecrets(await secretScope(ctx, product.id))).includes(names.liveKey);
      if (redo || !sandboxSet) await ctx.github.setSecret(names.sandboxKey, await stripeKey(ctx, product, "sandbox"), await previewScope(ctx, product.id));
      if (redo || !liveSet) await ctx.github.setSecret(names.liveKey, await stripeKey(ctx, product, "live"), await secretScope(ctx, product.id));
    },
  };
}

async function recordedAnswers(ctx: StepContext, productId: string): Promise<BillingAnswers | undefined> {
  const raw = (await ctx.github.listVariables())[billingNames(productId).plans];
  if (!raw) return undefined;
  try {
    return Answers.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** The same plans, payment methods and portal in the sandbox and in the real account. */
export function plansStep(product: ProductIdentity): Step {
  const names = billingNames(product.id);
  return {
    id: "plans",
    title: "Plans, payment methods and Customer Portal (sandbox and real account)",
    // Writing the plans needs both keys, even when the keys step is done: a secret cannot be read back.
    async asks(ctx) {
      const recorded = !ctx.redo?.includes("plans") && (await recordedAnswers(ctx, product.id)) !== undefined;
      return recorded ? ["stripe-sandbox-key", "stripe-live-key"] : ["billing-currency", "stripe-sandbox-key", "stripe-live-key"];
    },
    async check(ctx) {
      const variables = await ctx.github.listVariables();
      return { done: variables[names.plans] !== undefined && variables[names.synced] === "true" };
    },
    async run(ctx) {
      const redo = ctx.redo?.includes("plans") ?? false;
      let answers = redo ? undefined : await recordedAnswers(ctx, product.id);
      if (!answers) {
        answers = await askAnswers(ctx);
        answers.entitlements = await askEntitlements(ctx, product, answers, product.entitlements ?? []);
        await ctx.github.setVariable(names.plans, JSON.stringify(answers));
      }
      await ctx.github.setVariable(names.synced, "false");
      const specs = planSpecs(product.id, answers);
      for (const mode of ["sandbox", "live"] as const) {
        const stripe = ctx.stripe(await stripeKey(ctx, product, mode));
        await writeAccount(ctx, stripe, mode, product.id, specs);
      }
      await ctx.github.setVariable(names.synced, "true");
      await writeEntitlements(ctx, product, answers);
    },
  };
}

/** `entitlement_<name>` on each plan's product, in both accounts; one already set is left alone. */
async function writeEntitlements(ctx: StepContext, product: ProductIdentity, answers: BillingAnswers): Promise<void> {
  for (const mode of ["sandbox", "live"] as const) {
    const stripe = ctx.stripe(await stripeKey(ctx, product, mode));
    for (const [plan, values] of Object.entries(answers.entitlements)) {
      const added = await stripe.ensureEntitlements(product.id, plan, values);
      if (added.length > 0) ctx.log(`  ${mode}: plan ${plan} now sets ${added.map((name) => `${name}=${entitlementMetadata(values[name]!)}`).join(", ")}`);
    }
  }
}

const unplaced = (product: ProductIdentity, answers: BillingAnswers | undefined) => missingEntitlements(product.entitlements ?? [], Object.values(answers?.entitlements ?? {}).map((entitlements) => ({ entitlements })));

/** Which plans grant each Entitlement the Product's code declares. Asks only about names that no plan sets yet. */
export function entitlementsStep(product: ProductIdentity): Step {
  const names = billingNames(product.id);
  return {
    id: "entitlements",
    title: "Entitlements of each plan (sandbox and real account)",
    async check(ctx) {
      const variables = await ctx.github.listVariables();
      if (variables[names.plans] === undefined) return { done: false, detail: "no plans yet" };
      const missing = unplaced(product, await recordedAnswers(ctx, product.id));
      return missing.length === 0 ? { done: true } : { done: false, detail: `in no plan: ${missing.join(", ")}` };
    },
    async run(ctx) {
      const answers = await recordedAnswers(ctx, product.id);
      if (!answers) throw new Error(`No plans recorded yet: run \`pnpm bootstrap billing ${product.id} --redo plans\` first.`);
      const missing = unplaced(product, answers);
      if (missing.length === 0) {
        ctx.log("  every Entitlement the code declares is already in a plan");
        return;
      }
      answers.entitlements = await askEntitlements(ctx, product, answers, missing);
      await ctx.github.setVariable(names.plans, JSON.stringify(answers));
      await writeEntitlements(ctx, product, answers);
    },
  };
}

async function writeAccount(ctx: StepContext, stripe: StripeClient, mode: KeyMode, productId: string, specs: StripePlanSpec[]): Promise<void> {
  for (const spec of specs) {
    const { created, different } = await stripe.ensurePlan(productId, spec);
    if (created.length > 0) ctx.log(`  ${mode}: created ${created.join(", ")}`);
    if (different.length > 0) ctx.log(`  ${mode}: ${different.join(", ")} exist with another amount or currency (a Stripe price cannot change; left alone)`);
  }
  const methods = await stripe.ensurePaymentMethods();
  const portal = await stripe.ensurePortal(productId);
  ctx.log(`  ${mode}: payment methods ${methods === "updated" ? "turned on (card, Apple Pay, Google Pay)" : "already on"}, portal ${portal === "created" ? "created" : "already there"}`);
}

/** The events endpoint of the real account. Stripe shows its signing secret once, so a missing secret means a new endpoint. */
export function webhookStep(product: ProductIdentity): Step {
  const names = billingNames(product.id);
  return {
    id: "webhook",
    title: `Stripe events endpoint (${webhookUrl(product)})`,
    asks: ["stripe-live-key"],
    async check(ctx) {
      return { done: (await ctx.github.listSecrets(await secretScope(ctx, product.id))).includes(names.webhookSecret) };
    },
    async run(ctx) {
      const stripe = ctx.stripe(await stripeKey(ctx, product, "live"));
      const old = await stripe.listWebhooks(product.id);
      const made = await stripe.createWebhook(product.id, webhookUrl(product));
      await ctx.github.setSecret(names.webhookSecret, made.secret, await secretScope(ctx, product.id));
      // Two endpoints would deliver every event twice: the ones this wizard made before go once the new secret is stored.
      for (const endpoint of old) await stripe.deleteWebhook(endpoint.id);
      ctx.log(`  created the endpoint ${webhookUrl(product)}${old.length > 0 ? ` and removed ${old.length} old one(s)` : ""}`);
    },
  };
}

export function billingSteps(product: ProductIdentity): Step[] {
  return [keysStep(product), plansStep(product), entitlementsStep(product), webhookStep(product)];
}

export const BILLING_MISSING_FEATURE = (productId: string) =>
  `${productId} does not list the billing Feature, so there is nothing to charge for. Add \`billing({ entitlements: [...] })\` (from "@workspace/skeleton") to the \`features\` in apps/${productId}/src/features/index.ts, then run this command again.`;
