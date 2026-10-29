import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 3: the end of paying (the Customer Portal, canceling, a failed payment) over HTTP, on the fake Stripe.

const DAY = 24 * 60 * 60;
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url, vars: { STRIPE_FAKE: "true", STRIPE_WEBHOOK_SECRET: "whsec_test", EMAIL_TRANSPORT: "outbox" } });
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

const get = (path: string, person: Person) => worker.fetch(path, { headers: { cookie: person.cookie } });
const post = (path: string, person: Person, body: unknown = {}) => worker.post(path, body, { cookie: person.cookie });
const advance = (seconds: number, paymentFails = false) => worker.post("/api/fake-stripe/control/advance", { seconds, paymentFails });
const outboxTo = (email: string) => db.query<{ subject: string; text: string }>(`select subject, text from skeleton.email_outbox where "to" = '${email}'`);

type PlanState = { plan: { name: string }; subscription: { status: string; cancelAtPeriodEnd: boolean; periodEnd: string; pastDueUntil: string | null; losingAccess: number } | null };
async function plan(person: Person) {
  const response = await get("/api/billing/plan", person);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanState;
}

async function subscribePro(person: Person) {
  const subscribed = await post("/api/billing/subscribe", person, { plan: "prod_fake_pro" });
  const { url } = (await subscribed.json()) as { url: string };
  expect((await worker.fetch(`${new URL(url).pathname}/pay`, { method: "POST", redirect: "manual" })).status).toBe(303);
}

/** The Owner on Pro with a Company and two Members (3 Seats, all in use). */
async function ownerWithTeam() {
  const owner = await signedInUser();
  await subscribePro(owner);
  const created = await post("/api/companies", owner, { name: "Acme" });
  const company = (await created.json()) as { id: string };
  const members: Person[] = [];
  for (const [index, name] of ["Bia", "Caio"].entries()) {
    const member = await signedInUser(name);
    await db.query(
      `INSERT INTO skeleton.members (company_id, user_id, role, created_at) VALUES ('${company.id}', '${member.user.id}', 'employee', '${new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()}')`,
    );
    members.push(member);
  }
  return { owner, company, members };
}

const dateOf = (iso: string) => new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));

test("Manage payment opens a portal session with the Product's configuration", async () => {
  const owner = await signedInUser();
  await subscribePro(owner);

  const response = await post("/api/billing/portal", owner);

  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  expect(new URL(url).pathname).toBe("/account/plan");
  const { requests } = (await (await worker.fetch("/api/fake-stripe/control/requests")).json()) as { requests: { method: string; path: string; params: Record<string, string> }[] };
  const session = requests.find((call) => call.path === "/v1/billing_portal/sessions");
  expect(session).toMatchObject({ method: "POST", params: { configuration: "bpc_fake_portal" } });
});

test("a person who never paid has no portal, and an anonymous caller is refused", async () => {
  const owner = await signedInUser();

  const refused = await post("/api/billing/portal", owner);
  expect(refused.status).toBe(404);
  expect(await refused.json()).toMatchObject({ code: "NO_SUBSCRIPTION" });
  expect((await worker.post("/api/billing/portal", {})).status).toBe(401);
});

test("canceling keeps the Plan until the period ends, tells the date and the people, and emails the Owner", async () => {
  const { owner, members } = await ownerWithTeam();
  const before = await plan(owner);
  expect(before.subscription).toMatchObject({ cancelAtPeriodEnd: false, losingAccess: 2 });

  const response = await post("/api/billing/cancel", owner);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ endsAt: before.subscription!.periodEnd, losingAccess: 2 });
  const after = await plan(owner);
  expect(after.plan.name).toBe("Pro");
  expect(after.subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true, periodEnd: before.subscription!.periodEnd });
  const [email, ...rest] = await outboxTo(owner.email);
  expect(rest).toHaveLength(0);
  expect(email!.subject).toContain(dateOf(before.subscription!.periodEnd));
  expect(email!.text).toContain("2 people lose access");
  for (const member of members) expect(await outboxTo(member.email)).toHaveLength(0);
  expect((await post("/api/billing/cancel", owner)).status).toBe(409);
});

test("with nobody else in the Companies, the cancellation email names no people", async () => {
  const owner = await signedInUser();
  await subscribePro(owner);

  await post("/api/billing/cancel", owner);

  const [email] = await outboxTo(owner.email);
  expect(email!.text).not.toContain("lose access");
});

test("canceling without a Subscription is refused", async () => {
  const owner = await signedInUser();

  const response = await post("/api/billing/cancel", owner);

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NO_SUBSCRIPTION" });
});

test("when the period ends the person is on the free Plan and the newest Members are suspended", async () => {
  const { owner, company, members } = await ownerWithTeam();
  await post("/api/billing/cancel", owner);

  await advance(31 * DAY);

  expect((await plan(owner)).subscription).toBeNull();
  expect((await plan(owner)).plan.name).toBe("Free");
  const suspended = await get(`/api/companies/${company.id}/suspended-members`, owner);
  expect(((await suspended.json()) as { items: { userId: string }[] }).items.map((item) => item.userId).sort()).toEqual(members.map((m) => m.user.id).sort());
  expect((await get(`/api/companies/${company.id}`, members[0]!)).status).toBe(403);
});

test("a failed payment keeps the Seats, warns the Owner with the deadline, and emails only the Owner", async () => {
  const { owner, company, members } = await ownerWithTeam();

  await advance(31 * DAY, true);

  const state = await plan(owner);
  expect(state.plan.name).toBe("Pro");
  expect(state.subscription).toMatchObject({ status: "past_due" });
  const deadline = state.subscription!.pastDueUntil!;
  expect(Date.parse(deadline)).toBeGreaterThan(Date.now() + 30 * DAY * 1000);
  for (const member of members) expect((await get(`/api/companies/${company.id}`, member)).status).toBe(200);
  const [email, ...rest] = await outboxTo(owner.email);
  expect(rest).toHaveLength(0);
  expect(email!.text).toContain(dateOf(deadline));
  for (const member of members) expect(await outboxTo(member.email)).toHaveLength(0);
});

test("failing one person's payment leaves everybody else's Subscription alone", async () => {
  const payer = await signedInUser();
  const other = await signedInUser();
  await subscribePro(payer);
  await subscribePro(other);

  const failed = await worker.post("/api/fake-stripe/control/fail-payment", { email: payer.email });

  expect(await failed.json()).toEqual({ failed: 1 });
  expect((await plan(payer)).subscription).toMatchObject({ status: "past_due" });
  expect((await plan(other)).subscription).toMatchObject({ status: "active" });
});

test("when Stripe gives up on the payment the person is on the free Plan and the newest are suspended", async () => {
  const { owner, company, members } = await ownerWithTeam();
  await advance(31 * DAY, true);
  await advance(3 * DAY);
  expect((await plan(owner)).subscription).toMatchObject({ status: "past_due" });

  await advance(5 * DAY);

  expect((await plan(owner)).subscription).toBeNull();
  expect((await get(`/api/companies/${company.id}`, owner)).status).toBe(200);
  for (const member of members) expect((await get(`/api/companies/${company.id}`, member)).status).toBe(403);
  // A Suspended Member gets no email, and the Owner none beyond the failed payment.
  for (const member of members) expect(await outboxTo(member.email)).toHaveLength(0);
});

test("the portal and cancel routes are not MCP tools", async () => {
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as { paths: Record<string, Record<string, Record<string, unknown>>> };

  expect(document.paths["/api/billing/portal"]?.post?.["x-mcp"]).toBe(false);
  expect(document.paths["/api/billing/cancel"]?.post?.["x-mcp"]).toBe(false);
});
