import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 3: Suspended Members over HTTP, with billing on the fake Stripe (Free 1 Seat, Pro 3, Team 10).

const sent: SentEmail[] = [];
const resend = mockResend((email) => sent.push(email));
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url, vars: { STRIPE_FAKE: "true" } });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  resend.close();
  await db?.drop();
});

beforeEach(async () => {
  await worker.post("/api/fake-stripe/control/reset", {});
});

const PRO = "prod_fake_pro";
const TEAM = "prod_fake_team";

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }));
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, email: user.email, cookie: headers.get("cookie")! };
}

type Person = Awaited<ReturnType<typeof signedInUser>>;

function api(path: string, { cookie, method = "GET", body }: { cookie: string; method?: string; body?: unknown }) {
  return worker.fetch(path, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), cookie },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function createCompany(cookie: string, name = "Acme") {
  const response = await api("/api/companies", { cookie, method: "POST", body: { name } });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

/** The Owner on `plan`, through a Subscription row with a Stripe id, so that Stripe's events find it. */
async function subscribe(owner: Person, plan: string) {
  const stripeId = `sub_${randomUUID()}`;
  await db.query(
    `INSERT INTO skeleton.subscriptions (id, plan, reference_id, stripe_subscription_id, status, period_start) VALUES ('${randomUUID()}', '${plan}', '${owner.user.id}', '${stripeId}', 'active', now())`,
  );
  return stripeId;
}

/** Stripe ends the Subscription: the event the fake sends to the webhook. */
function subscriptionEnds(stripeId: string) {
  return worker.post("/api/fake-stripe/control/events", {
    type: "customer.subscription.deleted",
    object: { id: stripeId, object: "subscription", status: "canceled", metadata: { productId: "skeleton-test" }, items: { data: [] } },
  });
}

let clock = Date.parse("2026-01-01T00:00:00Z");

/** `person` joins the Company `minutes` after the previous one did: the order they joined is the order of the calls. */
function join(companyId: string, person: Person, role = "employee") {
  clock += 60_000;
  return db.query(
    `INSERT INTO skeleton.members (company_id, user_id, role, created_at) VALUES ('${companyId}', '${person.user.id}', '${role}', '${new Date(clock).toISOString()}')`,
  );
}

async function people(count: number) {
  return Promise.all(Array.from({ length: count }, (_, index) => signedInUser(`Person ${index + 1}`)));
}

const companyStatus = async (companyId: string, person: Person) => (await api(`/api/companies/${companyId}`, { cookie: person.cookie })).status;

type Listed = { items: { userId: string; suspended: boolean }[] };

/** The user ids the Owner sees as suspended, the one suspended the longest first (ties by id). */
async function suspendedIn(companyId: string, owner: Person) {
  const response = await api(`/api/companies/${companyId}/suspended-members`, { cookie: owner.cookie });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: { userId: string }[] }).items.map((item) => item.userId);
}

const ids = (...list: Person[]) => list.map((person) => person.user.id).sort();

/** The Owner removes a Member: their Seats are recalculated, as they are whenever the people change. */
const removeMember = (companyId: string, owner: Person, member: Person) =>
  api(`/api/companies/${companyId}/members/${member.user.id}`, { cookie: owner.cookie, method: "DELETE" });

/** Someone joins and is removed: the Owner's Seats are recalculated, as they are whenever the people change. */
async function somebodyLeaves(companyId: string, owner: Person) {
  const passerby = await signedInUser("Passerby");
  await join(companyId, passerby);
  expect((await removeMember(companyId, owner, passerby)).status).toBe(204);
}

/** The Owner's plan changes in Stripe's books only: nothing is recalculated until an event or a change of people. */
const setPlan = (owner: Person, plan: string) => db.query(`UPDATE skeleton.subscriptions SET plan = '${plan}' WHERE reference_id = '${owner.user.id}'`);

function invite(companyId: string, owner: Person) {
  return api(`/api/companies/${companyId}/invitations`, {
    cookie: owner.cookie,
    method: "POST",
    body: { email: `guest-${randomUUID()}@example.com`, role: "employee" },
  });
}

test("when the Subscription ends, the pending Invitations are canceled and the 7 newest of 8 people are suspended", async () => {
  const ana = await signedInUser();
  const guests = await people(7);
  const stripeId = await subscribe(ana, TEAM);
  const company = await createCompany(ana.cookie);
  for (const guest of guests) await join(company.id, guest);
  expect((await invite(company.id, ana)).status).toBe(201);
  expect((await invite(company.id, ana)).status).toBe(201);

  const ended = await subscriptionEnds(stripeId);

  expect(await ended.json()).toEqual({ webhookStatus: 200 });
  const listed = await api(`/api/companies/${company.id}/members`, { cookie: ana.cookie });
  const { items } = (await listed.json()) as Listed;
  expect(items).toHaveLength(8);
  expect(items.filter((item) => item.suspended).map((item) => item.userId).sort()).toEqual(ids(...guests));
  expect(items.find((item) => item.userId === ana.user.id)).toMatchObject({ suspended: false });
  const [pending] = await db.query<{ count: string }>(
    `SELECT count(*) FROM skeleton.invitations WHERE company_id = '${company.id}' AND accepted_at IS NULL AND canceled_at IS NULL`,
  );
  expect(Number(pending?.count)).toBe(0);
  expect(await companyStatus(company.id, ana)).toBe(200);
});

test("only as many Invitations as needed are canceled, newest first, before anyone is suspended", async () => {
  const ana = await signedInUser();
  const [bruno] = (await people(1)) as [Person];
  await subscribe(ana, TEAM);
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno);
  const first = `first-${randomUUID()}@example.com`;
  const second = `second-${randomUUID()}@example.com`;
  for (const email of [first, second]) {
    const created = await api(`/api/companies/${company.id}/invitations`, { cookie: ana.cookie, method: "POST", body: { email, role: "employee" } });
    expect(created.status).toBe(201);
  }
  // Pro has 3 Seats: Ana, Bruno and the first Invitation fit; the newest Invitation does not.
  await setPlan(ana, PRO);

  await somebodyLeaves(company.id, ana);

  const rows = await db.query<{ email: string; canceled: boolean }>(`SELECT email, canceled_at IS NOT NULL AS canceled FROM skeleton.invitations WHERE company_id = '${company.id}'`);
  expect(rows.find((row) => row.email === first)?.canceled).toBe(false);
  expect(rows.find((row) => row.email === second)?.canceled).toBe(true);
  expect(await suspendedIn(company.id, ana)).toEqual([]);
});

test("the newest are suspended first, and the Owner never is", async () => {
  const ana = await signedInUser();
  const [first, second, third, fourth] = (await people(4)) as [Person, Person, Person, Person];
  await subscribe(ana, TEAM);
  const company = await createCompany(ana.cookie);
  for (const person of [first, second, third, fourth]) await join(company.id, person);
  await setPlan(ana, PRO);

  await somebodyLeaves(company.id, ana);

  expect(await suspendedIn(company.id, ana)).toEqual(ids(third, fourth));
  for (const person of [ana, first, second]) expect(await companyStatus(company.id, person)).toBe(200);
  for (const person of [third, fourth]) expect(await companyStatus(company.id, person)).toBe(403);
});

test("a Suspended Member gets a stable error on the Company's routes, and keeps using their other Companies", async () => {
  const ana = await signedInUser();
  const dora = await signedInUser("Dora");
  const bruno = await signedInUser("Bruno");
  const stripeId = await subscribe(ana, PRO);
  const acme = await createCompany(ana.cookie, "Acme");
  await join(acme.id, bruno);
  await join(acme.id, dora);
  const elsewhere = await createCompany(dora.cookie, "Dora's");
  await join(elsewhere.id, bruno);
  await subscriptionEnds(stripeId);

  const refused = await api(`/api/companies/${acme.id}/members`, { cookie: dora.cookie });

  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "MEMBER_SUSPENDED" });
  expect(await companyStatus(acme.id, dora)).toBe(403);
  // Dora's own Company and Bruno's other one are unchanged.
  expect(await companyStatus(elsewhere.id, dora)).toBe(200);
  expect(await companyStatus(elsewhere.id, bruno)).toBe(200);
  // She still sees it in her Companies.
  const companies = await api("/api/companies", { cookie: dora.cookie });
  expect(((await companies.json()) as { items: { id: string }[] }).items.map((item) => item.id)).toContain(acme.id);
});

test("only the Owner lists the Suspended Members, and can remove one", async () => {
  const ana = await signedInUser();
  const [bruno, carla] = (await people(2)) as [Person, Person];
  const stripeId = await subscribe(ana, PRO);
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno);
  await join(company.id, carla);
  await subscriptionEnds(stripeId);
  expect((await suspendedIn(company.id, ana)).sort()).toEqual(ids(bruno, carla));

  expect((await api(`/api/companies/${company.id}/suspended-members`, { cookie: bruno.cookie })).status).toBe(403);
  const removed = await api(`/api/companies/${company.id}/members/${carla.user.id}`, { cookie: ana.cookie, method: "DELETE" });

  expect(removed.status).toBe(204);
  expect(await suspendedIn(company.id, ana)).toEqual([bruno.user.id]);
});

test("when Seats free up, the longest suspended comes back first, without the Owner doing anything", async () => {
  const ana = await signedInUser();
  const [bruno, carla, dani, edu] = (await people(4)) as [Person, Person, Person, Person];
  const stripeId = await subscribe(ana, TEAM);
  const company = await createCompany(ana.cookie);
  for (const person of [bruno, carla, dani, edu]) await join(company.id, person);
  // Pro (3 Seats): Dani and Edu go first. Then the Subscription ends (1 Seat): Carla and Bruno follow, later.
  await setPlan(ana, PRO);
  await somebodyLeaves(company.id, ana);
  expect((await suspendedIn(company.id, ana)).sort()).toEqual(ids(dani, edu));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await subscriptionEnds(stripeId);
  expect((await suspendedIn(company.id, ana)).sort()).toEqual(ids(bruno, carla, dani, edu));

  // Ana is back on Pro: two Seats are free, and they go to Dani and Edu, who have waited the longest.
  await subscribe(ana, PRO);
  await somebodyLeaves(company.id, ana);

  expect((await suspendedIn(company.id, ana)).sort()).toEqual(ids(bruno, carla));
  for (const person of [dani, edu]) expect(await companyStatus(company.id, person)).toBe(200);
  for (const person of [bruno, carla]) expect(await companyStatus(company.id, person)).toBe(403);
});

/** Pays for `plan` in the fake Checkout as `owner`. */
async function buyThroughCheckout(owner: Person, plan: string) {
  const opened = await worker.post("/api/billing/subscribe", { plan }, { cookie: owner.cookie });
  expect(opened.status).toBe(200);
  const { url } = (await opened.json()) as { url: string };
  expect((await worker.fetch(`${new URL(url).pathname}/pay`, { method: "POST", redirect: "manual" })).status).toBe(303);
}

test("Stripe ending a Subscription suspends, and buying a bigger Plan through Checkout brings everyone back", async () => {
  const ana = await signedInUser();
  const guests = await people(2);
  await buyThroughCheckout(ana, PRO);
  const company = await createCompany(ana.cookie);
  for (const guest of guests) await join(company.id, guest);
  expect(await suspendedIn(company.id, ana)).toEqual([]);

  const ended = await worker.post("/api/fake-stripe/control/end-subscriptions", { email: ana.email });
  expect(await ended.json()).toEqual({ ended: 1 });
  expect((await suspendedIn(company.id, ana)).sort()).toEqual(ids(...guests));
  await buyThroughCheckout(ana, TEAM);

  expect(await suspendedIn(company.id, ana)).toEqual([]);
  for (const guest of guests) expect(await companyStatus(company.id, guest)).toBe(200);
});

test("a Member removed frees a Seat for the person suspended", async () => {
  const ana = await signedInUser();
  const [bruno, carla] = (await people(2)) as [Person, Person];
  await subscribe(ana, TEAM);
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno);
  await join(company.id, carla);
  // Back on the free Plan (one Seat): both go.
  await db.query(`DELETE FROM skeleton.subscriptions WHERE reference_id = '${ana.user.id}'`);
  await somebodyLeaves(company.id, ana);
  expect(await suspendedIn(company.id, ana)).toHaveLength(2);
  await subscribe(ana, PRO);

  expect((await removeMember(company.id, ana, bruno)).status).toBe(204);

  expect(await suspendedIn(company.id, ana)).toEqual([]);
  expect(await companyStatus(company.id, carla)).toBe(200);
});

test("deleting a Company gives its Seats to the people suspended in another", async () => {
  const ana = await signedInUser();
  const [bruno, carla] = (await people(2)) as [Person, Person];
  const stripeId = await subscribe(ana, PRO);
  const acme = await createCompany(ana.cookie, "Acme");
  const globex = await createCompany(ana.cookie, "Globex");
  await join(acme.id, bruno);
  await join(globex.id, carla);
  await subscriptionEnds(stripeId);
  expect(await suspendedIn(globex.id, ana)).toEqual([carla.user.id]);
  await subscribe(ana, PRO);

  const deleted = await api(`/api/companies/${acme.id}`, { cookie: ana.cookie, method: "DELETE", body: { name: "Acme" } });

  expect(deleted.status).toBe(204);
  expect(await suspendedIn(globex.id, ana)).toEqual([]);
});

test("a person suspended in one of the Owner's Companies is suspended in all of them", async () => {
  const ana = await signedInUser();
  const [bruno, carla] = (await people(2)) as [Person, Person];
  await subscribe(ana, TEAM);
  const acme = await createCompany(ana.cookie, "Acme");
  const globex = await createCompany(ana.cookie, "Globex");
  await join(acme.id, bruno);
  await join(acme.id, carla);
  await join(globex.id, carla);
  // Back on the free Plan (one Seat): Bruno joined first and goes with Carla, who is in both Companies.
  await db.query(`DELETE FROM skeleton.subscriptions WHERE reference_id = '${ana.user.id}'`);

  await somebodyLeaves(acme.id, ana);

  expect(await companyStatus(acme.id, carla)).toBe(403);
  expect(await companyStatus(globex.id, carla)).toBe(403);
});

test("a Seat held by someone suspended is not offered to a new Invitation", async () => {
  const ana = await signedInUser();
  const [bruno] = (await people(1)) as [Person];
  const stripeId = await subscribe(ana, PRO);
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno);
  await subscriptionEnds(stripeId);
  expect(await suspendedIn(company.id, ana)).toEqual([bruno.user.id]);

  // Ana is on the free Plan, one Seat: there is no room for anyone else.
  expect((await invite(company.id, ana)).status).toBe(409);
});
