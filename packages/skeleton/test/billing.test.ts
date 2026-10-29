import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { stripeSignature } from "../src/features/billing/fake-stripe/sign.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import type { McpTool } from "../src/platform/mcp/tool.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 3: billing over HTTP, on the fake Stripe that runs inside the Worker.

const WEBHOOK_SECRET = "whsec_test";
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let withoutKey: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({
    databaseUrl: db.url,
    vars: { STRIPE_FAKE: "true", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
  });
  withoutKey = await startTestWorker({ databaseUrl: db.url });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  await withoutKey?.close();
  await db?.drop();
});
beforeEach(async () => {
  await worker.post("/api/fake-stripe/control/reset", {});
});

async function signedInUser() {
  const user = await testAuth.saveUser(
    testAuth.createUser({ name: "Ana Souza", email: `user-${randomUUID()}@example.com`, emailVerified: true }),
  );
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, cookie: headers.get("cookie")! };
}

type PlanState = {
  plan: { id: string; name: string; kind: string; seats: number | null; price: { amount: number } | null; entitlements: Record<string, unknown> } | null;
  subscription: { status: string; periodEnd: string } | null;
  plans: { id: string; name: string }[];
};

async function currentPlan(cookie: string) {
  const response = await worker.fetch("/api/billing/plan", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as PlanState;
}

/** Opens Checkout for `plan`; answers the path of the fake Checkout page. */
async function openCheckout(cookie: string, plan: string) {
  const response = await worker.post("/api/billing/subscribe", { plan }, { cookie });
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const page = new URL(url);
  expect(page.origin).toBe(worker.origin);
  return page.pathname;
}

const pathOf = (location: string | null) => {
  const url = new URL(location!);
  return `${url.pathname}${url.search}`;
};

test("a person without a Subscription is on the free Plan, read from Stripe", async () => {
  const { cookie } = await signedInUser();

  const state = await currentPlan(cookie);

  expect(state.plan).toMatchObject({ name: "Free", kind: "free", seats: 1, price: null, entitlements: { reports: false, projects: false } });
  expect(state.subscription).toBeNull();
  expect(state.plans.map((plan) => plan.name)).toEqual(["Free", "Pro", "Team"]);
});

test("subscribing goes through Checkout, and Stripe's event turns the person's Plan into the new one", async () => {
  const { cookie } = await signedInUser();

  const checkout = await openCheckout(cookie, "prod_fake_pro");
  const page = await worker.fetch(checkout, { headers: { accept: "text/html" } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('data-testid="fake-checkout-pay"');
  const paid = await worker.fetch(`${checkout}/pay`, { method: "POST", redirect: "manual" });

  // The event already moved the Plan; the redirect back only closes the Checkout.
  expect(paid.status).toBe(303);
  expect(await currentPlan(cookie)).toMatchObject({ plan: { name: "Pro", seats: 3, price: { amount: 1900 } }, subscription: { status: "active" } });
  const back = await worker.fetch(pathOf(paid.headers.get("location")), { headers: { cookie }, redirect: "manual" });
  expect(new URL(back.headers.get("location")!).pathname).toBe("/account/plan");
  expect((await currentPlan(cookie)).plan?.name).toBe("Pro");
});

test("a declined payment in Checkout leaves the Plan as it was", async () => {
  const { cookie } = await signedInUser();
  const checkout = await openCheckout(cookie, "prod_fake_pro");

  const declined = await worker.fetch(`${checkout}/decline`, { method: "POST", redirect: "manual" });

  expect(declined.status).toBe(303);
  const page = await worker.fetch(pathOf(declined.headers.get("location")));
  expect(await page.text()).toContain('data-testid="fake-checkout-declined"');
  expect(await currentPlan(cookie)).toMatchObject({ plan: { name: "Free" }, subscription: null });
});

test("every customer and Subscription carries the Product's id", async () => {
  const { cookie } = await signedInUser();
  const checkout = await openCheckout(cookie, "prod_fake_pro");
  await worker.fetch(`${checkout}/pay`, { method: "POST", redirect: "manual" });

  const [customer] = await db.query<{ metadata: Record<string, string> }>(`select body->'metadata' as metadata from skeleton.fake_stripe where kind = 'customer'`);
  const [subscription] = await db.query<{ metadata: Record<string, string> }>(`select body->'metadata' as metadata from skeleton.fake_stripe where kind = 'subscription'`);

  expect(customer?.metadata).toMatchObject({ productId: "skeleton-test" });
  expect(subscription?.metadata).toMatchObject({ productId: "skeleton-test" });
});

test("the Plans are read from Stripe once in five minutes", async () => {
  const { cookie } = await signedInUser();

  await currentPlan(cookie);
  await currentPlan(cookie);
  await currentPlan((await signedInUser()).cookie);

  const { requests } = (await (await worker.fetch("/api/fake-stripe/control/requests")).json()) as { requests: { method: string; path: string }[] };
  expect(requests.filter((call) => call.path === "/v1/products")).toHaveLength(1);
  expect(requests.filter((call) => call.path === "/v1/prices")).toHaveLength(1);
});

test("an event about another Product's Subscription is ignored, one about this Product's is applied", async () => {
  const { user, cookie } = await signedInUser();
  const checkout = await openCheckout(cookie, "prod_fake_pro");
  await worker.fetch(`${checkout}/pay`, { method: "POST", redirect: "manual" });
  const [row] = await db.query<{ stripe_subscription_id: string }>(`select stripe_subscription_id from skeleton.subscriptions where reference_id = '${user.id}'`);
  const deleted = (productId: string) => ({
    type: "customer.subscription.deleted",
    object: { id: row!.stripe_subscription_id, object: "subscription", status: "canceled", metadata: { productId }, items: { data: [] } },
  });

  const foreign = await worker.post("/api/fake-stripe/control/events", deleted("another-product"));

  expect(await foreign.json()).toEqual({ webhookStatus: 200 });
  expect((await currentPlan(cookie)).plan?.name).toBe("Pro");
  await worker.post("/api/fake-stripe/control/events", deleted("skeleton-test"));
  expect(await currentPlan(cookie)).toMatchObject({ plan: { name: "Free" }, subscription: null });
});

test("a webhook call with an invalid signature is refused, a valid one is accepted", async () => {
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.updated", created: 1, data: { object: { id: "cus_1", metadata: {} } } });
  const call = (signature: string) =>
    worker.fetch("/api/auth/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });

  const forged = await call(await stripeSignature("whsec_somebody_else", payload));
  const missing = await call("");
  const valid = await call(await stripeSignature(WEBHOOK_SECRET, payload));

  expect(forged.status).toBe(400);
  expect(missing.status).toBe(400);
  expect(valid.status).toBe(200);
});

test("when Stripe fails, reading the Plan answers 502 BILLING_UNAVAILABLE", async () => {
  const { cookie } = await signedInUser();
  await worker.post("/api/fake-stripe/control/fail", { on: true });

  const response = await worker.fetch("/api/billing/plan", { headers: { cookie } });

  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ code: "BILLING_UNAVAILABLE" });
});

test("advancing Stripe's clock renews the Subscription and the period moves on", async () => {
  const { cookie } = await signedInUser();
  const checkout = await openCheckout(cookie, "prod_fake_pro");
  await worker.fetch(`${checkout}/pay`, { method: "POST", redirect: "manual" });
  const before = await currentPlan(cookie);

  await worker.post("/api/fake-stripe/control/advance", { seconds: 40 * 24 * 60 * 60 });
  const after = await currentPlan(cookie);

  expect(after.subscription).toMatchObject({ status: "active" });
  expect(Date.parse(after.subscription!.periodEnd)).toBeGreaterThan(Date.parse(before.subscription!.periodEnd));
});

test("a person who already has a Subscription cannot subscribe again", async () => {
  const { cookie } = await signedInUser();
  const checkout = await openCheckout(cookie, "prod_fake_pro");
  await worker.fetch(`${checkout}/pay`, { method: "POST", redirect: "manual" });

  const response = await worker.post("/api/billing/subscribe", { plan: "prod_fake_team" }, { cookie });

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "ALREADY_SUBSCRIBED" });
});

test("only a fixed Plan of this Product can be subscribed to", async () => {
  const { cookie } = await signedInUser();

  for (const plan of ["prod_fake_free", "prod_unknown"]) {
    const response = await worker.post("/api/billing/subscribe", { plan }, { cookie });
    expect(response.status).toBe(404);
  }
  expect((await worker.post("/api/billing/subscribe", {}, { cookie })).status).toBe(400);
  expect((await worker.post("/api/billing/subscribe", { plan: "prod_fake_pro" })).status).toBe(401);
});

test("without a Stripe key (or the fake) no billing route answers and the account page links to no Plan page", async () => {
  const user = await testAuth.saveUser(testAuth.createUser({ name: "Ana", email: `user-${randomUUID()}@example.com`, emailVerified: true }));
  const cookie = (await testAuth.getAuthHeaders({ userId: user.id })).get("cookie")!;
  const routes: [string, string][] = [
    ["GET", "/api/billing/plan"],
    ["POST", "/api/billing/subscribe"],
    ["POST", "/api/auth/stripe/webhook"],
    ["GET", "/api/auth/subscription/list"],
    ["POST", "/api/auth/subscription/upgrade"],
    ["GET", "/api/fake-stripe/control/requests"],
  ];

  for (const [method, path] of routes) {
    const response = await withoutKey.fetch(path, { method, headers: { cookie, "content-type": "application/json", origin: withoutKey.origin }, body: method === "POST" ? "{}" : undefined });
    expect(response.status, `${method} ${path}`).toBe(404);
  }
  const nav = (await (await withoutKey.fetch("/api/nav", { headers: { cookie } })).json()) as { accountPage: unknown[] };
  expect(nav.accountPage).toEqual([]);
  const withKey = (await (await worker.fetch("/api/nav", { headers: { cookie } })).json()) as { accountPage: unknown[] };
  expect(withKey.accountPage).toEqual([{ label: "Plan", to: "/account/plan" }]);
});

test("reading the Plan is an MCP tool; subscribing and opening Checkout are not", async () => {
  const tools = JSON.parse(readFileSync(new URL("./worker/mcp-tools.gen.json", import.meta.url), "utf8")) as McpTool[];
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as { paths: Record<string, Record<string, Record<string, unknown>>> };

  expect(tools.map((tool) => tool.name)).toContain("getPlan");
  expect(tools.map((tool) => tool.name)).not.toContain("subscribePlan");
  expect(document.paths["/api/billing/subscribe"]?.post?.["x-mcp"]).toBe(false);
  expect(Object.keys(document.paths).filter((path) => path.includes("fake-stripe"))).toEqual([]);
});
