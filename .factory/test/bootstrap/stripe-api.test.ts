import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeApi, WEBHOOK_EVENTS } from "../../src/bootstrap/stripe.ts";

type Obj = Record<string, any>;

/** Nested form fields (`metadata[productId]=x`, `recurring[interval]=month`, `lookup_keys[0]=k`) as an object. */
function parseForm(body: string): Obj {
  const out: Obj = {};
  for (const [name, value] of new URLSearchParams(body)) {
    const path = name.replace(/\]/g, "").split("[");
    let at = out;
    path.slice(0, -1).forEach((part) => (at = at[part] ??= {}));
    at[path.at(-1)!] = value;
  }
  return out;
}

/** A Stripe API in memory behind the SDK's HTTP client: the part of `/v1` the bootstrap calls, with Stripe's list shape and errors. */
class FakeStripeApi {
  readonly products: Obj[] = [];
  readonly prices: Obj[] = [];
  readonly portals: Obj[] = [];
  readonly webhooks: Obj[] = [];
  readonly subscriptions: Obj[] = [];
  readonly schedules: Obj[] = [];
  readonly scheduleUpdates: Obj[] = [];
  readonly methods: Obj[] = [{ id: "pmc_1", is_default: true, card: { display_preference: { preference: "on" } }, apple_pay: { display_preference: { preference: "off" } }, google_pay: { display_preference: { preference: "off" } } }];
  readonly calls: string[] = [];
  /** Resources whose reads the key is refused. */
  denied = new Set<string>();
  private next = 0;

  readonly fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = new URL(String(url));
    const method = init?.method ?? "GET";
    const path = target.pathname.replace("/v1/", "");
    this.calls.push(`${method} ${path}`);
    const params: Obj = method === "GET" || method === "DELETE" ? parseForm(target.search.slice(1)) : parseForm(String(init?.body ?? ""));
    const resource = path.split("/")[0]!;
    if (this.denied.has(path)) {
      return Response.json({ error: { type: "invalid_request_error", message: `The provided key does not have the required permissions for this endpoint. Having the 'rak_${path.replace(/\//g, "_").replace(/s$/, "")}_read' permission would allow this request to continue.` } }, { status: 403 });
    }
    const list = (data: Obj[]) => Response.json({ object: "list", data, has_more: false, url: `/v1/${path}` });
    const make = (kind: string, fields: Obj) => ({ id: `${kind}_${++this.next}`, ...fields });
    if (method === "GET") {
      if (path === "products") return list(this.products.filter((p) => params.active === undefined || String(p.active) === params.active));
      if (path === "prices") {
        const keys = params.lookup_keys ? Object.values(params.lookup_keys) : undefined;
        return list(this.prices.filter((p) => (!keys || keys.includes(p.lookup_key)) && (params.active === undefined || String(p.active) === params.active)));
      }
      if (path === "subscriptions") return list(this.subscriptions.filter((sub) => !params.price || sub.items.data.some((item: Obj) => item.price.id === params.price)));
      if (resource === "subscriptions") return Response.json(this.subscriptions.find((sub) => path.endsWith(sub.id)));
      if (path === "billing_portal/configurations") return list(this.portals);
      if (path === "webhook_endpoints") return list(this.webhooks);
      if (path === "payment_method_configurations") return list(this.methods);
      return list([]);
    }
    if (method === "POST" && path === "products") {
      const product = make("prod", { object: "product", active: true, name: params.name, metadata: params.metadata ?? {} });
      this.products.push(product);
      return Response.json(product);
    }
    if (method === "POST" && path === "prices") {
      if (params.transfer_lookup_key === "true") for (const old of this.prices) if (old.lookup_key === params.lookup_key) old.lookup_key = null;
      const price = make("price", { object: "price", active: true, product: params.product, currency: params.currency, unit_amount: Number(params.unit_amount), lookup_key: params.lookup_key, nickname: params.nickname, recurring: params.recurring });
      this.prices.push(price);
      return Response.json(price);
    }
    if (method === "POST" && (resource === "prices" || resource === "products") && path.includes("/")) {
      const found = [...this.prices, ...this.products].find((object) => path.endsWith(object.id as string))!;
      Object.assign(found, { active: params.active === "true" });
      return Response.json(found);
    }
    if (method === "POST" && path === "subscription_schedules") {
      const sub = this.subscriptions.find((candidate) => candidate.id === params.from_subscription)!;
      const schedule = make("sub_sched", { object: "subscription_schedule", subscription: sub.id, phases: [{ start_date: 1000, end_date: sub.items.data[0].current_period_end, trial_end: null, items: sub.items.data.map((item: Obj) => ({ price: item.price.id, quantity: item.quantity })) }] });
      this.schedules.push(schedule);
      return Response.json(schedule);
    }
    if (method === "POST" && path.startsWith("subscription_schedules/")) {
      this.scheduleUpdates.push(params);
      return Response.json(this.schedules[0]);
    }
    if (method === "POST" && path === "billing_portal/configurations") {
      const portal = make("bpc", { object: "billing_portal.configuration", metadata: params.metadata ?? {}, features: params.features });
      this.portals.push(portal);
      return Response.json(portal);
    }
    if (method === "POST" && path.startsWith("billing_portal/configurations/")) {
      const found = this.portals.find((portal) => path.endsWith(portal.id as string))!;
      Object.assign(found, { active: params.active === "true" });
      return Response.json(found);
    }
    if (method === "POST" && path === "webhook_endpoints") {
      const hook = make("we", { object: "webhook_endpoint", url: params.url, metadata: params.metadata ?? {}, enabled_events: Object.values(params.enabled_events), secret: `whsec_${this.next}` });
      this.webhooks.push(hook);
      return Response.json(hook);
    }
    if (method === "POST" && resource === "payment_method_configurations") {
      const found = this.methods.find((m) => path.endsWith(m.id))!;
      for (const method of ["card", "apple_pay", "google_pay"]) if (params[method]) found[method] = { display_preference: { preference: params[method].display_preference.preference } };
      return Response.json(found);
    }
    if (method === "DELETE" && resource === "webhook_endpoints") {
      const at = this.webhooks.findIndex((hook) => path.endsWith(hook.id));
      if (at >= 0) this.webhooks.splice(at, 1);
      return Response.json({ id: path.split("/")[1], object: "webhook_endpoint", deleted: true });
    }
    return Response.json({ error: { type: "invalid_request_error", message: `Unrecognized request URL (${method} /v1/${path})` } }, { status: 404 });
  };
}

function client() {
  const stripe = new FakeStripeApi();
  return { stripe, api: new StripeApi("rk_test_fake", { httpClient: Stripe.createFetchHttpClient(stripe.fetch) }) };
}

const PRO = { key: "pro", name: "Pro", kind: "fixed" as const, seats: 3, trialDays: 7, currency: "usd", prices: [{ lookupKey: "example_pro_monthly", amount: 1900, interval: "month" as const }, { lookupKey: "example_pro_yearly", amount: 18240, interval: "year" as const }] };

describe("StripeApi against a fake Stripe", () => {
  it("creates a plan's product with the metadata the Skeleton reads, and its prices with the lookup key", async () => {
    const { stripe, api } = client();

    const result = await api.ensurePlan("example", PRO);

    expect(result).toEqual({ created: ["product pro", "price example_pro_monthly", "price example_pro_yearly"], different: [], replaced: [] });
    expect(stripe.products[0]).toMatchObject({ name: "Pro", metadata: { productId: "example", kind: "fixed", seats: "3", plan: "pro", trial_days: "7" } });
    expect(stripe.prices.map((p) => [p.lookup_key, p.nickname, p.unit_amount, p.recurring.interval, p.currency])).toEqual([
      ["example_pro_monthly", "example_pro_monthly", 1900, "month", "usd"],
      ["example_pro_yearly", "example_pro_yearly", 18240, "year", "usd"],
    ]);
  });

  it("creates nothing the second time, and leaves a price with another amount alone", async () => {
    const { stripe, api } = client();
    await api.ensurePlan("example", PRO);
    const calls = stripe.calls.filter((c) => c.startsWith("POST")).length;

    expect(await api.ensurePlan("example", PRO)).toEqual({ created: [], different: [], replaced: [] });
    expect(await api.ensurePlan("example", { ...PRO, prices: [{ lookupKey: "example_pro_monthly", amount: 2500, interval: "month" }] })).toEqual({ created: [], different: ["example_pro_monthly"], replaced: [] });

    expect(stripe.calls.filter((c) => c.startsWith("POST")).length).toBe(calls);
  });

  it("replaces a price with another amount: the new one takes the lookup key and the old one is archived", async () => {
    const { stripe, api } = client();
    await api.ensurePlan("example", PRO);
    const [oldMonthly] = stripe.prices;

    const result = await api.ensurePlan("example", { ...PRO, prices: [{ lookupKey: "example_pro_monthly", amount: 2500, interval: "month" }] }, { replace: true });

    expect(result).toEqual({ created: [], different: [], replaced: ["example_pro_monthly"] });
    expect(oldMonthly).toMatchObject({ active: false, lookup_key: null, nickname: "example_pro_monthly", unit_amount: 1900 });
    const created = stripe.prices.at(-1)!;
    expect(created).toMatchObject({ active: true, lookup_key: "example_pro_monthly", nickname: "example_pro_monthly", unit_amount: 2500 });
    expect(stripe.calls).toContain(`POST prices/${oldMonthly!.id}`);
  });

  it("archives the plans the answers no longer list, with their prices, and only those of the Product", async () => {
    const { stripe, api } = client();
    await api.ensurePlan("example", PRO);
    await api.ensurePlan("example", { ...PRO, key: "team", name: "Team", prices: [] });
    stripe.products.push({ id: "prod_other", active: true, name: "Other", metadata: { productId: "another", plan: "pro" } });
    stripe.prices.forEach((price) => (price.product = stripe.products[0]!.id));

    expect(await api.archivePlansExcept("example", ["team"])).toEqual(["pro"]);

    expect(stripe.products.map((product) => [product.name, product.active])).toEqual([["Pro", false], ["Team", true], ["Other", true]]);
    expect(stripe.prices.every((price) => price.active === false)).toBe(true);
  });

  describe("price migrations", () => {
    async function repriced() {
      const { stripe, api } = client();
      await api.ensurePlan("example", PRO);
      const oldId = stripe.prices[0]!.id as string;
      await api.ensurePlan("example", { ...PRO, prices: [{ lookupKey: "example_pro_monthly", amount: 2500, interval: "month" }] }, { replace: true });
      const subscription = (id: string, status: string, schedule: string | null = null) => ({ id, status, schedule, metadata: { userId: "u1", productId: "example" }, items: { data: [{ price: { id: oldId }, quantity: 2, current_period_end: 1_900_000_000 }] } });
      stripe.subscriptions.push(subscription("sub_a", "active"), subscription("sub_c", "canceled"), subscription("sub_s", "active", "sub_sched_x"));
      return { stripe, api, oldId, newId: stripe.prices.at(-1)!.id as string };
    }

    it("lists the live Subscriptions still on the old price, with no schedule", async () => {
      const { api, oldId, newId } = await repriced();

      expect(await api.listPriceMigrations("example")).toEqual([
        { subscriptionId: "sub_a", lookupKey: "example_pro_monthly", fromPriceId: oldId, toPriceId: newId, oldAmount: 1900, newAmount: 2500, currency: "usd", renewsAt: 1_900_000_000 },
      ]);
    });

    it("schedules the new price after the current period, with no proration, keeping the Subscription's metadata and quantity", async () => {
      const { stripe, api, oldId, newId } = await repriced();
      const [migration] = await api.listPriceMigrations("example");

      await api.schedulePriceMigration(migration!);

      expect(stripe.scheduleUpdates).toHaveLength(1);
      expect(stripe.scheduleUpdates[0]).toMatchObject({
        end_behavior: "release",
        proration_behavior: "none",
        metadata: { userId: "u1", productId: "example", priceChange: "true" },
        phases: {
          "0": { start_date: "1000", end_date: "1900000000", items: { "0": { price: oldId, quantity: "2" } } },
          "1": { proration_behavior: "none", items: { "0": { price: newId, quantity: "2" } } },
        },
      });
    });
  });

  it("reads the plans back, only those of the Product", async () => {
    const { stripe, api } = client();
    await api.ensurePlan("example", PRO);
    stripe.products.push({ id: "prod_other", active: true, name: "Other", metadata: { productId: "another", plan: "x" } });

    expect(await api.listPlans("example")).toEqual([
      { key: "pro", name: "Pro", kind: "fixed", seats: 3, prices: [{ lookupKey: "example_pro_monthly", amount: 1900, currency: "usd", interval: "month" }, { lookupKey: "example_pro_yearly", amount: 18240, currency: "usd", interval: "year" }] },
    ]);
  });

  it("turns card, Apple Pay and Google Pay on once", async () => {
    const { stripe, api } = client();

    expect(await api.ensurePaymentMethods()).toBe("updated");
    expect(["card", "apple_pay", "google_pay"].map((m) => stripe.methods[0]![m].display_preference.preference)).toEqual(["on", "on", "on"]);
    expect(await api.ensurePaymentMethods()).toBe("unchanged");
  });

  it("makes the Customer Portal configuration once", async () => {
    const { stripe, api } = client();

    expect(await api.ensurePortal("example")).toBe("created");
    expect(await api.ensurePortal("example")).toBe("unchanged");

    expect(stripe.portals).toHaveLength(1);
    expect(stripe.portals[0]!.features.payment_method_update.enabled).toBe("true");
  });

  it("creates the events endpoint with its secret, lists it and deletes it", async () => {
    const { stripe, api } = client();

    const made = await api.createWebhook("example", "https://example.com/api/auth/stripe/webhook");

    expect(made.secret).toMatch(/^whsec_/);
    expect(stripe.webhooks[0]!.enabled_events).toContain("customer.subscription.updated");
    expect(await api.listWebhooks("example")).toEqual([{ id: made.id, url: "https://example.com/api/auth/stripe/webhook", events: WEBHOOK_EVENTS }]);
    expect(await api.listWebhooks("another")).toEqual([]);
    await api.deleteWebhook(made.id);
    expect(stripe.webhooks).toEqual([]);
  });

  it("names the permissions a key lacks, as Stripe's refusal does", async () => {
    const { stripe, api } = client();
    expect(await api.missingPermissions()).toEqual([]);

    stripe.denied.add("webhook_endpoints");
    stripe.denied.add("products");

    expect(await api.missingPermissions()).toEqual(["rak_product_read", "rak_webhook_endpoint_read"]);
  });

  it("falls back to the expected permission name when the refusal names none", async () => {
    const { stripe } = client();
    stripe.denied.add("prices");
    const original = stripe.fetch;
    const api2 = new StripeApi("rk_test_fake", {
      httpClient: Stripe.createFetchHttpClient(async (url, init) => {
        const response = await original(url, init);
        return response.status === 403 ? Response.json({ error: { type: "invalid_request_error", message: "No permission." } }, { status: 403 }) : response;
      }),
    });

    expect(await api2.missingPermissions()).toEqual(["rak_plan_write"]);
  });

  it("tries a portal write and names the permission Stripe asks for when it is refused", async () => {
    const { stripe, api } = client();
    expect(await api.missingPermissions()).toEqual([]);
    expect(stripe.calls).toContain("POST billing_portal/configurations");
    expect(stripe.portals).toHaveLength(1);
    expect(stripe.portals[0]!.active).toBe(false);

    stripe.denied.add("billing_portal/configurations");

    expect(await api.missingPermissions()).toEqual(["rak_billing_portal_configuration_read"]);
  });

  it("lets any other failure through instead of calling it a missing permission", async () => {
    const api = new StripeApi("rk_test_fake", { httpClient: Stripe.createFetchHttpClient(async () => Response.json({ error: { type: "api_error", message: "boom" } }, { status: 500 })) });

    await expect(api.missingPermissions()).rejects.toThrow(/boom/);
  });
});
