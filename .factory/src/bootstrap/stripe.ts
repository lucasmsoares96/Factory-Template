import Stripe from "stripe";
import type { StripeClient, StripePlanSpec, StripePlanState, StripePriceMigration, StripeWebhook } from "./clients.ts";
import { entitlementMetadata } from "./entitlements.ts";
import { BILLING_PERMISSIONS, PORTAL_WRITE_FALLBACK } from "./billing-permissions.ts";

/** The events the Better Auth Stripe plugin handles at `/api/auth/stripe/webhook`. */
export const WEBHOOK_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "subscription_schedule.updated"];

const ENTITLEMENT_PREFIX = "entitlement_";

/** One read per permission in the key link: a key that lacks it is refused with a 403. */
const PROBES: Record<(typeof BILLING_PERMISSIONS)[number], (stripe: Stripe) => Promise<unknown>> = {
  rak_product_write: (stripe) => stripe.products.list({ limit: 1 }),
  rak_plan_write: (stripe) => stripe.prices.list({ limit: 1 }),
  rak_customer_write: (stripe) => stripe.customers.list({ limit: 1 }),
  rak_checkout_session_write: (stripe) => stripe.checkout.sessions.list({ limit: 1 }),
  rak_subscription_write: (stripe) => stripe.subscriptions.list({ limit: 1 }),
  rak_webhook_write: (stripe) => stripe.webhookEndpoints.list({ limit: 1 }),
  rak_payment_method_configurations_write: (stripe) => stripe.paymentMethodConfigurations.list({ limit: 1 }),
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
      try {
        await PROBES[permission](this.stripe);
      } catch (error) {
        if (!isPermissionError(error)) throw error;
        missing.push(permissionIn(error.message) ?? permission);
      }
    }
    // The Customer Portal permission is not in the key link (unconfirmed), so the write is tried: create a configuration, then deactivate it.
    try {
      const probe = await this.stripe.billingPortal.configurations.create({
        name: "factory-doctor-probe",
        features: { invoice_history: { enabled: true } },
      });
      await this.stripe.billingPortal.configurations.update(probe.id, { active: false });
    } catch (error) {
      if (!isPermissionError(error)) throw error;
      missing.push(permissionIn(error.message) ?? PORTAL_WRITE_FALLBACK);
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
        entitlements: Object.fromEntries(Object.entries(product.metadata).filter(([name]) => name.startsWith(ENTITLEMENT_PREFIX)).map(([name, value]) => [name.slice(ENTITLEMENT_PREFIX.length), value])),
        prices: prices
          .filter((price) => (typeof price.product === "string" ? price.product : price.product.id) === product.id && price.unit_amount !== null)
          .map((price) => ({ lookupKey: price.lookup_key ?? "", amount: price.unit_amount!, currency: price.currency, interval: price.recurring?.interval ?? "" }))
          .sort((a, b) => a.lookupKey.localeCompare(b.lookupKey)),
      });
    }
    return plans.sort((a, b) => a.key.localeCompare(b.key));
  }

  async ensurePlan(productId: string, plan: StripePlanSpec, options: { replace?: boolean } = {}): Promise<{ created: string[]; different: string[]; replaced: string[] }> {
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
    const replaced: string[] = [];
    for (const price of plan.prices) {
      const found = (await this.stripe.prices.list({ lookup_keys: [price.lookupKey], active: true, limit: 1 })).data[0];
      const changed = found !== undefined && (found.unit_amount !== price.amount || found.currency !== plan.currency);
      if (found && !(changed && options.replace)) {
        if (changed) different.push(price.lookupKey);
        continue;
      }
      // A price's amount cannot be edited: the new one takes the lookup key in the same call, then the old one is archived.
      await this.stripe.prices.create({
        product: product.id,
        currency: plan.currency,
        unit_amount: price.amount,
        recurring: { interval: price.interval },
        lookup_key: price.lookupKey,
        nickname: price.lookupKey,
        ...(found ? { transfer_lookup_key: true } : {}),
      });
      if (found) {
        await this.stripe.prices.update(found.id, { active: false });
        replaced.push(price.lookupKey);
      } else {
        created.push(`price ${price.lookupKey}`);
      }
    }
    return { created, different, replaced };
  }

  async archivePlansExcept(productId: string, keep: string[]): Promise<string[]> {
    const archived: string[] = [];
    for await (const product of this.stripe.products.list({ active: true, limit: 100 })) {
      const key = product.metadata.plan;
      if (product.metadata.productId !== productId || !key || keep.includes(key)) continue;
      for await (const price of this.stripe.prices.list({ product: product.id, active: true, limit: 100 })) {
        await this.stripe.prices.update(price.id, { active: false });
      }
      await this.stripe.products.update(product.id, { active: false });
      archived.push(key);
    }
    return archived.sort();
  }

  async listPriceMigrations(productId: string): Promise<StripePriceMigration[]> {
    const productIds = new Set<string>();
    for await (const product of this.stripe.products.list({ active: true, limit: 100 })) {
      if (product.metadata.productId === productId && product.metadata.plan) productIds.add(product.id);
    }
    const productOf = (price: Stripe.Price) => (typeof price.product === "string" ? price.product : price.product.id);
    const current = new Map<string, Stripe.Price>();
    for await (const price of this.stripe.prices.list({ active: true, limit: 100 })) {
      if (price.lookup_key && price.unit_amount !== null && productIds.has(productOf(price))) current.set(price.lookup_key, price);
    }
    const migrations: StripePriceMigration[] = [];
    for await (const old of this.stripe.prices.list({ active: false, limit: 100 })) {
      const next = old.nickname ? current.get(old.nickname) : undefined;
      if (!next || old.unit_amount === null || !productIds.has(productOf(old))) continue;
      for await (const subscription of this.stripe.subscriptions.list({ price: old.id, limit: 100 })) {
        if (!["active", "trialing", "past_due"].includes(subscription.status) || subscription.schedule) continue;
        const renewsAt = Math.min(...subscription.items.data.map((item) => item.current_period_end));
        migrations.push({ subscriptionId: subscription.id, lookupKey: next.lookup_key!, fromPriceId: old.id, toPriceId: next.id, oldAmount: old.unit_amount, newAmount: next.unit_amount!, currency: next.currency, renewsAt });
      }
    }
    return migrations;
  }

  async schedulePriceMigration(migration: StripePriceMigration): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(migration.subscriptionId);
    const created = await this.stripe.subscriptionSchedules.create({ from_subscription: migration.subscriptionId });
    const phase = created.phases[0]!;
    const items = phase.items.map((item) => ({ price: typeof item.price === "string" ? item.price : item.price.id, quantity: item.quantity ?? 1 }));
    await this.stripe.subscriptionSchedules.update(created.id, {
      end_behavior: "release",
      // The Subscription's metadata (the Owner's id, the Product's id) lets the Worker tell the Owner when this update arrives.
      metadata: { ...subscription.metadata, priceChange: "true" },
      proration_behavior: "none",
      phases: [
        { items, start_date: phase.start_date, end_date: phase.end_date, ...(phase.trial_end ? { trial_end: phase.trial_end } : {}) },
        { items: items.map((item) => (item.price === migration.fromPriceId ? { ...item, price: migration.toPriceId } : item)), proration_behavior: "none" },
      ],
    });
  }

  async ensureEntitlements(productId: string, planKey: string, values: Record<string, boolean | number>): Promise<string[]> {
    for await (const product of this.stripe.products.list({ active: true, limit: 100 })) {
      if (product.metadata.productId !== productId || product.metadata.plan !== planKey) continue;
      const added = Object.keys(values).filter((name) => !(`${ENTITLEMENT_PREFIX}${name}` in product.metadata));
      if (added.length > 0) {
        await this.stripe.products.update(product.id, { metadata: Object.fromEntries(added.map((name) => [`${ENTITLEMENT_PREFIX}${name}`, entitlementMetadata(values[name]!)])) });
      }
      return added;
    }
    throw new Error(`Stripe has no product for the plan ${planKey}.`);
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
      if (endpoint.metadata?.productId === productId) found.push({ id: endpoint.id, url: endpoint.url, events: endpoint.enabled_events });
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

  async createCustomer(productId: string, person: { userId: string; email: string; name: string }): Promise<string> {
    // `userId` is what the Better Auth Stripe plugin tags its own customers with; the user's row carries the customer id.
    const customer = await this.stripe.customers.create({ email: person.email, name: person.name, metadata: { productId, userId: person.userId, customerType: "user" } }, { idempotencyKey: `${productId}-customer-${person.userId}` });
    return customer.id;
  }

  async startTrial(productId: string, trial: { customerId: string; userId: string; lookupKey: string; seats: number; days: number }): Promise<"started" | "exists"> {
    const existing = await this.stripe.subscriptions.list({ customer: trial.customerId, status: "all", limit: 1 });
    if (existing.data.length > 0) return "exists";
    const price = (await this.stripe.prices.list({ lookup_keys: [trial.lookupKey], active: true, limit: 1 })).data[0];
    if (!price) throw new Error(`No price ${trial.lookupKey} in Stripe: run the plans step again.`);
    await this.stripe.subscriptions.create(
      {
        customer: trial.customerId,
        items: [{ price: price.id, quantity: trial.seats }],
        trial_period_days: trial.days,
        // No card was given: when the trial ends Stripe cancels the Subscription instead of asking for a payment.
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { productId, userId: trial.userId, referenceId: trial.userId },
      },
      { idempotencyKey: `${productId}-trial-${trial.userId}` },
    );
    return "started";
  }
}
