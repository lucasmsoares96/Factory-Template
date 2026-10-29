import Stripe from "stripe";
import type { StripeClient, StripePlanSpec, StripePlanState, StripeWebhook } from "./clients.ts";
import { BILLING_PERMISSIONS } from "./billing-permissions.ts";

/** The events the Better Auth Stripe plugin handles at `/api/auth/stripe/webhook`. */
export const WEBHOOK_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];

/** One read per permission: a key that lacks it is refused with a 403. */
const PROBES: Record<string, (stripe: Stripe) => Promise<unknown>> = {
  product: (stripe) => stripe.products.list({ limit: 1 }),
  price: (stripe) => stripe.prices.list({ limit: 1 }),
  customer: (stripe) => stripe.customers.list({ limit: 1 }),
  checkout_session: (stripe) => stripe.checkout.sessions.list({ limit: 1 }),
  subscription: (stripe) => stripe.subscriptions.list({ limit: 1 }),
  billing_portal_configuration: (stripe) => stripe.billingPortal.configurations.list({ limit: 1 }),
  webhook: (stripe) => stripe.webhookEndpoints.list({ limit: 1 }),
  payment_method_configuration: (stripe) => stripe.paymentMethodConfigurations.list({ limit: 1 }),
};

function isPermissionError(error: unknown): error is Error {
  const e = error as { type?: string; statusCode?: number } | undefined;
  return e?.type === "StripePermissionError" || e?.statusCode === 403;
}

/** Stripe's message names the permission it wants (`Having the 'rak_x_read' permission would allow ...`). */
function permissionIn(message: string): string | undefined {
  return /'(rak_[a-z0-9_]+)'/.exec(message)?.[1];
}

/** Stripe through its Node SDK (v23, the one the Skeleton pins); the key stays in memory. `httpClient` lets a test stand in for the network. */
export class StripeApi implements StripeClient {
  private readonly stripe: Stripe;

  constructor(key: string, options: { httpClient?: Stripe.HttpClient } = {}) {
    this.stripe = new Stripe(key, { maxNetworkRetries: 0, appInfo: { name: "factory-bootstrap" }, ...(options.httpClient ? { httpClient: options.httpClient } : {}) });
  }

  async missingPermissions(): Promise<string[]> {
    const missing: string[] = [];
    for (const permission of BILLING_PERMISSIONS) {
      const resource = permission.replace(/^rak_/, "").replace(/_write$/, "");
      try {
        await PROBES[resource]!(this.stripe);
      } catch (error) {
        if (!isPermissionError(error)) throw error;
        missing.push(permissionIn(error.message) ?? permission);
      }
    }
    return missing;
  }

  async listPlans(productId: string): Promise<StripePlanState[]> {
    const plans: StripePlanState[] = [];
    const prices: Stripe.Price[] = [];
    for await (const price of this.stripe.prices.list({ active: true, limit: 100 })) prices.push(price);
    for await (const product of this.stripe.products.list({ active: true, limit: 100 })) {
      if (product.metadata.productId !== productId || !product.metadata.plan) continue;
      const seats = product.metadata.seats === undefined ? null : Number(product.metadata.seats);
      plans.push({
        key: product.metadata.plan,
        name: product.name,
        kind: product.metadata.kind ?? "",
        seats: seats !== null && Number.isFinite(seats) ? seats : null,
        prices: prices
          .filter((price) => (typeof price.product === "string" ? price.product : price.product.id) === product.id && price.unit_amount !== null)
          .map((price) => ({ lookupKey: price.lookup_key ?? "", amount: price.unit_amount!, currency: price.currency, interval: price.recurring?.interval ?? "" }))
          .sort((a, b) => a.lookupKey.localeCompare(b.lookupKey)),
      });
    }
    return plans.sort((a, b) => a.key.localeCompare(b.key));
  }

  async ensurePlan(productId: string, plan: StripePlanSpec): Promise<{ created: string[]; different: string[] }> {
    let product: Stripe.Product | undefined;
    for await (const candidate of this.stripe.products.list({ active: true, limit: 100 })) {
      if (candidate.metadata.productId === productId && candidate.metadata.plan === plan.key) {
        product = candidate;
        break;
      }
    }
    const created: string[] = [];
    if (!product) {
      product = await this.stripe.products.create({
        name: plan.name,
        metadata: {
          productId,
          plan: plan.key,
          kind: plan.kind,
          ...(plan.seats === null ? {} : { seats: String(plan.seats) }),
          ...(plan.minSeats === undefined ? {} : { min_seats: String(plan.minSeats) }),
          trial_days: String(plan.trialDays),
        },
      });
      created.push(`product ${plan.key}`);
    }
    const different: string[] = [];
    for (const price of plan.prices) {
      const found = (await this.stripe.prices.list({ lookup_keys: [price.lookupKey], active: true, limit: 1 })).data[0];
      if (found) {
        if (found.unit_amount !== price.amount || found.currency !== plan.currency) different.push(price.lookupKey);
        continue;
      }
      await this.stripe.prices.create({
        product: product.id,
        currency: plan.currency,
        unit_amount: price.amount,
        recurring: { interval: price.interval },
        lookup_key: price.lookupKey,
        nickname: price.lookupKey,
      });
      created.push(`price ${price.lookupKey}`);
    }
    return { created, different };
  }

  async ensurePaymentMethods(): Promise<"updated" | "unchanged"> {
    const configurations = await this.stripe.paymentMethodConfigurations.list({ limit: 100 });
    const current = configurations.data.find((configuration) => configuration.is_default) ?? configurations.data[0];
    if (!current) throw new Error("Stripe has no payment method configuration to update.");
    const wanted = ["card", "apple_pay", "google_pay"] as const;
    if (wanted.every((method) => current[method]?.display_preference.preference === "on")) return "unchanged";
    const on = { display_preference: { preference: "on" as const } };
    await this.stripe.paymentMethodConfigurations.update(current.id, { card: on, apple_pay: on, google_pay: on });
    return "updated";
  }

  async ensurePortal(productId: string): Promise<"created" | "unchanged"> {
    for await (const configuration of this.stripe.billingPortal.configurations.list({ limit: 100 })) {
      if (configuration.metadata?.productId === productId) return "unchanged";
    }
    await this.stripe.billingPortal.configurations.create({
      name: productId,
      metadata: { productId },
      features: {
        customer_update: { enabled: true, allowed_updates: ["email", "name", "address"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
    });
    return "created";
  }

  async listWebhooks(productId: string): Promise<StripeWebhook[]> {
    const found: StripeWebhook[] = [];
    for await (const endpoint of this.stripe.webhookEndpoints.list({ limit: 100 })) {
      if (endpoint.metadata?.productId === productId) found.push({ id: endpoint.id, url: endpoint.url });
    }
    return found;
  }

  async createWebhook(productId: string, url: string): Promise<{ id: string; secret: string }> {
    const endpoint = await this.stripe.webhookEndpoints.create({ url, enabled_events: WEBHOOK_EVENTS as Stripe.WebhookEndpointCreateParams.EnabledEvent[], metadata: { productId }, description: `${productId} billing` });
    if (!endpoint.secret) throw new Error("Stripe did not return the signing secret of the endpoint.");
    return { id: endpoint.id, secret: endpoint.secret };
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.stripe.webhookEndpoints.del(id);
  }
}
