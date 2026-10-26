import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { linkIn } from "../src/node/email-link.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 1: the Worker over HTTP. The account page deletes the account through
// Better Auth's `/api/auth/delete-user`, confirming with the password.

const sent: SentEmail[] = [];
const resend = mockResend((email) => sent.push(email));
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
});
afterAll(async () => {
  await worker?.close();
  resend.close();
  await db?.drop();
});

const PASSWORD = "correct horse battery";

/** The `name=value` pairs of a response's cookies, as the browser sends them back. */
function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function signIn(email: string) {
  return worker.post("/api/auth/sign-in/email", { email, password: PASSWORD });
}

/** A verified user who signed up through the Worker, signed in: their id, email and session cookie. */
async function signedInUser(name = "Ana Souza") {
  const email = `user-${randomUUID()}@example.com`;
  await worker.post("/api/auth/sign-up/email", { name, email, password: PASSWORD, callbackURL: "/email-verified" });
  await expect.poll(() => sent.some((e) => e.to.includes(email)), { timeout: 10_000 }).toBe(true);
  const link = new URL(linkIn(sent.find((e) => e.to.includes(email))!.html, "/api/auth/verify-email"));
  await worker.fetch(`${link.pathname}${link.search}`, { redirect: "manual" });
  const response = await signIn(email);
  const { user } = (await response.json()) as { user: { id: string } };
  return { id: user.id, email, cookie: cookieFrom(response) };
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

/** Makes a user a Member of a Company (the test writes the row itself). */
function join(companyId: string, userId: string, role = "employee") {
  return db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${companyId}', '${userId}', '${role}')`);
}

/** What the account page sends. */
function deleteAccount(cookie: string, body: Record<string, unknown>) {
  return worker.post("/api/auth/delete-user", body, { cookie });
}

const me = (cookie: string) => worker.fetch("/api/me", { headers: { cookie } });

async function memberIdsOf(companyId: string, cookie: string) {
  const response = await api(`/api/companies/${companyId}/members`, { cookie });
  expect(response.status).toBe(200);
  const { items } = (await response.json()) as { items: { userId: string }[] };
  return items.map((member) => member.userId);
}

test("with the right password, the account is deleted: every session gets 401 and its Members are gone", async () => {
  const owner = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const phone = cookieFrom(await signIn(bruno.email));
  const acme = await createCompany(owner.cookie, "Acme");
  const globex = await createCompany(owner.cookie, "Globex");
  await join(acme.id, bruno.id);
  await join(globex.id, bruno.id);

  const response = await deleteAccount(bruno.cookie, { password: PASSWORD });

  expect(response.status).toBe(200);
  for (const cookie of [bruno.cookie, phone]) {
    const answer = await me(cookie);
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  }
  expect(await memberIdsOf(acme.id, owner.cookie)).toEqual([owner.id]);
  expect(await memberIdsOf(globex.id, owner.cookie)).toEqual([owner.id]);
  const again = await signIn(bruno.email);
  expect(again.status).toBe(401);
  expect(await again.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
});

test("an Owner of a Company gets 409 OWNER_OF_COMPANIES with those Companies, and nothing changes", async () => {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const acme = await createCompany(ana.cookie, "Acme");
  const globex = await createCompany(ana.cookie, "Globex");
  const initech = await createCompany(bruno.cookie, "Initech");
  await join(initech.id, ana.id);

  const response = await deleteAccount(ana.cookie, { password: PASSWORD });

  expect(response.status).toBe(409);
  const body = (await response.json()) as { code: string; message: string; companies: { id: string; name: string }[] };
  expect(body.code).toBe("OWNER_OF_COMPANIES");
  expect(body.message).toEqual(expect.any(String));
  // Only the Companies she owns, not those where she is an Employee.
  expect(body.companies).toHaveLength(2);
  expect(body.companies).toEqual(
    expect.arrayContaining([
      { id: acme.id, name: "Acme" },
      { id: globex.id, name: "Globex" },
    ]),
  );
  expect((await me(ana.cookie)).status).toBe(200);
  expect(await memberIdsOf(initech.id, bruno.cookie)).toEqual([bruno.id, ana.id]);
  expect((await signIn(ana.email)).status).toBe(200);
});

test("deleting the Company it owns lets the account be deleted", async () => {
  const ana = await signedInUser("Ana Souza");
  const acme = await createCompany(ana.cookie, "Acme");
  expect((await deleteAccount(ana.cookie, { password: PASSWORD })).status).toBe(409);

  const deleted = await api(`/api/companies/${acme.id}`, { cookie: ana.cookie, method: "DELETE", body: { name: "Acme" } });
  expect(deleted.status).toBe(204);

  expect((await deleteAccount(ana.cookie, { password: PASSWORD })).status).toBe(200);
  expect((await me(ana.cookie)).status).toBe(401);
});

test("a wrong password answers 400 INVALID_PASSWORD and changes nothing, Owner or not", async () => {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const acme = await createCompany(ana.cookie, "Acme");
  await join(acme.id, bruno.id);

  for (const user of [ana, bruno]) {
    const response = await deleteAccount(user.cookie, { password: "not my password" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PASSWORD" });
    expect((await me(user.cookie)).status).toBe(200);
    expect((await signIn(user.email)).status).toBe(200);
  }
  expect(await memberIdsOf(acme.id, ana.cookie)).toEqual([ana.id, bruno.id]);
});

test("without the password, the account is not deleted, even from a fresh session", async () => {
  const bruno = await signedInUser("Bruno Lima");

  const response = await deleteAccount(bruno.cookie, {});

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_PASSWORD" });
  expect((await me(bruno.cookie)).status).toBe(200);
});

test("deleting the account needs a session", async () => {
  const response = await worker.post("/api/auth/delete-user", { password: PASSWORD });

  expect(response.status).toBe(401);
});

test("the Invitations the user sent stay pending after the account is deleted", async () => {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const acme = await createCompany(ana.cookie, "Acme");
  await join(acme.id, bruno.id);
  // Bruno invites while Owner; then the Company goes back to Ana.
  const swap = (owner: string) =>
    db.query(`UPDATE skeleton.members SET role = CASE WHEN user_id = '${owner}' THEN 'owner' ELSE 'employee' END WHERE company_id = '${acme.id}'`);
  await db.query(`UPDATE skeleton.members SET role = 'employee' WHERE company_id = '${acme.id}'`);
  await swap(bruno.id);
  const address = `guest-${randomUUID()}@example.com`;
  const invited = await api(`/api/companies/${acme.id}/invitations`, {
    cookie: bruno.cookie,
    method: "POST",
    body: { email: address, role: "employee" },
  });
  expect(invited.status).toBe(201);
  const invitation = (await invited.json()) as { id: string };
  await db.query(`UPDATE skeleton.members SET role = 'employee' WHERE company_id = '${acme.id}'`);
  await swap(ana.id);

  expect((await deleteAccount(bruno.cookie, { password: PASSWORD })).status).toBe(200);

  const pending = await api(`/api/companies/${acme.id}/invitations`, { cookie: ana.cookie });
  const { items } = (await pending.json()) as { items: { id: string; email: string; invitedBy: unknown }[] };
  expect(items).toEqual([expect.objectContaining({ id: invitation.id, email: address, invitedBy: null })]);
  const resent = await api(`/api/companies/${acme.id}/invitations/${invitation.id}/resend`, { cookie: ana.cookie, method: "POST" });
  expect(resent.status).toBe(200);
});
