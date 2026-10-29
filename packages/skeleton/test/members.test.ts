import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { linkIn } from "../src/node/email-link.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 1: the Worker over HTTP. Every test brings its own users and Companies.

const sent: SentEmail[] = [];
const resend = mockResend((email) => sent.push(email));
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
  // The test composition's Product adds a role of its own.
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  resend.close();
  await db?.drop();
});

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(
    testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }),
  );
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, cookie: headers.get("cookie")! };
}

function api(path: string, { cookie, method = "GET", body }: { cookie?: string; method?: string; body?: unknown } = {}) {
  return worker.fetch(path, {
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

/** Makes a user a Member of a Company without an Invitation: the test writes the row itself. */
function join(companyId: string, userId: string, role = "employee") {
  return db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${companyId}', '${userId}', '${role}')`);
}

/** A Company of Ana's (Owner) with Bruno (Employee) and Carla (the Product's `manager`). */
async function acme() {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id, "manager");
  return { ana, bruno, carla, company };
}

function roleOf(companyId: string, userId: string) {
  return db.query<{ role: string }>(`SELECT role FROM skeleton.members WHERE company_id = '${companyId}' AND user_id = '${userId}'`);
}

const changeRole = (companyId: string, userId: string, cookie: string, role: unknown) =>
  api(`/api/companies/${companyId}/members/${userId}`, { cookie, method: "PATCH", body: { role } });

const forbidden = { code: "FORBIDDEN", message: "Your role in this Company does not allow this." };

test("the Owner changes another Member's role to any role of member_roles but owner, the Product's included", async () => {
  const { ana, bruno, company } = await acme();

  const promoted = await changeRole(company.id, bruno.user.id, ana.cookie, "manager");

  expect(promoted.status).toBe(200);
  expect(await promoted.json()).toEqual({ userId: bruno.user.id, name: "Bruno Lima", email: bruno.user.email, role: "manager" });
  expect(await roleOf(company.id, bruno.user.id)).toEqual([{ role: "manager" }]);
  expect(await (await api(`/api/companies/${company.id}`, { cookie: bruno.cookie })).json()).toMatchObject({ role: "manager" });

  expect((await changeRole(company.id, bruno.user.id, ana.cookie, "employee")).status).toBe(200);
  expect(await roleOf(company.id, bruno.user.id)).toEqual([{ role: "employee" }]);
});

test("changing a role to owner, or to one the Product does not have, answers 400 VALIDATION_FAILED", async () => {
  const { ana, bruno, company } = await acme();

  for (const role of ["owner", "admin", "", 42, undefined]) {
    const response = await changeRole(company.id, bruno.user.id, ana.cookie, role);
    expect(response.status, String(role)).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
  expect(await roleOf(company.id, bruno.user.id)).toEqual([{ role: "employee" }]);
  expect(await roleOf(company.id, ana.user.id)).toEqual([{ role: "owner" }]);
});

test("an Employee or a Product's role changing a role answers 403 FORBIDDEN, their own included", async () => {
  const { ana, bruno, carla, company } = await acme();

  for (const [caller, target] of [
    [bruno, carla],
    [carla, bruno],
    [bruno, bruno],
    [carla, ana],
  ] as const) {
    const response = await changeRole(company.id, target.user.id, caller.cookie, "employee");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbidden);
  }
  expect(await roleOf(company.id, carla.user.id)).toEqual([{ role: "manager" }]);
  expect(await roleOf(company.id, ana.user.id)).toEqual([{ role: "owner" }]);
});

test("the Owner changing their own role answers 403 OWN_ROLE", async () => {
  const { ana, company } = await acme();

  const response = await changeRole(company.id, ana.user.id, ana.cookie, "employee");

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: "OWN_ROLE", message: "Nobody changes their own role." });
  expect(await roleOf(company.id, ana.user.id)).toEqual([{ role: "owner" }]);
});

test("changing the role of a user who is not a Member answers 404, and so does a non-Member's call", async () => {
  const { ana, company } = await acme();
  const mallory = await signedInUser("Mallory");

  const stranger = await changeRole(company.id, mallory.user.id, ana.cookie, "employee");
  expect(stranger.status).toBe(404);
  expect(await stranger.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  expect((await changeRole(company.id, ana.user.id, mallory.cookie, "employee")).status).toBe(404);
  expect(await db.query(`SELECT 1 FROM skeleton.members WHERE user_id = '${mallory.user.id}'`)).toEqual([]);
});

const removeMember = (companyId: string, userId: string, cookie?: string) =>
  api(`/api/companies/${companyId}/members/${userId}`, { cookie, method: "DELETE" });

/** Every Company route a Member reaches, as a removed Member tries them. */
const companyRoutes = (companyId: string) => [
  `/api/companies/${companyId}`,
  `/api/companies/${companyId}/members`,
  `/api/companies/${companyId}/notes/welcome`,
];

test("the Owner removes another Member, who gets 404 on every Company route from the next call", async () => {
  const { ana, bruno, carla, company } = await acme();
  for (const path of companyRoutes(company.id)) expect((await api(path, { cookie: bruno.cookie })).status, path).toBe(200);

  const response = await removeMember(company.id, bruno.user.id, ana.cookie);

  expect(response.status).toBe(204);
  for (const path of companyRoutes(company.id)) {
    const after = await api(path, { cookie: bruno.cookie });
    expect(after.status, path).toBe(404);
    expect(await after.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  }
  expect((await changeRole(company.id, carla.user.id, bruno.cookie, "employee")).status).toBe(404);
  expect(((await (await api("/api/companies", { cookie: bruno.cookie })).json()) as { items: unknown[] }).items).toEqual([]);
  const members = (await (await api(`/api/companies/${company.id}/members`, { cookie: ana.cookie })).json()) as {
    items: { userId: string }[];
  };
  expect(members.items.map((member) => member.userId)).toEqual([ana.user.id, carla.user.id]);
});

test("a removed Member's writes on the Company answer 404, not 403, and change nothing", async () => {
  const { ana, bruno, carla, company } = await acme();
  expect((await removeMember(company.id, bruno.user.id, ana.cookie)).status).toBe(204);

  // `requireMember` refuses before `requireOwner` could tell the user the Company exists.
  for (const [method, path, body] of [
    ["PATCH", `/api/companies/${company.id}`, { name: "Hijacked" }],
    ["DELETE", `/api/companies/${company.id}`, { name: "Acme" }],
    ["GET", `/api/companies/${company.id}/invitations`, undefined],
    ["POST", `/api/companies/${company.id}/invitations`, { email: "eve@example.com", role: "employee" }],
    ["PATCH", `/api/companies/${company.id}/members/${carla.user.id}`, { role: "employee" }],
    ["DELETE", `/api/companies/${company.id}/members/${carla.user.id}`, undefined],
  ] as const) {
    const response = await api(path, { cookie: bruno.cookie, method, body });
    expect(response.status, `${method} ${path}`).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  }
  expect(await db.query(`SELECT name FROM skeleton.companies WHERE id = '${company.id}'`)).toEqual([{ name: "Acme" }]);
  expect(await roleOf(company.id, carla.user.id)).toEqual([{ role: "manager" }]);
  expect(await db.query(`SELECT 1 FROM skeleton.invitations WHERE company_id = '${company.id}'`)).toEqual([]);
});

test("a removed Member is a stranger to the Owner's actions: changing their role or removing them again answers 404", async () => {
  const { ana, bruno, company } = await acme();
  expect((await removeMember(company.id, bruno.user.id, ana.cookie)).status).toBe(204);

  expect((await changeRole(company.id, bruno.user.id, ana.cookie, "manager")).status).toBe(404);
  expect((await removeMember(company.id, bruno.user.id, ana.cookie)).status).toBe(404);
  expect(await roleOf(company.id, bruno.user.id)).toEqual([]);
});

test("an Employee or a Product's role removing a Member answers 403 FORBIDDEN, and the Member stays", async () => {
  const { ana, bruno, carla, company } = await acme();

  for (const [caller, target] of [
    [bruno, carla],
    [carla, bruno],
    [bruno, ana],
  ] as const) {
    const response = await removeMember(company.id, target.user.id, caller.cookie);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(forbidden);
  }
  expect(await db.query(`SELECT count(*)::int AS members FROM skeleton.members WHERE company_id = '${company.id}'`)).toEqual([
    { members: 3 },
  ]);
});

test("removing a user who is not a Member answers 404, and the Owner removing themselves 409 OWNER_MUST_TRANSFER", async () => {
  const { ana, company } = await acme();
  const mallory = await signedInUser("Mallory");

  expect((await removeMember(company.id, mallory.user.id, ana.cookie)).status).toBe(404);
  expect((await removeMember(company.id, ana.user.id, mallory.cookie)).status).toBe(404);
  const self = await removeMember(company.id, ana.user.id, ana.cookie);
  expect(self.status).toBe(409);
  expect(await self.json()).toEqual({
    code: "OWNER_MUST_TRANSFER",
    message: "The Owner cannot leave the Company. Transfer its ownership to another Member first.",
  });
  expect(await roleOf(company.id, ana.user.id)).toEqual([{ role: "owner" }]);
});

const leave = (companyId: string, cookie?: string) => api(`/api/companies/${companyId}/leave`, { cookie, method: "POST" });

test("there is no route to leave a Company: a Member cannot, the Owner neither", async () => {
  const { ana, bruno, company } = await acme();

  for (const caller of [bruno, ana]) expect((await leave(company.id, caller.cookie)).status).toBe(404);
  expect(await roleOf(company.id, bruno.user.id)).toEqual([{ role: "employee" }]);
  expect(await roleOf(company.id, ana.user.id)).toEqual([{ role: "owner" }]);
});

/**
 * Invites a new address to the Company and signs it up from the link, as the SPA does
 * (the verification link carries the Invitation's path back as `redirect`), then accepts.
 * Returns the person signed in; `createdByInvitation` says how their account was made.
 */
async function joinByInvitation(company: { id: string }, ownerCookie: string, name = "Dora Reis") {
  const email = `invited-${randomUUID()}@example.com`;
  const invited = await api(`/api/companies/${company.id}/invitations`, { cookie: ownerCookie, method: "POST", body: { email, role: "employee" } });
  expect(invited.status).toBe(201);
  await expect.poll(() => sent.some((e) => e.to.includes(email))).toBe(true);
  const token = linkIn(sent.findLast((e) => e.to.includes(email))!.html, "/invitations/").split("/invitations/")[1]!;
  const callbackURL = `/email-verified?${new URLSearchParams({ redirect: `/invitations/${token}` })}`;
  const signedUp = await worker.post("/api/auth/sign-up/email", { name, email, password: "correct horse battery", callbackURL });
  expect(signedUp.status).toBe(200);
  await db.query(`UPDATE skeleton.users SET email_verified = true WHERE email = '${email}'`);
  const [user] = await db.query<{ id: string }>(`SELECT id FROM skeleton.users WHERE email = '${email}'`);
  const cookie = (await testAuth.getAuthHeaders({ userId: user!.id })).get("cookie")!;
  expect((await api(`/api/invitations/${token}/accept`, { cookie, method: "POST" })).status).toBe(200);
  return { user: { id: user!.id, email }, cookie };
}

const userRows = (userId: string) => db.query(`SELECT 1 FROM skeleton.users WHERE id = '${userId}'`);

test("removing the last Company of an account created by an Invitation deletes the account and emails the person", async () => {
  const ana = await signedInUser("Ana Souza");
  const company = await createCompany(ana.cookie, "Acme");
  const dora = await joinByInvitation(company, ana.cookie);
  expect(await db.query(`SELECT created_by_invitation FROM skeleton.users WHERE id = '${dora.user.id}'`)).toEqual([{ created_by_invitation: true }]);

  expect((await removeMember(company.id, dora.user.id, ana.cookie)).status).toBe(204);

  expect(await userRows(dora.user.id)).toEqual([]);
  expect((await api("/api/me", { cookie: dora.cookie })).status).toBe(401);
  await expect.poll(() => sent.filter((e) => e.to.includes(dora.user.email)).map((e) => e.subject)).toEqual(expect.arrayContaining([expect.stringContaining("account was deleted")]));
});

test("a person with a live Subscription keeps the account when removed from the last Company", async () => {
  const ana = await signedInUser("Ana Souza");
  const company = await createCompany(ana.cookie, "Acme");
  const dora = await joinByInvitation(company, ana.cookie);
  await db.query(`INSERT INTO skeleton.subscriptions (id, plan, reference_id, status) VALUES ('${randomUUID()}', 'pro', '${dora.user.id}', 'active')`);

  expect((await removeMember(company.id, dora.user.id, ana.cookie)).status).toBe(204);

  expect(await userRows(dora.user.id)).toEqual([{ "?column?": 1 }]);
  expect(await roleOf(company.id, dora.user.id)).toEqual([]);
  expect((await api("/api/me", { cookie: dora.cookie })).status).toBe(200);
});

test("a canceled Subscription does not keep the account", async () => {
  const ana = await signedInUser("Ana Souza");
  const company = await createCompany(ana.cookie, "Acme");
  const dora = await joinByInvitation(company, ana.cookie);
  await db.query(`INSERT INTO skeleton.subscriptions (id, plan, reference_id, status) VALUES ('${randomUUID()}', 'pro', '${dora.user.id}', 'canceled')`);

  expect((await removeMember(company.id, dora.user.id, ana.cookie)).status).toBe(204);

  expect(await userRows(dora.user.id)).toEqual([]);
});

test("removing an account created by an Invitation from one of several Companies keeps the account", async () => {
  const ana = await signedInUser("Ana Souza");
  const acmeCompany = await createCompany(ana.cookie, "Acme");
  const globex = await createCompany((await signedInUser("Gil")).cookie, "Globex");
  const dora = await joinByInvitation(acmeCompany, ana.cookie);
  await join(globex.id, dora.user.id);

  expect((await removeMember(acmeCompany.id, dora.user.id, ana.cookie)).status).toBe(204);

  expect(await userRows(dora.user.id)).toEqual([{ "?column?": 1 }]);
  expect(await roleOf(globex.id, dora.user.id)).toEqual([{ role: "employee" }]);
});

test("a person who created the account on their own keeps it when removed, even after accepting an Invitation", async () => {
  const { ana, bruno, company } = await acme();
  expect(await db.query(`SELECT created_by_invitation FROM skeleton.users WHERE id = '${bruno.user.id}'`)).toEqual([{ created_by_invitation: false }]);

  expect((await removeMember(company.id, bruno.user.id, ana.cookie)).status).toBe(204);

  expect(await userRows(bruno.user.id)).toEqual([{ "?column?": 1 }]);
  expect((await api("/api/me", { cookie: bruno.cookie })).status).toBe(200);
});

test("signing up with the link of an Invitation for another address does not mark the account", async () => {
  const ana = await signedInUser("Ana Souza");
  const company = await createCompany(ana.cookie, "Acme");
  const email = `invited-${randomUUID()}@example.com`;
  await api(`/api/companies/${company.id}/invitations`, { cookie: ana.cookie, method: "POST", body: { email, role: "employee" } });
  await expect.poll(() => sent.some((e) => e.to.includes(email))).toBe(true);
  const token = linkIn(sent.findLast((e) => e.to.includes(email))!.html, "/invitations/").split("/invitations/")[1]!;
  const other = `other-${randomUUID()}@example.com`;
  const callbackURL = `/email-verified?${new URLSearchParams({ redirect: `/invitations/${token}` })}`;

  await worker.post("/api/auth/sign-up/email", { name: "Eve", email: other, password: "correct horse battery", callbackURL });

  expect(await db.query(`SELECT created_by_invitation FROM skeleton.users WHERE email = '${other}'`)).toEqual([{ created_by_invitation: false }]);
});

test("changing a role and removing answer 401 UNAUTHENTICATED without a session", async () => {
  const { bruno, company } = await acme();

  for (const response of [
    await changeRole(company.id, bruno.user.id, "", "manager"),
    await removeMember(company.id, bruno.user.id),
  ]) {
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  }
  expect(await roleOf(company.id, bruno.user.id)).toEqual([{ role: "employee" }]);
});

test("the Members' routes are described in the OpenAPI document with every response they answer", async () => {
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as {
    paths: Record<string, Record<string, { operationId: string; responses: object }>>;
  };

  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.values(methods).map((operation) => [operation.operationId, path, Object.keys(operation.responses).sort()]),
  );
  expect(operations).toEqual(
    expect.arrayContaining([
      ["changeMemberRole", "/api/companies/{companyId}/members/{userId}", ["200", "400", "401", "403", "404"]],
      ["removeMember", "/api/companies/{companyId}/members/{userId}", ["204", "401", "403", "404", "409"]],
    ]),
  );
});
