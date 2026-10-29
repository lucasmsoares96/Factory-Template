import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 1: the ownership offer over HTTP. `worker` has billing on the fake Stripe
// (Free 1 Seat, Pro 3, Team 10); `withoutBilling` limits nothing.

const sent: SentEmail[] = [];
const resend = mockResend((email) => sent.push(email));
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let withoutBilling: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url, vars: { STRIPE_FAKE: "true" } });
  withoutBilling = await startTestWorker({ databaseUrl: db.url });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  await withoutBilling?.close();
  resend.close();
  await db?.drop();
});
beforeEach(async () => {
  await worker.post("/api/fake-stripe/control/reset", {});
});

const PRO = "prod_fake_pro";

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(
    testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }),
  );
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, cookie: headers.get("cookie")! };
}

function api(path: string, { cookie, method = "GET", body, on = withoutBilling }: { cookie?: string; method?: string; body?: unknown; on?: TestWorker } = {}) {
  return on.fetch(path, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function createCompany(cookie: string, name = "Acme") {
  const response = await api("/api/companies", { cookie, method: "POST", body: { name } });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string; role: string; createdAt: string };
}

function join(companyId: string, userId: string, role = "employee") {
  return db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${companyId}', '${userId}', '${role}')`);
}

/** Puts the user on a Plan the way Stripe's event would: a live Subscription row. */
function subscribe(userId: string, plan: string) {
  return db.query(
    `INSERT INTO skeleton.subscriptions (id, plan, reference_id, status, period_start) VALUES ('${randomUUID()}', '${plan}', '${userId}', 'active', now())`,
  );
}

async function rolesOf(companyId: string) {
  const rows = (await db.query(`SELECT user_id, role FROM skeleton.members WHERE company_id = '${companyId}'`)) as {
    user_id: string;
    role: string;
  }[];
  return Object.fromEntries(rows.map(({ user_id, role }) => [user_id, role]));
}

const offerUrl = (companyId: string) => `/api/companies/${companyId}/ownership-offer`;

function offer(companyId: string, cookie: string | undefined, body: unknown, on = withoutBilling) {
  return api(offerUrl(companyId), { cookie, method: "POST", body, on });
}

const accept = (companyId: string, cookie: string | undefined, on = withoutBilling) =>
  api(`${offerUrl(companyId)}/accept`, { cookie, method: "POST", on });

test("offering the Company changes no role, emails the recipient, and lasts 7 days", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  const [brunoRow] = (await db.query(`SELECT email FROM skeleton.users WHERE id = '${bruno.user.id}'`)) as { email: string }[];
  const before = Date.now();

  const response = await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "  Acme  " });

  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string; recipient: unknown; offeredBy: unknown; expiresAt: string };
  expect(created).toMatchObject({
    recipient: { userId: bruno.user.id, name: "Bruno Lima", email: brunoRow!.email },
    offeredBy: { userId: ana.user.id, name: "Ana Souza" },
  });
  const days = (new Date(created.expiresAt).getTime() - before) / 86_400_000;
  expect(days).toBeGreaterThan(6.99);
  expect(days).toBeLessThan(7.01);
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee" });
  const email = sent.findLast((candidate) => candidate.to.includes(brunoRow!.email))!;
  expect(email.subject).toContain("Acme");
  expect(email.html).toContain(`/c/${company.id}`);
});

test("only the Owner and the recipient see the open offer", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id);
  expect((await api(offerUrl(company.id), { cookie: ana.cookie })).status).toBe(404);
  await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" });

  for (const { cookie } of [ana, bruno]) {
    const response = await api(offerUrl(company.id), { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recipient: { userId: bruno.user.id } });
  }
  expect((await api(offerUrl(company.id), { cookie: carla.cookie })).status).toBe(404);
  expect((await api(offerUrl(company.id), { cookie: (await signedInUser("Mallory")).cookie })).status).toBe(404);
});

test("a new offer replaces the open one", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id);
  await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" });

  expect((await offer(company.id, ana.cookie, { userId: carla.user.id, name: "Acme" })).status).toBe(201);

  expect(await (await api(offerUrl(company.id), { cookie: ana.cookie })).json()).toMatchObject({ recipient: { userId: carla.user.id } });
  expect((await accept(company.id, bruno.cookie)).status).toBe(404);
  expect((await accept(company.id, carla.cookie)).status).toBe(200);
});

test("the recipient accepts: they become the Owner, the former Owner an Employee, and the offer is spent", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id, "manager");
  await join(company.id, carla.user.id);
  await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" });

  // Not the recipient's to accept.
  expect((await accept(company.id, carla.cookie)).status).toBe(404);
  expect((await accept(company.id, ana.cookie)).status).toBe(404);
  const response = await accept(company.id, bruno.cookie);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...company, role: "owner" });
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "employee", [bruno.user.id]: "owner", [carla.user.id]: "employee" });
  expect((await accept(company.id, bruno.cookie)).status).toBe(404);
  expect((await api(offerUrl(company.id), { cookie: bruno.cookie })).status).toBe(404);
  // The new Owner has the Owner's actions; the former Owner has none.
  expect((await api(`/api/companies/${company.id}`, { cookie: bruno.cookie, method: "PATCH", body: { name: "Acme Corp" } })).status).toBe(200);
  expect((await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "PATCH", body: { name: "Mine" } })).status).toBe(403);
});

test("the Owner cancels the offer, and it can no longer be accepted", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" });

  expect((await api(offerUrl(company.id), { cookie: bruno.cookie, method: "DELETE" })).status).toBe(403);
  expect((await api(offerUrl(company.id), { cookie: ana.cookie, method: "DELETE" })).status).toBe(204);

  expect((await api(offerUrl(company.id), { cookie: ana.cookie, method: "DELETE" })).status).toBe(404);
  expect((await accept(company.id, bruno.cookie)).status).toBe(404);
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee" });
  // And the Owner may offer again.
  expect((await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" })).status).toBe(201);
});

test("an expired offer cannot be accepted or seen, and the Owner can offer again", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" });
  await db.query(`UPDATE skeleton.ownership_offers SET expires_at = now() - interval '1 second' WHERE company_id = '${company.id}'`);

  expect((await accept(company.id, bruno.cookie)).status).toBe(404);
  expect((await api(offerUrl(company.id), { cookie: ana.cookie })).status).toBe(404);
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee" });
  expect((await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" })).status).toBe(201);
  expect((await accept(company.id, bruno.cookie)).status).toBe(200);
});

test("offering answers 400 for a wrong confirmation or body, 404 for a recipient who is no Member, and nothing is offered", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);

  for (const name of ["acme", "Globex"]) {
    const response = await offer(company.id, ana.cookie, { userId: bruno.user.id, name });
    expect(response.status, name).toBe(400);
    expect(await response.json()).toEqual({ code: "CONFIRMATION_MISMATCH", message: "The confirmation does not match the Company's name." });
  }
  for (const body of [{ userId: bruno.user.id }, { name: "Acme" }, { userId: 42, name: "Acme" }, { userId: ana.user.id, name: "Acme" }]) {
    const response = await offer(company.id, ana.cookie, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
  for (const userId of [mallory.user.id, randomUUID()]) {
    const response = await offer(company.id, ana.cookie, { userId, name: "Acme" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  }
  expect((await api(offerUrl(company.id), { cookie: ana.cookie })).status).toBe(404);
});

test("offering answers 403 to an Employee or a Product's role, 404 to a non-Member and 401 without a session", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id, "manager");

  for (const { cookie, user } of [bruno, carla]) {
    const response = await offer(company.id, cookie, { userId: user.id, name: "Acme" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "Your role in this Company does not allow this." });
  }
  expect((await offer(company.id, mallory.cookie, { userId: mallory.user.id, name: "Acme" })).status).toBe(404);
  expect((await accept(company.id, mallory.cookie)).status).toBe(404);
  const anonymous = await offer(company.id, undefined, { userId: bruno.user.id, name: "Acme" });
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  expect((await accept(company.id, undefined)).status).toBe(401);
});

test("two acceptances at once leave the Company with exactly one Owner", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" });

  const responses = await Promise.all([accept(company.id, bruno.cookie), accept(company.id, bruno.cookie)]);

  expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "employee", [bruno.user.id]: "owner" });
});

test("with billing on, accepting needs free Seats for the people of the Company, and says how many are missing", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  await subscribe(ana.user.id, PRO);
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id);
  expect((await offer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" }, worker)).status).toBe(201);

  // Bruno is on the free Plan: one Seat for three people.
  const refused = await accept(company.id, bruno.cookie, worker);

  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    code: "NOT_ENOUGH_SEATS",
    message: "The new Owner has too few free Seats for the Company's people. `missing` says how many.",
    missing: 2,
  });
  // Nothing moved, and the offer is still open.
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee", [carla.user.id]: "employee" });
  expect((await api(offerUrl(company.id), { cookie: bruno.cookie, on: worker })).status).toBe(200);

  // With a Plan of three Seats the same offer goes through.
  await subscribe(bruno.user.id, PRO);
  expect((await accept(company.id, bruno.cookie, worker)).status).toBe(200);
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "employee", [bruno.user.id]: "owner", [carla.user.id]: "employee" });
});

test("the people the new Owner already seats do not count twice, and pending Invitations do count", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  await subscribe(bruno.user.id, PRO);
  // Bruno owns Globex with Carla: two Seats of three taken. Acme has Ana, Bruno and Carla.
  const globex = await createCompany(bruno.cookie, "Globex");
  await join(globex.id, carla.user.id);
  const acme = await createCompany(ana.cookie, "Acme");
  await join(acme.id, bruno.user.id);
  await join(acme.id, carla.user.id);
  expect((await offer(acme.id, ana.cookie, { userId: bruno.user.id, name: "Acme" }, worker)).status).toBe(201);

  // Only Ana is new to Bruno's Seats: one is free.
  await db.query(
    `INSERT INTO skeleton.invitations (id, company_id, email, role, invited_by, token_hash, expires_at) VALUES ('${randomUUID()}', '${acme.id}', 'guest@example.com', 'employee', '${ana.user.id}', '${randomUUID()}', now() + interval '1 day')`,
  );
  const refused = await accept(acme.id, bruno.cookie, worker);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "NOT_ENOUGH_SEATS", missing: 1 });

  await db.query(`UPDATE skeleton.invitations SET canceled_at = now() WHERE company_id = '${acme.id}'`);
  expect((await accept(acme.id, bruno.cookie, worker)).status).toBe(200);
  expect((await rolesOf(acme.id))[bruno.user.id]).toBe("owner");
});
