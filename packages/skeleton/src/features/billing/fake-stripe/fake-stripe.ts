import { parseForm } from "./form.ts";
import { stripeSignature } from "./sign.ts";
import type { FakeStripeStore, StoredObject } from "./store.ts";

/** Where the fake serves its Checkout page and control routes (under `/api`). */
export const FAKE_STRIPE_PATH = "/api/fake-stripe";

/** The names and descriptions of the plans the fake starts with, in the build's language. */
export type SeedTexts = Record<"free" | "pro" | "team", { name: string; description: string }>;

export type FakeStripeDeps = {
  store: FakeStripeStore;
  /** The origin the Worker answers on: Checkout links and webhook calls point here. */
  origin: string;
  /** The Product the seeded plans belong to. */
  productId: string;
  webhookSecret: string;
  seed: SeedTexts;
  /** Hands a signed webhook call to the app, the way Stripe's POST would arrive. */
  deliver: (request: Request) => Promise<Response>;
};

type Json = Record<string, any>;
type Obj = StoredObject & Json;

const CURRENCY = "usd";
const TRIAL_WARNING = 3 * 24 * 60 * 60;
const FAILING = "setting_failing";
const CLOCK = "setting_clock";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;

function addInterval(seconds: number, interval: "month" | "year" = "month"): number {
  const date = new Date(seconds * 1000);
  if (interval === "year") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return Math.floor(date.getTime() / 1000);
}

const intervalOf = (price: Json): "month" | "year" => (price.recurring?.interval === "year" ? "year" : "month");

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function stripeError(status: number, type: string, message: string, code?: string) {
  return json({ error: { type, message, ...(code ? { code } : {}) } }, status);
}

const missing = (what: string, id: string) =>
  stripeError(404, "invalid_request_error", `No such ${what}: '${id}'`, "resource_missing");

const list = (data: unknown[], url: string) => json({ object: "list", data, has_more: false, url });

/**
 * A Stripe that lives inside the Worker, for `pnpm dev` and the tests: it keeps
 * state, answers the part of Stripe's API that billing uses (customers,
 * Checkout, Subscriptions, products, prices with lookup keys), and sends signed
 * events to the app's webhook. Time only moves when a test advances it.
 */
export class FakeStripe {
  private readonly deps: FakeStripeDeps;
  private readonly store: FakeStripeStore;

  constructor(deps: FakeStripeDeps) {
    this.deps = deps;
    this.store = deps.store;
  }

  /** Stripe's clock, in seconds: real time plus what tests advanced. */
  async now(): Promise<number> {
    const clock = await this.store.get<Obj>("setting", CLOCK);
    return Math.floor(Date.now() / 1000) + (clock?.offset ?? 0);
  }

  /** Forgets all state and starts again with the seeded plans. */
  async reset() {
    await this.store.clear();
    await this.seedCatalog();
  }

  /** Answers one request of Stripe's API (`/v1/...`) from the Stripe SDK. */
  async handle(request: Request): Promise<Response> {
    await this.seedCatalog();
    const url = new URL(request.url);
    const path = url.pathname;
    const query = parseForm(url.searchParams);
    const form = request.method === "GET" || request.method === "DELETE" ? {} : parseForm(await request.text());
    await this.store.put("request", { id: id("req"), method: request.method, path, params: { ...query, ...form } });
    if (await this.store.get("setting", FAILING)) {
      return stripeError(500, "api_error", "The fake Stripe was told to fail.");
    }
    const params: Json = { ...query, ...form };
    const route = `${request.method} ${path}`;

    if (route === "POST /v1/customers") return this.createCustomer(params);
    if (route === "GET /v1/customers/search") return list([], path);
    if (route === "GET /v1/customers") {
      const customers = (await this.store.list<Obj>("customer")).filter((c) => !params.email || c.email === params.email);
      return list(customers, path);
    }
    if (route === "GET /v1/products") {
      const products = (await this.store.list<Obj>("product")).filter((p) => params.active === undefined || String(p.active) === params.active);
      return list(products.reverse(), path);
    }
    if (route === "GET /v1/prices") return this.listPrices(params);
    if (route === "POST /v1/checkout/sessions") return this.createSession(params);
    if (route === "GET /v1/subscriptions") {
      const subs = (await this.store.list<Obj>("subscription")).filter(
        (s) => (!params.customer || s.customer === params.customer) && (!params.status || params.status === "all" || s.status === params.status),
      );
      return list(subs, path);
    }
    if (route === "POST /v1/billing_portal/sessions") return this.createPortalSession(params);
    if (route === "GET /v1/subscription_schedules") {
      const schedules = (await this.store.list<Obj>("schedule")).filter((schedule) => !params.customer || schedule.customer === params.customer);
      return list(schedules, path);
    }
    if (route === "POST /v1/subscription_schedules") return this.createSchedule(params);
    const scheduleRoute = /^(GET|POST) \/v1\/subscription_schedules\/([^/]+?)(\/release)?$/.exec(route);
    if (scheduleRoute) {
      const [, method, scheduleId, release] = scheduleRoute as unknown as [string, string, string, string | undefined];
      const schedule = await this.store.get<Obj>("schedule", decodeURIComponent(scheduleId));
      if (!schedule) return missing("subscription schedule", scheduleId);
      if (release) return json(await this.releaseSchedule(schedule));
      if (method === "GET") return json(schedule);
      return json(await this.updateSchedule(schedule, params));
    }
    const cancel = /^DELETE \/v1\/subscriptions\/([^/]+)$/.exec(route);
    if (cancel) {
      const ended = await this.cancel(decodeURIComponent(cancel[1]!));
      return ended ? json(ended) : missing("subscription", cancel[1]!);
    }
    const one = /^(GET|POST) \/v1\/(customers|prices|subscriptions|checkout\/sessions)\/([^/]+)$/.exec(route);
    if (one) {
      const [, method, resource, objectId] = one as unknown as [string, string, string, string];
      const kind = { customers: "customer", prices: "price", subscriptions: "subscription", "checkout/sessions": "checkout" }[resource]!;
      const object = await this.store.get<Obj>(kind, decodeURIComponent(objectId));
      if (!object) return missing(kind.replace("checkout", "checkout session"), objectId);
      if (method === "GET") return json(object);
      const updated = await this.store.put(kind, { ...object, ...(params.metadata ? { metadata: { ...object.metadata, ...params.metadata } } : {}) });
      return json(updated);
    }
    return stripeError(404, "invalid_request_error", `Unrecognized request URL (${request.method}: ${path}).`, "url_invalid");
  }

  private async createCustomer(params: Json) {
    const customer: Obj = {
      id: id("cus"),
      object: "customer",
      email: params.email ?? null,
      name: params.name ?? null,
      metadata: params.metadata ?? {},
      created: await this.now(),
    };
    await this.store.put("customer", customer);
    return json(customer);
  }

  private async listPrices(params: Json) {
    const keys: string[] | undefined = params.lookup_keys && Object.values(params.lookup_keys);
    const prices = (await this.store.list<Obj>("price")).filter(
      (p) =>
        (params.active === undefined || String(p.active) === params.active) &&
        (!params.product || p.product === params.product) &&
        (!keys || keys.includes(p.lookup_key)),
    );
    return list(prices.reverse(), "/v1/prices");
  }

  private async createSession(params: Json) {
    const items: Json[] = Object.values(params.line_items ?? {});
    for (const item of items) {
      if (!(await this.store.get("price", item.price))) return missing("price", item.price);
    }
    const sessionId = id("cs_test");
    const session: Obj = {
      id: sessionId,
      object: "checkout.session",
      mode: params.mode,
      status: "open",
      payment_status: "unpaid",
      customer: params.customer ?? null,
      customer_email: params.customer_email ?? null,
      subscription: null,
      client_reference_id: params.client_reference_id ?? null,
      metadata: params.metadata ?? {},
      subscription_data: params.subscription_data ?? {},
      line_items: items.map((item) => ({ price: item.price, quantity: Number(item.quantity ?? 1) })),
      success_url: params.success_url,
      cancel_url: params.cancel_url,
      url: `${this.deps.origin}${FAKE_STRIPE_PATH}/checkout/${sessionId}`,
      created: await this.now(),
    };
    await this.store.put("checkout", session);
    return json(session);
  }

  /**
   * `POST /v1/billing_portal/sessions`. With the `subscription_update_confirm` flow it keeps what the person is about to
   * change (the Subscription's item, the new price and quantity) and answers the fake confirmation page, where they pay;
   * any other session just points back to the app.
   */
  private async createPortalSession(params: Json) {
    const sessionId = id("bps");
    const confirm = params.flow_data?.type === "subscription_update_confirm" ? params.flow_data.subscription_update_confirm : undefined;
    const returnUrl = params.flow_data?.after_completion?.redirect?.return_url ?? params.return_url;
    if (!confirm) return json({ id: sessionId, object: "billing_portal.session", customer: params.customer, url: params.return_url });
    const sub = await this.store.get<Obj>("subscription", confirm.subscription);
    if (!sub) return missing("subscription", confirm.subscription);
    const items: Json[] = Object.values(confirm.items ?? {});
    for (const item of items) {
      if (!(await this.store.get("price", item.price))) return missing("price", item.price);
    }
    const session: Obj = {
      id: sessionId,
      object: "billing_portal.session",
      customer: params.customer,
      subscription: sub.id,
      items: items.map((item) => ({ id: item.id, price: item.price, quantity: Number(item.quantity ?? 1) })),
      status: "open",
      return_url: returnUrl,
      url: `${this.deps.origin}${FAKE_STRIPE_PATH}/portal/${sessionId}`,
    };
    await this.store.put("portal", session);
    return json(session);
  }

  /** `POST /v1/subscription_schedules` from a Subscription: one phase, the current period, as Stripe makes it. */
  private async createSchedule(params: Json) {
    const sub = await this.store.get<Obj>("subscription", params.from_subscription);
    if (!sub) return missing("subscription", params.from_subscription);
    const item = sub.items.data[0];
    const schedule: Obj = {
      id: id("sub_sched"),
      object: "subscription_schedule",
      customer: sub.customer,
      subscription: sub.id,
      status: "active",
      end_behavior: "release",
      metadata: {},
      phases: [{ start_date: item.current_period_start, end_date: item.current_period_end, items: sub.items.data.map((i: Json) => ({ price: i.price.id, quantity: i.quantity })) }],
      created: await this.now(),
    };
    await this.store.put("schedule", schedule);
    await this.store.put("subscription", { ...sub, schedule: schedule.id });
    return json(schedule);
  }

  /** `POST /v1/subscription_schedules/{id}`: replaces the phases and merges the metadata. */
  private async updateSchedule(schedule: Obj, params: Json) {
    const phases: Json[] = Object.values(params.phases ?? {});
    return this.store.put("schedule", {
      ...schedule,
      ...(params.end_behavior ? { end_behavior: params.end_behavior } : {}),
      metadata: { ...schedule.metadata, ...params.metadata },
      phases: phases.length
        ? phases.map((phase) => ({
            start_date: Number(phase.start_date),
            ...(phase.end_date ? { end_date: Number(phase.end_date) } : {}),
            ...(phase.proration_behavior ? { proration_behavior: phase.proration_behavior } : {}),
            items: Object.values<Json>(phase.items ?? {}).map((item) => ({ price: item.price, quantity: Number(item.quantity ?? 1) })),
          }))
        : schedule.phases,
    });
  }

  /** `POST /v1/subscription_schedules/{id}/release`: the Subscription goes on as it is, with no change waiting. */
  private async releaseSchedule(schedule: Obj) {
    const sub = await this.store.get<Obj>("subscription", schedule.subscription);
    if (sub?.schedule === schedule.id) await this.store.put("subscription", { ...sub, schedule: null });
    return this.store.put("schedule", { ...schedule, status: "released" });
  }

  /** What the confirmation page shows: the change and what is charged for it today. */
  async portalDetails(sessionId: string) {
    const session = await this.store.get<Obj>("portal", sessionId);
    const sub = session && (await this.store.get<Obj>("subscription", session.subscription));
    if (!session || !sub) return undefined;
    const old = sub.items.data[0];
    const next = session.items[0];
    const price = (await this.store.get<Obj>("price", next.price))!;
    const [oldProduct, newProduct] = await Promise.all([this.store.get<Obj>("product", old.price.product), this.store.get<Obj>("product", price.product)]);
    const now = await this.now();
    const span = old.current_period_end - old.current_period_start;
    const remaining = span > 0 ? Math.min(1, Math.max(0, (old.current_period_end - now) / span)) : 0;
    const before = old.price.unit_amount * old.quantity;
    const after = price.unit_amount * next.quantity;
    // A trial is not charged; a new interval starts a new period now, crediting what is left of the old one.
    const due =
      sub.status === "trialing" ? 0 : intervalOf(price) !== intervalOf(old.price) ? Math.max(0, after - Math.round(before * remaining)) : Math.max(0, Math.round((after - before) * remaining));
    return {
      session,
      from: { name: oldProduct?.name ?? "", price: old.price, quantity: old.quantity },
      to: { name: newProduct?.name ?? "", price, quantity: next.quantity },
      due,
      currency: price.currency as string,
    };
  }

  /**
   * The person answers the confirmation page. `pay`: the card is charged and the Subscription changes. `authenticate`:
   * the bank asks for confirmation (3D Secure): nothing changes until `authenticate` (the control) says it passed.
   * `decline`: the card is declined, nothing changes. Answers where the browser goes next, `undefined` for an unknown session.
   */
  async completePortal(sessionId: string, outcome: "pay" | "authenticate" | "decline") {
    const session = await this.store.get<Obj>("portal", sessionId);
    if (!session) return undefined;
    const back = String(session.return_url);
    if (session.status !== "open") return { next: back };
    if (outcome === "decline") return { next: `${this.deps.origin}${FAKE_STRIPE_PATH}/portal/${sessionId}?declined=1` };
    const sub = await this.store.get<Obj>("subscription", session.subscription);
    if (!sub) return undefined;
    if (outcome === "pay") {
      await this.store.put("portal", { ...session, status: "complete" });
      await this.emit("customer.subscription.updated", await this.applyItems(sub, session.items));
    } else {
      await this.store.put("portal", { ...session, status: "requires_action" });
      const pending = await this.store.put("subscription", {
        ...sub,
        pending_update: { subscription_items: session.items, expires_at: (await this.now()) + 23 * 60 * 60 },
      });
      await this.emit("customer.subscription.updated", pending);
    }
    return { next: back };
  }

  /** The bank's confirmation of a pending change: it passes (the change applies) or fails (it is dropped). */
  async authenticate(subscriptionId: string, passes: boolean) {
    const sub = await this.store.get<Obj>("subscription", subscriptionId);
    if (!sub?.pending_update) return undefined;
    const updated = passes
      ? await this.applyItems(sub, sub.pending_update.subscription_items)
      : await this.store.put("subscription", { ...sub, pending_update: null });
    await this.emit("customer.subscription.updated", updated);
    return updated;
  }

  /**
   * Puts the new price and quantity on the Subscription's item. A change of interval starts a new period now (unless
   * the Subscription is in its trial, which goes on).
   */
  private async applyItems(sub: Obj, changes: { price: string; quantity: number }[]) {
    const now = await this.now();
    const old = sub.items.data[0];
    const change = changes[0]!;
    const price = (await this.store.get<Obj>("price", change.price))!;
    const restarts = intervalOf(price) !== intervalOf(old.price) && sub.status !== "trialing";
    const item = {
      ...old,
      price,
      quantity: Number(change.quantity),
      ...(restarts ? { current_period_start: now, current_period_end: addInterval(now, intervalOf(price)) } : {}),
    };
    return this.store.put("subscription", { ...sub, pending_update: null, items: { ...sub.items, data: [item] } });
  }

  /** What the Checkout page shows: the session, the products and prices it charges. */
  async checkoutDetails(sessionId: string) {
    const session = await this.store.get<Obj>("checkout", sessionId);
    if (!session) return undefined;
    const lines = [];
    for (const line of session.line_items as { price: string; quantity: number }[]) {
      const price = await this.store.get<Obj>("price", line.price);
      const product = price && (await this.store.get<Obj>("product", price.product));
      if (price && product) lines.push({ product, price, quantity: line.quantity });
    }
    return { session, lines };
  }

  /**
   * The person pays or the card is declined. Paying creates the Subscription
   * and sends Stripe's events; a decline changes nothing but the page. Answers
   * where the browser goes next, `undefined` for an unknown session.
   */
  async completeCheckout(sessionId: string, outcome: "pay" | "decline") {
    const session = await this.store.get<Obj>("checkout", sessionId);
    if (!session) return undefined;
    if (session.status === "complete") return { declined: false, next: this.successUrl(session) };
    if (outcome === "decline") {
      await this.store.put("checkout", { ...session, last_payment_error: "card_declined" });
      return { declined: true, next: `${this.deps.origin}${FAKE_STRIPE_PATH}/checkout/${sessionId}?declined=1` };
    }
    let customerId: string | null = session.customer;
    if (!customerId) {
      const customer: Obj = { id: id("cus"), object: "customer", email: session.customer_email, name: null, metadata: {}, created: await this.now() };
      await this.store.put("customer", customer);
      customerId = customer.id;
    }
    const now = await this.now();
    const trialDays = Number(session.subscription_data.trial_period_days ?? 0);
    const trialEnd = trialDays > 0 ? now + trialDays * 24 * 60 * 60 : null;
    const items = [];
    for (const line of session.line_items as { price: string; quantity: number }[]) {
      const price = (await this.store.get<Obj>("price", line.price))!;
      items.push({ id: id("si"), object: "subscription_item", price, quantity: line.quantity, current_period_start: now, current_period_end: trialEnd ?? addInterval(now, intervalOf(price)) });
    }
    const subscription: Obj = {
      id: id("sub"),
      object: "subscription",
      customer: customerId,
      status: trialEnd ? "trialing" : "active",
      metadata: session.subscription_data.metadata ?? {},
      items: { object: "list", data: items, has_more: false, url: "/v1/subscription_items" },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      trial_start: trialEnd ? now : null,
      trial_end: trialEnd,
      schedule: null,
      created: now,
    };
    await this.store.put("subscription", subscription);
    const completed = await this.store.put("checkout", { ...session, customer: customerId, status: "complete", payment_status: "paid", subscription: subscription.id });
    await this.emit("customer.subscription.created", subscription);
    await this.emit("checkout.session.completed", completed);
    return { declined: false, next: this.successUrl(completed) };
  }

  private successUrl(session: Obj): string {
    return String(session.success_url).replaceAll("{CHECKOUT_SESSION_ID}", session.id);
  }

  /** Sends a signed event to the app's webhook, as Stripe does; answers the webhook's status. */
  async emit(type: string, object: unknown): Promise<number> {
    const event = { id: id("evt"), object: "event", api_version: "fake", created: await this.now(), livemode: false, pending_webhooks: 1, type, data: { object } };
    await this.store.put("event", event);
    const payload = JSON.stringify(event);
    const response = await this.deps.deliver(
      new Request(`${this.deps.origin}/api/auth/stripe/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": await stripeSignature(this.deps.webhookSecret, payload) },
        body: payload,
      }),
    );
    await response.arrayBuffer();
    return response.status;
  }

  /**
   * Moves Stripe's clock forward and lets every Subscription whose period ended
   * renew (or end, when it was set to cancel at the period's end). A trial ends
   * the same way, with the first charge, and sends `trial_will_end` once its end
   * is 3 days away. With
   * `paymentFails` the renewals fail instead and the Subscriptions go past due.
   */
  async advance(seconds: number, { paymentFails = false }: { paymentFails?: boolean } = {}) {
    const clock = await this.store.get<Obj>("setting", CLOCK);
    await this.store.put("setting", { id: CLOCK, offset: (clock?.offset ?? 0) + seconds });
    const now = await this.now();
    for (let sub of await this.store.list<Obj>("subscription")) {
      if (!["active", "trialing", "past_due"].includes(sub.status)) continue;
      if (sub.status === "trialing" && !sub.trial_warned && sub.trial_end - TRIAL_WARNING <= now) {
        sub = await this.store.put("subscription", { ...sub, trial_warned: true });
        await this.emit("customer.subscription.trial_will_end", sub);
      }
      const item = sub.items.data[0];
      if (!item || item.current_period_end > now) continue;
      const schedule = sub.schedule ? await this.store.get<Obj>("schedule", sub.schedule) : undefined;
      const next = schedule?.status === "active" ? schedule.phases[1] : undefined;
      if (next && !sub.cancel_at_period_end && !paymentFails) {
        // The scheduled change starts with the new period: the paid one ran out.
        const items = [];
        for (const line of next.items as { price: string; quantity: number }[]) {
          const price = (await this.store.get<Obj>("price", line.price))!;
          items.push({ id: id("si"), object: "subscription_item", price, quantity: line.quantity, current_period_start: next.start_date, current_period_end: addInterval(next.start_date, intervalOf(price)) });
        }
        await this.store.put("schedule", { ...schedule!, status: "completed" });
        await this.emit("customer.subscription.updated", await this.store.put("subscription", { ...sub, status: "active", schedule: null, items: { ...sub.items, data: items } }));
        continue;
      }
      if (sub.cancel_at_period_end) {
        const ended = await this.store.put("subscription", { ...sub, status: "canceled", ended_at: now, canceled_at: sub.canceled_at ?? now });
        await this.emit("customer.subscription.deleted", ended);
      } else if (paymentFails) {
        await this.emit("customer.subscription.updated", await this.store.put("subscription", { ...sub, status: "past_due" }));
      } else {
        const items = sub.items.data.map((i: Json) => ({ ...i, current_period_start: i.current_period_end, current_period_end: addInterval(i.current_period_end, intervalOf(i.price)) }));
        await this.emit("customer.subscription.updated", await this.store.put("subscription", { ...sub, status: "active", items: { ...sub.items, data: items } }));
      }
    }
  }

  /**
   * Ends every live Subscription of the customers with this email at once, as Stripe does when a person cancels or a
   * payment is given up on, and sends each `customer.subscription.deleted`. Answers how many it ended.
   */
  async endSubscriptions(email: string) {
    const customers = new Set((await this.store.list<Obj>("customer")).filter((c) => c.email === email).map((c) => c.id));
    const now = await this.now();
    let ended = 0;
    for (const sub of await this.store.list<Obj>("subscription")) {
      if (!customers.has(sub.customer) || !["active", "trialing", "past_due"].includes(sub.status)) continue;
      const gone = await this.store.put("subscription", { ...sub, status: "canceled", ended_at: now, canceled_at: sub.canceled_at ?? now });
      await this.emit("customer.subscription.deleted", gone);
      ended += 1;
    }
    return ended;
  }

  /** The customer asked to cancel: the Subscription stays active until its period ends (what the Billing Portal does). */
  async cancelAtPeriodEnd(subscriptionId: string) {
    const sub = await this.store.get<Obj>("subscription", subscriptionId);
    if (!sub) return undefined;
    const now = await this.now();
    const periodEnd = sub.items.data[0]?.current_period_end ?? now;
    const updated = await this.store.put("subscription", { ...sub, cancel_at_period_end: true, cancel_at: periodEnd, canceled_at: now });
    await this.emit("customer.subscription.updated", updated);
    return updated;
  }

  /** The Subscription ends now, whatever days are left (Stripe's `DELETE /v1/subscriptions/{id}`). */
  async cancel(subscriptionId: string) {
    const sub = await this.store.get<Obj>("subscription", subscriptionId);
    if (!sub) return undefined;
    if (sub.status === "canceled") return sub;
    const now = await this.now();
    const ended = await this.store.put("subscription", { ...sub, status: "canceled", ended_at: now, canceled_at: sub.canceled_at ?? now });
    await this.emit("customer.subscription.deleted", ended);
    return ended;
  }

  /** The Subscriptions as Stripe holds them: their id, status and whether they cancel at the period's end. */
  async subscriptions(): Promise<{ id: string; status: string; cancelAtPeriodEnd: boolean }[]> {
    const all = await this.store.list<Obj>("subscription");
    return all.map((sub) => ({ id: sub.id, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end }));
  }

  /** Merges `metadata` into a product, as an operator editing a Plan in the dashboard. Answers whether the product exists. */
  async patchProduct(productId: string, metadata: Record<string, string>) {
    await this.seedCatalog();
    const product = await this.store.get<Obj>("product", productId);
    if (!product) return false;
    await this.store.put("product", { ...product, metadata: { ...product.metadata, ...metadata } });
    return true;
  }

  async setFailing(on: boolean) {
    if (on) await this.store.put("setting", { id: FAILING });
    else await this.store.remove("setting", FAILING);
  }

  /** The Stripe API calls the app made (`GET /v1/products`, ...), oldest first. */
  async requests(): Promise<{ method: string; path: string }[]> {
    const calls = await this.store.list<Obj>("request");
    return calls.reverse().map(({ method, path }) => ({ method, path }));
  }

  /** The plans the fake starts with: Free (no price, 1 Seat), Pro and Team (fixed, monthly), with `reports` and `projects` Entitlements. */
  private async seedCatalog() {
    // The last thing seeded is the marker, so a concurrent request never reads a half-seeded catalog.
    if (await this.store.get("price", "price_fake_team_yearly")) return;
    const { productId, seed } = this.deps;
    const created = Math.floor(Date.now() / 1000);
    const plans = [
      { key: "free", seats: 1, amount: null, yearly: null, reports: "false", projects: "1" },
      { key: "pro", seats: 3, amount: 1900, yearly: 19000, reports: "true", projects: "5" },
      { key: "team", seats: 10, amount: 4900, yearly: 49000, reports: "true", projects: "20" },
    ] as const;
    for (const plan of plans) {
      const product: Obj = {
        id: `prod_fake_${plan.key}`,
        object: "product",
        active: true,
        name: seed[plan.key].name,
        description: seed[plan.key].description,
        metadata: { productId, kind: plan.amount === null ? "free" : "fixed", seats: String(plan.seats), entitlement_reports: plan.reports, entitlement_projects: plan.projects },
        created,
      };
      await this.store.put("product", product);
      if (plan.amount === null) continue;
      for (const [interval, amount] of [["month", plan.amount], ["year", plan.yearly]] as const) {
        await this.store.put("price", {
          id: `price_fake_${plan.key}_${interval === "year" ? "yearly" : "monthly"}`,
          object: "price",
          active: true,
          product: product.id,
          currency: CURRENCY,
          unit_amount: amount,
          lookup_key: `${productId}_${plan.key}_${interval === "year" ? "yearly" : "monthly"}`,
          nickname: null,
          type: "recurring",
          recurring: { interval, interval_count: 1, usage_type: "licensed" },
          metadata: {},
          created,
        });
      }
    }
  }
}
