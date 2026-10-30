import { billingNames, webhookUrl } from "./billing.ts";
import { keyMode, type KeyMode } from "./billing-permissions.ts";
import type { StripeClient, StripePlanState } from "./clients.ts";
import { missingEntitlements } from "./entitlements.ts";
import { secretScope } from "./domain.ts";
import { previewScope } from "./previews.ts";
import type { CheckStatus } from "./doctor.ts";
import type { ProductIdentity, StepContext } from "./steps.ts";

/** Secrets of the Product's two environments and the repo: where the deploy and the previews read them. */
async function visibleSecrets(ctx: StepContext, productId: string): Promise<Set<string>> {
  return new Set([
    ...(await ctx.github.listSecrets(await secretScope(ctx, productId))),
    ...(await ctx.github.listSecrets(await previewScope(ctx, productId))),
    ...(await ctx.github.listSecrets()),
  ]);
}

/** Whether the repo holds any trace of this Product's billing, so the doctor shows the section without being asked. */
export async function hasBillingTrace(ctx: StepContext, productId: string, variables: Record<string, string>, secrets: string[]): Promise<boolean> {
  const names = billingNames(productId);
  const have = new Set([...secrets, ...(await visibleSecrets(ctx, productId))]);
  return [names.liveKey, names.sandboxKey, names.webhookSecret].some((name) => have.has(name)) || variables[names.plans] !== undefined || variables[names.synced] !== undefined;
}

const ENV_KEYS = { sandbox: "STRIPE_SANDBOX_KEY", live: "STRIPE_LIVE_KEY" } as const;

/** The key of one account when this run can have it: memory, the environment, then (when asked to) one hidden prompt that may stay empty. */
async function keyForCheck(ctx: StepContext, mode: KeyMode, prompt: boolean): Promise<string | undefined> {
  const kept = ctx.memory.stripeKeys?.[mode];
  if (kept) return kept;
  let key = ctx.env[ENV_KEYS[mode]] || undefined;
  if (!key && prompt && ctx.interactive) {
    key = (await ctx.prompter.password({ id: `stripe-${mode}-key-check`, message: `Paste the Stripe ${mode} key to check billing (not stored; leave empty to skip)` })).trim() || undefined;
  }
  if (key) ctx.memory.stripeKeys = { ...ctx.memory.stripeKeys, [mode]: key };
  return key;
}

const describe = (plan: StripePlanState) => JSON.stringify(plan);

/**
 * The Billing section of `doctor <id>`. The secrets and variables are required once billing has a trace (the deploy hands
 * the Worker the key only when all are set); what needs a Stripe key is read only when this run has one.
 */
export async function billingChecks(
  ctx: StepContext,
  product: ProductIdentity,
  variables: Record<string, string>,
  prompt: boolean,
  add: (status: CheckStatus, name: string, detail?: string) => void,
): Promise<void> {
  const id = product.id;
  const names = billingNames(id);
  const redo = `run \`pnpm bootstrap billing ${id}\``;
  const have = await visibleSecrets(ctx, id);
  for (const name of [names.sandboxKey, names.liveKey, names.webhookSecret]) add(have.has(name) ? "ok" : "missing", name, have.has(name) ? undefined : redo);
  add(variables[names.plans] ? "ok" : "missing", names.plans, variables[names.plans] ? undefined : redo);
  add(variables[names.synced] === "true" ? "ok" : "missing", names.synced, variables[names.synced] === "true" ? undefined : `${redo} (writes the plans)`);

  const clients: Partial<Record<KeyMode, StripeClient>> = {};
  for (const mode of ["sandbox", "live"] as const) {
    const key = await keyForCheck(ctx, mode, prompt);
    const label = `Stripe ${mode} key`;
    if (!key) {
      add("skip", label, `export ${ENV_KEYS[mode]} to check it`);
      continue;
    }
    if (keyMode(key) !== mode) {
      add("missing", label, `not a ${mode} key`);
      continue;
    }
    try {
      const client = ctx.stripe(key);
      const missing = await client.missingPermissions();
      if (missing.length > 0) add("missing", label, `lacks ${missing.join(", ")}: ${redo} --redo keys`);
      else add("ok", label, "all permissions present");
      clients[mode] = client;
    } catch (error) {
      add("warn", label, (error as Error).message);
    }
  }

  if (clients.sandbox && clients.live) {
    try {
      const [sandbox, live] = await Promise.all([clients.sandbox.listPlans(id), clients.live.listPlans(id)]);
      const differ = [...new Set([...sandbox, ...live].map((plan) => plan.key))].filter((key) => {
        const a = sandbox.find((plan) => plan.key === key);
        const b = live.find((plan) => plan.key === key);
        return !a || !b || describe(a) !== describe(b);
      });
      if (sandbox.length === 0 && live.length === 0) add("warn", "Plans", `none in either account: ${redo}`);
      else if (differ.length > 0) add("warn", "Plans", `the sandbox and the real account differ in ${differ.join(", ")}: ${redo} --redo plans`);
      else add("ok", "Plans", `${live.length} plan(s), the same in both accounts`);
    } catch (error) {
      add("warn", "Plans", (error as Error).message);
    }
  } else add("skip", "Plans", "needs both keys");

  if (clients.live) {
    try {
      const expected = webhookUrl(product);
      const found = await clients.live.listWebhooks(id);
      if (found.some((hook) => hook.url === expected)) add("ok", "Events endpoint", expected);
      else if (found.length === 0) add("missing", "Events endpoint", `none in the real account: ${redo} --redo webhook`);
      else add("missing", "Events endpoint", `points to ${found.map((hook) => hook.url).join(", ")}, not to ${expected}: ${redo} --redo webhook`);
    } catch (error) {
      add("warn", "Events endpoint", (error as Error).message);
    }
  } else add("skip", "Events endpoint", "needs the real account's key");

  const declared = product.entitlements ?? [];
  if (declared.length === 0) add("ok", "Entitlements", "the code declares none");
  else if (clients.live) {
    try {
      const unplaced = missingEntitlements(declared, await clients.live.listPlans(id));
      if (unplaced.length > 0) add("warn", "Entitlements", `in no plan of the real account: ${unplaced.join(", ")}: ${redo} --redo entitlements`);
      else add("ok", "Entitlements", `${declared.length} declared, each in a plan`);
    } catch (error) {
      add("warn", "Entitlements", (error as Error).message);
    }
  } else add("skip", "Entitlements", "needs the real account's key");
}
