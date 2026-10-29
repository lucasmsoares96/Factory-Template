import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import type { McpTool } from "../src/platform/mcp/tool.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 3: Seats over HTTP, with billing on the fake Stripe (Free 1 Seat, Pro 3, Team 10).

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
const TEAM = "prod_fake_team";

async function signedInUser(name = "Ana Souza", email = `user-${randomUUID()}@example.com`) {
  const user = await testAuth.saveUser(testAuth.createUser({ name, email, emailVerified: true }));
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, email, cookie: headers.get("cookie")! };
}

function api(path: string, { cookie, method = "GET", body, on = worker }: { cookie?: string; method?: string; body?: unknown; on?: TestWorker } = {}) {
  return on.fetch(path, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function createCompany(cookie: string, name = "Acme") {
  const response = await api("/api/companies", { cookie, method: "POST", body: { name } });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

/** Puts the user on a Plan the way Stripe's event would: a live Subscription row. */
function subscribe(userId: string, plan: string) {
  return db.query(
    `INSERT INTO skeleton.subscriptions (id, plan, reference_id, status, period_start) VALUES ('${randomUUID()}', '${plan}', '${userId}', 'active', now())`,
  );
}

function join(companyId: string, userId: string, role = "employee") {
  return db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${companyId}', '${userId}', '${role}')`);
}

const newAddress = () => `guest-${randomUUID()}@example.com`;

function invite(companyId: string, cookie: string, email = newAddress()) {
  return api(`/api/companies/${companyId}/invitations`, { cookie, method: "POST", body: { email, role: "employee" } });
}

type Seats = { used: number; total: number | null; companies: { id: string; name: string; people: { name: string | null; email: string; status: string }[] }[] };

async function seatsOf(cookie: string) {
  const response = await api("/api/billing/seats", { cookie });
  expect(response.status).toBe(200);
  return (await response.json()) as Seats;
}

function tokenSentTo(email: string) {
  const mail = sent.findLast((candidate) => candidate.to.includes(email));
  return /\/invitations\/([A-Za-z0-9_-]+)/.exec(mail!.html)![1]!;
}

const accept = (token: string, cookie: string) => api(`/api/invitations/${token}/accept`, { cookie, method: "POST" });

test("on the free Plan the Owner has one Seat, and inviting is refused with what to do", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);

  const response = await invite(company.id, ana.cookie);

  expect(response.status).toBe(409);
  const error = (await response.json()) as { code: string; message: string };
  expect(error.code).toBe("NO_FREE_SEAT");
  expect(error.message).toMatch(/remove someone/i);
  expect(error.message).toMatch(/cancel an Invitation/i);
  expect(error.message).toMatch(/upgrade the Plan/i);
  expect(await seatsOf(ana.cookie)).toMatchObject({ used: 1, total: 1 });
});

test("with free Seats an Invitation works as before, takes a Seat, and canceling it gives the Seat back", async () => {
  const ana = await signedInUser();
  await subscribe(ana.user.id, PRO);
  const company = await createCompany(ana.cookie);

  const first = await invite(company.id, ana.cookie);
  const second = await invite(company.id, ana.cookie);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(await seatsOf(ana.cookie)).toMatchObject({ used: 3, total: 3 });

  const refused = await invite(company.id, ana.cookie);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "NO_FREE_SEAT" });

  const { id } = (await first.json()) as { id: string };
  expect((await api(`/api/companies/${company.id}/invitations/${id}`, { cookie: ana.cookie, method: "DELETE" })).status).toBe(204);
  expect(await seatsOf(ana.cookie)).toMatchObject({ used: 2, total: 3 });
  expect((await invite(company.id, ana.cookie)).status).toBe(201);
});

test("the Owner and each pending Invitation take a Seat, and so does each Member", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno");
  await subscribe(ana.user.id, TEAM);
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  const address = newAddress();
  await invite(company.id, ana.cookie, address);

  const seats = await seatsOf(ana.cookie);

  expect(seats).toMatchObject({ used: 3, total: 10 });
  expect(seats.companies).toEqual([
    {
      id: company.id,
      name: "Acme",
      people: [
        { name: "Ana Souza", email: ana.email, status: "owner" },
        { name: "Bruno", email: bruno.email, status: "member" },
        { name: null, email: address, status: "invited" },
      ],
    },
  ]);
});

test("a person in two Companies of the same Owner takes one Seat, and inviting them again to the other costs none", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno");
  await subscribe(ana.user.id, PRO);
  const acme = await createCompany(ana.cookie, "Acme");
  const globex = await createCompany(ana.cookie, "Globex");
  await join(acme.id, bruno.user.id);
  await join(globex.id, bruno.user.id);
  expect(await seatsOf(ana.cookie)).toMatchObject({ used: 2, total: 3 });
  await invite(acme.id, ana.cookie);
  expect(await seatsOf(ana.cookie)).toMatchObject({ used: 3, total: 3 });

  // Full, yet an address that already holds a Seat in the Owner's other Company needs no new one.
  const pending = newAddress();
  await db.query(
    `INSERT INTO skeleton.invitations (id, company_id, email, role, token_hash, expires_at) VALUES ('${randomUUID()}', '${acme.id}', '${pending}', 'employee', '${randomUUID()}', now() + interval '7 days')`,
  );
  const sameAgain = await invite(globex.id, ana.cookie, pending);

  expect(sameAgain.status).toBe(201);
  const seats = await seatsOf(ana.cookie);
  expect(seats.used).toBe(4);
});

test("two accepts at once with one free Seat end in one accept", async () => {
  const ana = await signedInUser();
  const first = await signedInUser("Bia");
  const second = await signedInUser("Caio");
  await subscribe(ana.user.id, TEAM);
  const company = await createCompany(ana.cookie);
  await invite(company.id, ana.cookie, first.email);
  await invite(company.id, ana.cookie, second.email);
  // The Owner drops to Pro: three Seats, one of them free for the two Invitations.
  await db.query(`UPDATE skeleton.subscriptions SET plan = '${PRO}' WHERE reference_id = '${ana.user.id}'`);
  const extra = await signedInUser("Dani");
  await join(company.id, extra.user.id);

  const results = await Promise.all([
    accept(tokenSentTo(first.email), first.cookie),
    accept(tokenSentTo(second.email), second.cookie),
  ]);

  // The loser gets 409 when it reaches the Seat check first, or 410 when the winner's reconcile already canceled its Invitation.
  const statuses = results.map((response) => response.status).sort();
  expect(statuses[0]).toBe(200);
  expect([409, 410]).toContain(statuses[1]);
  const [row] = await db.query<{ count: string }>(`SELECT count(*) FROM skeleton.members WHERE company_id = '${company.id}'`);
  expect(Number(row?.count)).toBe(3);
});

test("deleting a Company gives its Seats back at once", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno");
  await subscribe(ana.user.id, PRO);
  const acme = await createCompany(ana.cookie, "Acme");
  const globex = await createCompany(ana.cookie, "Globex");
  await join(acme.id, bruno.user.id);
  await invite(acme.id, ana.cookie);
  expect(await seatsOf(ana.cookie)).toMatchObject({ used: 3, total: 3 });
  expect((await invite(globex.id, ana.cookie)).status).toBe(409);

  const deleted = await api(`/api/companies/${acme.id}`, { cookie: ana.cookie, method: "DELETE", body: { name: "Acme" } });

  expect(deleted.status).toBe(204);
  expect(await seatsOf(ana.cookie)).toMatchObject({ used: 1, total: 3 });
  expect((await invite(globex.id, ana.cookie)).status).toBe(201);
});

test("a Member sees the Seats of their own account, not the Owner's", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno");
  await subscribe(ana.user.id, TEAM);
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);

  const seats = await seatsOf(bruno.cookie);

  expect(seats).toEqual({ used: 1, total: 1, companies: [] });
  expect((await api(`/api/companies/${company.id}/invitations`, { cookie: bruno.cookie })).status).toBe(403);
});

test("without billing Seats are not checked, and reading them is an MCP tool that answers 404", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);

  const invitation = await api(`/api/companies/${company.id}/invitations`, {
    cookie: ana.cookie,
    method: "POST",
    body: { email: newAddress(), role: "employee" },
    on: withoutBilling,
  });
  const seats = await api("/api/billing/seats", { cookie: ana.cookie, on: withoutBilling });

  expect(invitation.status).toBe(201);
  expect(seats.status).toBe(404);
  const tools = JSON.parse(readFileSync(new URL("./worker/mcp-tools.gen.json", import.meta.url), "utf8")) as McpTool[];
  expect(tools.map((tool) => tool.name)).toContain("getSeats");
});

