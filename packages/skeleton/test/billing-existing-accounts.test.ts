import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 3: the trial `pnpm bootstrap billing` gives to the accounts that already exist. The bootstrap makes the Stripe
// customer, links it to the user and creates the Subscription in Stripe's API, with no Checkout and no card; the fake
// Stripe in the Worker does the same and sends the same events.

const DAY = 24 * 60 * 60;
const TEAM = "prod_fake_team";
const PRO = "prod_fake_pro";
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url, vars: { STRIPE_FAKE: "true", EMAIL_TRANSPORT: "outbox" } });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  await db?.drop();
});
beforeEach(async () => {
  await worker.post("/api/fake-stripe/control/reset", {});
});

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }));
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, email: user.email, cookie: headers.get("cookie")! };
}

type Person = Awaited<ReturnType<typeof signedInUser>>;

const api = (path: string, cookie: string, init: { method?: string; body?: unknown } = {}) =>
  worker.fetch(path, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined && { "content-type": "application/json" }), cookie },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });

let clock = Date.parse("2026-01-01T00:00:00Z");

/** An account that already existed before billing: an Owner with a Company of `guests` more people. */
async function ownerWithCompany(guests: number) {
  const owner = await signedInUser();
  const created = await api("/api/companies", owner.cookie, { method: "POST", body: { name: "Acme" } });
  expect(created.status).toBe(201);
  const company = (await created.json()) as { id: string };
  const joined: Person[] = [];
  for (let index = 0; index < guests; index++) {
    const guest = await signedInUser(`Guest ${index + 1}`);
    clock += 60_000;
    await db.query(`INSERT INTO skeleton.members (company_id, user_id, role, created_at) VALUES ('${company.id}', '${guest.user.id}', 'employee', '${new Date(clock).toISOString()}')`);
    joined.push(guest);
  }
  return { owner, company, guests: joined };
}

/** What the bootstrap does for one account: a Stripe customer linked to the user, then a trial Subscription with no card. */
async function startTrial(person: Person, { plan, quantity = 1, days = 14 }: { plan: string; quantity?: number; days?: number }) {
  const customer = (await (await worker.post("/api/fake-stripe/control/customers", { email: person.email })).json()) as { id: string };
  await db.query(`UPDATE skeleton.users SET stripe_customer_id = '${customer.id}' WHERE id = '${person.user.id}'`);
  const response = await worker.post("/api/fake-stripe/control/outside-subscription", { customer: customer.id, plan, quantity, trialDays: days });
  expect(response.status).toBe(200);
  return (await response.json()) as { subscription: string };
}

type PlanState = {
  plan: { name: string } | null;
  subscription: { status: string; periodEnd: string } | null;
};

async function currentPlan(person: Person) {
  const response = await api("/api/billing/plan", person.cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanState;
}

const advance = (days: number) => worker.post("/api/fake-stripe/control/advance", { seconds: days * DAY });

async function suspendedIn(companyId: string, owner: Person) {
  const response = await api(`/api/companies/${companyId}/suspended-members`, owner.cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: { userId: string }[] }).items.map((item) => item.userId).sort();
}

test("a Subscription created outside Checkout is recorded from customer.subscription.created, as a trial", async () => {
  const { owner } = await ownerWithCompany(3);

  const { subscription } = await startTrial(owner, { plan: TEAM });

  expect(await currentPlan(owner)).toMatchObject({ plan: { name: "Team" }, subscription: { status: "trialing" } });
  const [row] = await db.query<{ stripe_subscription_id: string; status: string; trial_start: Date | null; trial_end: Date | null; seats: number | null }>(
    `SELECT stripe_subscription_id, status, trial_start, trial_end, seats FROM skeleton.subscriptions WHERE reference_id = '${owner.user.id}'`,
  );
  expect(row).toMatchObject({ stripe_subscription_id: subscription, status: "trialing", seats: 1 });
  expect(row?.trial_start).toBeInstanceOf(Date);
  expect(Math.round((row!.trial_end!.getTime() - row!.trial_start!.getTime()) / 1000)).toBe(14 * DAY);
});

test("the trial gives the Plan's Seats while it lasts: nobody is suspended", async () => {
  const { owner, company } = await ownerWithCompany(3);

  await startTrial(owner, { plan: TEAM });
  await advance(10);

  expect(await suspendedIn(company.id, owner)).toEqual([]);
});

test("a per-Seat Plan takes the Seats it was started with and has no limit", async () => {
  const { owner, company } = await ownerWithCompany(11);
  await worker.post("/api/fake-stripe/control/products", { id: TEAM, metadata: { kind: "per_seat" } });

  await startTrial(owner, { plan: TEAM, quantity: 12 });

  const [row] = await db.query<{ seats: number }>(`SELECT seats FROM skeleton.subscriptions WHERE reference_id = '${owner.user.id}'`);
  expect(row?.seats).toBe(12);
  expect(await suspendedIn(company.id, owner)).toEqual([]);
});

test("a trial that ends with no card ends the Subscription without a charge and suspends the newest", async () => {
  const { owner, company, guests } = await ownerWithCompany(3);
  const { subscription } = await startTrial(owner, { plan: TEAM });

  await advance(15);

  expect(await currentPlan(owner)).toMatchObject({ plan: { name: "Free" }, subscription: null });
  const [row] = await db.query<{ status: string }>(`SELECT status FROM skeleton.subscriptions WHERE stripe_subscription_id = '${subscription}'`);
  expect(row?.status).toBe("canceled");
  const states = (await (await worker.fetch("/api/fake-stripe/control/subscriptions")).json()) as { subscriptions: { id: string; status: string }[] };
  expect(states.subscriptions.find((sub) => sub.id === subscription)?.status).toBe("canceled");
  // Free gives 1 Seat: the Owner stays, all three newcomers are suspended.
  expect(await suspendedIn(company.id, owner)).toEqual(guests.map((guest) => guest.user.id).sort());
});

test("a person who had this trial gets no other when they subscribe", async () => {
  const { owner } = await ownerWithCompany(1);
  await worker.post("/api/fake-stripe/control/products", { id: PRO, metadata: { trial_days: "14" } });
  await startTrial(owner, { plan: TEAM });
  await advance(15);

  const subscribed = await worker.post("/api/billing/subscribe", { plan: PRO }, { cookie: owner.cookie });
  expect(subscribed.status).toBe(200);
  const { url } = (await subscribed.json()) as { url: string };
  await worker.fetch(`${new URL(url).pathname}/pay`, { method: "POST", redirect: "manual" });

  expect(await currentPlan(owner)).toMatchObject({ plan: { name: "Pro" }, subscription: { status: "active" } });
});

test("someone with no earlier trial still gets the Plan's trial when they subscribe", async () => {
  const stranger = await signedInUser();
  await worker.post("/api/fake-stripe/control/products", { id: PRO, metadata: { trial_days: "14" } });

  const subscribed = await worker.post("/api/billing/subscribe", { plan: PRO }, { cookie: stranger.cookie });
  const { url } = (await subscribed.json()) as { url: string };
  await worker.fetch(`${new URL(url).pathname}/pay`, { method: "POST", redirect: "manual" });

  expect(await currentPlan(stranger)).toMatchObject({ plan: { name: "Pro" }, subscription: { status: "trialing" } });
});
