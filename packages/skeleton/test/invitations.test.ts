import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { TEST_EMAIL_FROM, startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 1: the Worker over HTTP. Every test brings its own users, Companies and addresses.

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
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  resend.close();
  await db?.drop();
});

const DAY = 24 * 60 * 60 * 1000;

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
  return (await response.json()) as { id: string; name: string };
}

/** Makes a user a Member of a Company (accepting an Invitation comes later: the test writes the row itself). */
function join(companyId: string, userId: string, role = "employee") {
  return db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${companyId}', '${userId}', '${role}')`);
}

const newAddress = () => `guest-${randomUUID()}@example.com`;

function invite(companyId: string, cookie: string, body: unknown) {
  return api(`/api/companies/${companyId}/invitations`, { cookie, method: "POST", body });
}

/** The emails the Worker sent to `to`, oldest first. */
function emailsTo(to: string) {
  return sent.filter((email) => email.to.includes(to));
}

/** The token of the link in an Invitation email. */
function tokenIn(email: SentEmail) {
  const match = /\/invitations\/([A-Za-z0-9_-]+)/.exec(email.html);
  expect(match, "no Invitation link in the email").not.toBeNull();
  return match![1]!;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

type Invitation = { id: string; email: string; role: string; invitedBy: { userId: string; name: string } | null; expiresAt: string; createdAt: string };

test("the Owner invites an address with a role: the Invitation lasts 7 days and its link leaves by email", async () => {
  const ana = await signedInUser("Ana Souza");
  const company = await createCompany(ana.cookie, "Acme");
  const address = newAddress();
  const before = Date.now();

  const response = await invite(company.id, ana.cookie, { email: address, role: "employee" });

  expect(response.status).toBe(201);
  const invitation = (await response.json()) as Invitation;
  expect(invitation).toEqual({
    id: expect.any(String),
    email: address,
    role: "employee",
    invitedBy: { userId: ana.user.id, name: "Ana Souza" },
    expiresAt: expect.any(String),
    createdAt: expect.any(String),
  });
  const lasts = new Date(invitation.expiresAt).getTime() - before;
  expect(lasts).toBeGreaterThanOrEqual(7 * DAY - 60_000);
  expect(lasts).toBeLessThanOrEqual(7 * DAY + 60_000);

  const [email] = emailsTo(address);
  expect(email).toMatchObject({ from: TEST_EMAIL_FROM, to: [address], subject: "Ana Souza invited you to join Acme" });
  expect(email!.text).toContain("Acme");
  expect(email!.text).toContain("Ana Souza");
  expect(email!.html).toContain(`${worker.origin}/invitations/${tokenIn(email!)}`);
  expect(emailsTo(address)).toHaveLength(1);
});

test("inviting a Member answers 409 ALREADY_A_MEMBER, whatever the case of the address, and sends nothing", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);

  for (const email of [bruno.user.email, bruno.user.email.toUpperCase(), ana.user.email]) {
    const response = await invite(company.id, ana.cookie, { email, role: "employee" });
    expect(response.status, email).toBe(409);
    expect(await response.json()).toEqual({ code: "ALREADY_A_MEMBER", message: "This email already belongs to a Member of the Company." });
  }
  expect(emailsTo(bruno.user.email)).toEqual([]);
  expect(await db.query(`SELECT 1 FROM skeleton.invitations WHERE company_id = '${company.id}'`)).toEqual([]);
});

test("a second pending Invitation for the same address and Company answers 409 INVITATION_PENDING; another Company may invite it", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);
  const other = await createCompany(ana.cookie, "Globex");
  const address = newAddress();
  expect((await invite(company.id, ana.cookie, { email: address, role: "employee" })).status).toBe(201);

  const again = await invite(company.id, ana.cookie, { email: address.toUpperCase(), role: "employee" });

  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({
    code: "INVITATION_PENDING",
    message: "This email already has a pending Invitation to the Company. Resend it instead.",
  });
  expect(emailsTo(address)).toHaveLength(1);
  expect((await invite(other.id, ana.cookie, { email: address, role: "employee" })).status).toBe(201);
});

test("the role owner, a role the Product does not have and an invalid email answer 400 VALIDATION_FAILED", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);
  const address = newAddress();

  for (const body of [
    { email: address, role: "owner" },
    { email: address, role: "nobody" },
    { email: "not an email", role: "employee" },
    { email: address },
  ]) {
    const response = await invite(company.id, ana.cookie, body);
    expect(response.status, JSON.stringify(body)).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
  expect(emailsTo(address)).toEqual([]);
});

test("a role the Product adds to member_roles can be invited", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);

  const response = await invite(company.id, ana.cookie, { email: newAddress(), role: "manager" });

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ role: "manager" });
});

test("an Employee, or a role the Product adds, gets 403 FORBIDDEN on every Invitation action; a non-Member gets 404", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id, "manager");
  const address = newAddress();
  const { id } = (await (await invite(company.id, ana.cookie, { email: address, role: "employee" })).json()) as Invitation;

  const actions = [
    { path: `/api/companies/${company.id}/invitations`, method: "POST", body: { email: newAddress(), role: "employee" } },
    { path: `/api/companies/${company.id}/invitations`, method: "GET" },
    { path: `/api/companies/${company.id}/invitations/${id}/resend`, method: "POST" },
    { path: `/api/companies/${company.id}/invitations/${id}`, method: "DELETE" },
  ];
  for (const { path, method, body } of actions) {
    for (const cookie of [bruno.cookie, carla.cookie]) {
      const response = await api(path, { cookie, method, body });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "Your role in this Company does not allow this." });
    }
    const foreign = await api(path, { cookie: mallory.cookie, method, body });
    expect(foreign.status, `${method} ${path}`).toBe(404);
    expect((await api(path, { method, body })).status).toBe(401);
  }
  expect(emailsTo(address)).toHaveLength(1);
  const [row] = await db.query<{ canceled_at: Date | null }>(`SELECT canceled_at FROM skeleton.invitations WHERE id = '${id}'`);
  expect(row!.canceled_at).toBeNull();
});

type Page<T> = { items: T[]; nextCursor: string | null };

async function pendingOf(companyId: string, cookie: string, query = "") {
  const response = await api(`/api/companies/${companyId}/invitations${query}`, { cookie });
  expect(response.status).toBe(200);
  return (await response.json()) as Page<Invitation>;
}

test("the pending list answers email, role, who invited and the expiry, oldest first, page by page", async () => {
  const ana = await signedInUser("Ana Souza");
  const company = await createCompany(ana.cookie);
  const created: Invitation[] = [];
  for (let i = 0; i < 52; i++) {
    created.push((await (await invite(company.id, ana.cookie, { email: newAddress(), role: "employee" })).json()) as Invitation);
  }

  const first = await pendingOf(company.id, ana.cookie);
  expect(first.items).toHaveLength(50);
  expect(first.items[0]).toEqual({
    id: created[0]!.id,
    email: created[0]!.email,
    role: "employee",
    invitedBy: { userId: ana.user.id, name: "Ana Souza" },
    expiresAt: created[0]!.expiresAt,
    createdAt: created[0]!.createdAt,
  });
  const second = await pendingOf(company.id, ana.cookie, `?cursor=${first.nextCursor}`);
  expect(second.nextCursor).toBeNull();
  expect([...first.items, ...second.items].map((invitation) => invitation.id)).toEqual(created.map((invitation) => invitation.id));
  const small = await pendingOf(company.id, ana.cookie, "?limit=2");
  expect(small.items.map((invitation) => invitation.id)).toEqual(created.slice(0, 2).map((invitation) => invitation.id));
  expect((await api(`/api/companies/${company.id}/invitations?cursor=nonsense`, { cookie: ana.cookie })).status).toBe(400);
});

test("the pending list leaves out canceled and accepted Invitations, and those of other Companies", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);
  const other = await createCompany(ana.cookie, "Globex");
  const [kept, canceled, accepted] = await Promise.all(
    [0, 1, 2].map(async () => (await (await invite(company.id, ana.cookie, { email: newAddress(), role: "employee" })).json()) as Invitation),
  );
  await invite(other.id, ana.cookie, { email: newAddress(), role: "employee" });
  await api(`/api/companies/${company.id}/invitations/${canceled!.id}`, { cookie: ana.cookie, method: "DELETE" });
  // Accepting comes later: the test marks the row itself.
  await db.query(`UPDATE skeleton.invitations SET accepted_at = now() WHERE id = '${accepted!.id}'`);

  const page = await pendingOf(company.id, ana.cookie);

  expect(page.items.map((invitation) => invitation.id)).toEqual([kept!.id]);
});

test("resending renews the 7 days and sends a new link; the previous link stops working", async () => {
  const ana = await signedInUser("Ana Souza");
  const company = await createCompany(ana.cookie, "Acme");
  const address = newAddress();
  const invitation = (await (await invite(company.id, ana.cookie, { email: address, role: "employee" })).json()) as Invitation;
  const firstToken = tokenIn(emailsTo(address)[0]!);
  // Five days later, or already expired: resending renews it from now.
  await db.query(`UPDATE skeleton.invitations SET expires_at = now() - interval '1 day' WHERE id = '${invitation.id}'`);
  const before = Date.now();

  const response = await api(`/api/companies/${company.id}/invitations/${invitation.id}/resend`, { cookie: ana.cookie, method: "POST" });

  expect(response.status).toBe(200);
  const renewed = (await response.json()) as Invitation;
  expect(renewed).toEqual({ ...invitation, expiresAt: expect.any(String) });
  expect(new Date(renewed.expiresAt).getTime() - before).toBeGreaterThanOrEqual(7 * DAY - 60_000);
  const emails = emailsTo(address);
  expect(emails).toHaveLength(2);
  expect(emails[1]!.subject).toBe("Ana Souza invited you to join Acme");
  const secondToken = tokenIn(emails[1]!);
  expect(secondToken).not.toBe(firstToken);
  expect(await db.query(`SELECT token_hash FROM skeleton.invitations WHERE id = '${invitation.id}'`)).toEqual([
    { token_hash: sha256(secondToken) },
  ]);
  expect((await pendingOf(company.id, ana.cookie)).items).toEqual([renewed]);
});

test("canceling makes the link stop working and the Invitation leave the pending list; it cannot be resent or canceled again", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);
  const address = newAddress();
  const invitation = (await (await invite(company.id, ana.cookie, { email: address, role: "employee" })).json()) as Invitation;
  const token = tokenIn(emailsTo(address)[0]!);

  const response = await api(`/api/companies/${company.id}/invitations/${invitation.id}`, { cookie: ana.cookie, method: "DELETE" });

  expect(response.status).toBe(204);
  // No pending Invitation answers to the link's token any more.
  expect(
    await db.query(
      `SELECT 1 FROM skeleton.invitations WHERE token_hash = '${sha256(token)}' AND accepted_at IS NULL AND canceled_at IS NULL`,
    ),
  ).toEqual([]);
  expect((await pendingOf(company.id, ana.cookie)).items).toEqual([]);
  for (const [path, method] of [
    [`/api/companies/${company.id}/invitations/${invitation.id}/resend`, "POST"],
    [`/api/companies/${company.id}/invitations/${invitation.id}`, "DELETE"],
  ] as const) {
    const again = await api(path, { cookie: ana.cookie, method });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  }
  expect(emailsTo(address)).toHaveLength(1);
  // The address can be invited again.
  expect((await invite(company.id, ana.cookie, { email: address, role: "employee" })).status).toBe(201);
});

test("an Invitation of another Company cannot be resent or canceled through this one", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);
  const other = await createCompany(ana.cookie, "Globex");
  const invitation = (await (await invite(other.id, ana.cookie, { email: newAddress(), role: "employee" })).json()) as Invitation;

  expect((await api(`/api/companies/${company.id}/invitations/${invitation.id}/resend`, { cookie: ana.cookie, method: "POST" })).status).toBe(404);
  expect((await api(`/api/companies/${company.id}/invitations/${invitation.id}`, { cookie: ana.cookie, method: "DELETE" })).status).toBe(404);
  expect((await pendingOf(other.id, ana.cookie)).items).toHaveLength(1);
});

test("the database keeps only the hash of the link's token", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);
  const address = newAddress();
  const invitation = (await (await invite(company.id, ana.cookie, { email: address, role: "employee" })).json()) as Invitation;
  const token = tokenIn(emailsTo(address)[0]!);

  const [row] = await db.query<Record<string, unknown>>(`SELECT * FROM skeleton.invitations WHERE id = '${invitation.id}'`);

  expect(row!.token_hash).toBe(sha256(token));
  expect(JSON.stringify(row)).not.toContain(token);
});

test("deleting the account of whoever invited keeps the Invitation, pending and resendable", async () => {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  // Bruno invites while Owner; then the Company goes back to Ana and Bruno's account is deleted.
  await db.query(`UPDATE skeleton.members SET role = CASE WHEN user_id = '${ana.user.id}' THEN 'employee' ELSE 'owner' END WHERE company_id = '${company.id}'`);
  const address = newAddress();
  const invitation = (await (await invite(company.id, bruno.cookie, { email: address, role: "employee" })).json()) as Invitation;
  expect(invitation.invitedBy).toEqual({ userId: bruno.user.id, name: "Bruno Lima" });
  await db.query(`DELETE FROM skeleton.users WHERE id = '${bruno.user.id}'`);
  await db.query(`UPDATE skeleton.members SET role = 'owner' WHERE company_id = '${company.id}' AND user_id = '${ana.user.id}'`);

  expect((await pendingOf(company.id, ana.cookie)).items).toEqual([{ ...invitation, invitedBy: null }]);
  const resent = await api(`/api/companies/${company.id}/invitations/${invitation.id}/resend`, { cookie: ana.cookie, method: "POST" });
  expect(resent.status).toBe(200);
  expect(emailsTo(address).at(-1)!.subject).toBe("Ana Souza invited you to join Acme");
});

test("a Product's route builds an Invitation through the exported createInvitation, with its own rules", async () => {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  const address = newAddress();

  // The test composition's `notes` feature lets any Member invite, always as `employee`.
  const response = await api(`/api/companies/${company.id}/notes/invitations`, {
    cookie: bruno.cookie,
    method: "POST",
    body: { email: address },
  });

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ email: address, role: "employee", invitedBy: { userId: bruno.user.id, name: "Bruno Lima" } });
  const [email] = emailsTo(address);
  expect(email!.subject).toBe("Bruno Lima invited you to join Acme");
  expect((await pendingOf(company.id, ana.cookie)).items.map((invitation) => invitation.email)).toEqual([address]);
  const again = await api(`/api/companies/${company.id}/notes/invitations`, { cookie: bruno.cookie, method: "POST", body: { email: address } });
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({ code: "INVITATION_PENDING" });
});

test("every Invitation route is described in the OpenAPI document", async () => {
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as {
    paths: Record<string, Record<string, { operationId: string; responses: object }>>;
  };

  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.values(methods).map((operation) => [operation.operationId, path, Object.keys(operation.responses).sort()]),
  );
  expect(operations).toEqual(
    expect.arrayContaining([
      ["createInvitation", "/api/companies/{companyId}/invitations", ["201", "400", "401", "403", "404", "409"]],
      ["listInvitations", "/api/companies/{companyId}/invitations", ["200", "400", "401", "403", "404"]],
      ["resendInvitation", "/api/companies/{companyId}/invitations/{invitationId}/resend", ["200", "401", "403", "404"]],
      ["cancelInvitation", "/api/companies/{companyId}/invitations/{invitationId}", ["204", "401", "403", "404"]],
    ]),
  );
});
