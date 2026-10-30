import Stripe from "stripe";
import type { Context } from "hono";
import { messagesFor } from "../../i18n/index.ts";
import type { SkeletonEnv } from "../../platform/env.ts";
import { buildLocale } from "../../platform/locale.ts";
import { FakeStripe } from "./fake-stripe/fake-stripe.ts";
import { FakeStripeStore } from "./fake-stripe/store.ts";
import { cachedPlans, readPlans, type PlanCatalog } from "./plans.ts";

/** What billing needs for one request: the Stripe client (real or fake) and the Plans it reads. */
export type Billing = {
  stripe: Stripe;
  webhookSecret: string;
  productId: string;
  /** The Preview's tag (`pr-N`); `undefined` in production. */
  environment: string | undefined;
  fake: FakeStripe | undefined;
  plans(): Promise<PlanCatalog>;
};

const WEBHOOK_SECRET_FAKE = "whsec_fake";

type StripeEnv = { STRIPE_SECRET_KEY?: string; STRIPE_FAKE?: string; BILLING_ENVIRONMENT?: string };

/** The fake runs only with `STRIPE_FAKE=true` (`pnpm dev`, the tests), and never beside a live key. */
export const isFakeStripe = (env: StripeEnv) => env.STRIPE_FAKE === "true" && !env.STRIPE_SECRET_KEY?.startsWith("sk_live_");

/** Billing is on where the Worker has a Stripe key, or runs the fake. */
export const billingEnabled = (env: StripeEnv) => Boolean(env.STRIPE_SECRET_KEY) || isFakeStripe(env);

const requests = new WeakMap<object, Billing | null>();

/** The request's billing, or `null` when the Worker has no Stripe key. */
export function billingFor(c: Context<SkeletonEnv>, entitlements: readonly string[]): Billing | null {
  const known = requests.get(c);
  if (known !== undefined) return known;
  const billing = createBilling(c, entitlements);
  requests.set(c, billing);
  return billing;
}

function createBilling(c: Context<SkeletonEnv>, entitlements: readonly string[]): Billing | null {
  if (!billingEnabled(c.env)) return null;
  const key = c.env.STRIPE_SECRET_KEY || "sk_fake_local";
  const productId = c.var.productId;
  let fake: FakeStripe | undefined;
  let stripe: Stripe;
  if (isFakeStripe(c.env)) {
    fake = new FakeStripe({
      store: new FakeStripeStore(c.var.db, c.env.DATABASE_URL),
      origin: new URL(c.req.url).origin,
      productId,
      webhookSecret: c.env.STRIPE_WEBHOOK_SECRET || WEBHOOK_SECRET_FAKE,
      seed: messagesFor(buildLocale).billing.seed,
      deliver: (request) => c.var.auth().handler(request),
    });
    const fakeStripe = fake;
    // The SDK's HTTP client calls the fake in this process instead of api.stripe.com.
    stripe = new Stripe(key, {
      httpClient: Stripe.createFetchHttpClient((url: string | URL | Request, init?: RequestInit) =>
        fakeStripe.handle(new Request(url, init)),
      ),
      maxNetworkRetries: 0,
    });
  } else {
    stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  }
  // The Stripe plugin reads the Plans when it starts, as the route does: one reading serves both.
  let reading: Promise<PlanCatalog> | undefined;
  return {
    stripe,
    productId,
    environment: c.env.BILLING_ENVIRONMENT || undefined,
    fake,
    webhookSecret: fake ? c.env.STRIPE_WEBHOOK_SECRET || WEBHOOK_SECRET_FAKE : (c.env.STRIPE_WEBHOOK_SECRET ?? ""),
    plans: () => (reading ??= cachedPlans(productId, () => readPlans(stripe, { productId, entitlements }))),
  };
}
