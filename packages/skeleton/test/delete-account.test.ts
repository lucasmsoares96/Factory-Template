import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { linkIn } from "../src/node/email-link.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 1: the Worker over HTTP. The account page deletes the account through
// Better Auth's `/api/auth/delete-user`, confirming with the password: an account
// in no Company and with no active Subscription is archived for 30 days, then the
// Worker's daily cron deletes it (the tests age the archive in the database).

const sent: SentEmail[] = [];
const resend = mockResend((email) => sent.push(email));
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
/** The same database on a Worker with the fake Stripe, for the accounts that pay. */
let billed: TestWorker;
const WEBHOOK_SECRET = "whsec_test";

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
  billed = await startTestWorker({ databaseUrl: db.url, vars: { STRIPE_FAKE: "true", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } });
});
afterAll(async () => {
  await worker?.close();
  await billed?.close();
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

/** Pretends `days` days went by since the account was archived. */
function ageArchive(userId: string, days: number) {
  return db.query(`UPDATE skeleton.users SET archived_at = now() - interval '${days} days' WHERE id = '${userId}'`);
}

async function archivedAt(userId: string) {
  const [row] = await db.query<{ archived_at: Date | null }>(`SELECT archived_at FROM skeleton.users WHERE id = '${userId}'`);
  return row === undefined ? "gone" : row.archived_at;
}

test("with the right password, an account in no Company is archived: every session gets 401 and the 30 days are announced", async () => {
  const bruno = await signedInUser("Bruno Lima");
  const phone = cookieFrom(await signIn(bruno.email));

  const response = await deleteAccount(bruno.cookie, { password: PASSWORD });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { code: string; deleteAt: string };
  expect(body.code).toBe("ACCOUNT_ARCHIVED");
  expect(new Date(body.deleteAt).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  expect(new Date(body.deleteAt).getTime()).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000);
  expect(await archivedAt(bruno.id)).toBeInstanceOf(Date);
  for (const cookie of [bruno.cookie, phone]) {
    const answer = await me(cookie);
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  }
});

test("signing in to an archived account cancels the deletion", async () => {
  const bruno = await signedInUser("Bruno Lima");
  expect((await deleteAccount(bruno.cookie, { password: PASSWORD })).status).toBe(200);
  await ageArchive(bruno.id, 29);

  const back = await signIn(bruno.email);

  expect(back.status).toBe(200);
  expect(await archivedAt(bruno.id)).toBeNull();
  expect((await me(cookieFrom(back))).status).toBe(200);
  // The 30 days no longer count: the sweep leaves the account alone.
  await worker.scheduled();
  expect(await archivedAt(bruno.id)).toBeNull();
});

test("after 30 days the daily sweep deletes the account; before, it stays archived", async () => {
  const bruno = await signedInUser("Bruno Lima");
  expect((await deleteAccount(bruno.cookie, { password: PASSWORD })).status).toBe(200);

  await ageArchive(bruno.id, 29);
  await worker.scheduled();
  expect(await archivedAt(bruno.id)).toBeInstanceOf(Date);

  await ageArchive(bruno.id, 31);
  await worker.scheduled();
  expect(await archivedAt(bruno.id)).toBe("gone");
  const again = await signIn(bruno.email);
  expect(again.status).toBe(401);
  expect(await again.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
});

test("the sweep route answers only the Worker's own cron", async () => {
  const response = await worker.post("/api/internal/purge-archived", {});

  expect(response.status).toBe(404);
});

test("a Member gets 409 MEMBER_OF_COMPANIES with their Companies, and nothing changes until the Owner removes them", async () => {
  const owner = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const acme = await createCompany(owner.cookie, "Acme");
  const globex = await createCompany(owner.cookie, "Globex");
  await join(acme.id, bruno.id);
  await join(globex.id, bruno.id);

  const response = await deleteAccount(bruno.cookie, { password: PASSWORD });

  expect(response.status).toBe(409);
  const body = (await response.json()) as { code: string; companies: { id: string; name: string }[] };
  expect(body.code).toBe("MEMBER_OF_COMPANIES");
  expect(body.companies).toEqual([
    { id: acme.id, name: "Acme" },
    { id: globex.id, name: "Globex" },
  ]);
  expect((await me(bruno.cookie)).status).toBe(200);
  expect(await archivedAt(bruno.id)).toBeNull();

  for (const company of [acme, globex]) {
    const removed = await api(`/api/companies/${company.id}/members/${bruno.id}`, { cookie: owner.cookie, method: "DELETE" });
    expect(removed.status).toBe(204);
  }
  expect((await deleteAccount(bruno.cookie, { password: PASSWORD })).status).toBe(200);
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
  expect(await archivedAt(ana.id)).toBeNull();
  expect((await signIn(ana.email)).status).toBe(200);
});

test("deleting the Company it owns lets the account be archived", async () => {
  const ana = await signedInUser("Ana Souza");
  const acme = await createCompany(ana.cookie, "Acme");
  expect((await deleteAccount(ana.cookie, { password: PASSWORD })).status).toBe(409);

  const deleted = await api(`/api/companies/${acme.id}`, { cookie: ana.cookie, method: "DELETE", body: { name: "Acme" } });
  expect(deleted.status).toBe(204);

  expect((await deleteAccount(ana.cookie, { password: PASSWORD })).status).toBe(200);
  expect((await me(ana.cookie)).status).toBe(401);
});

test("a wrong password answers 400 INVALID_PASSWORD and changes nothing, Owner or Member", async () => {
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

  // Nor with Better Auth's emailed deletion token, alone or beside it.
  for (const body of [{}, { password: "" }, { token: "anything" }, { password: PASSWORD, token: "anything" }]) {
    const response = await deleteAccount(bruno.cookie, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PASSWORD" });
    expect((await me(bruno.cookie)).status).toBe(200);
  }
});

test("deleting the account needs a session", async () => {
  const response = await worker.post("/api/auth/delete-user", { password: PASSWORD });

  expect(response.status).toBe(401);
});

test("the Invitations the user sent stay pending after the account is deleted", async () => {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  // Bruno invites as the Owner of Acme; then Acme passes to Ana and he leaves it.
  const acme = await createCompany(bruno.cookie, "Acme");
  const address = `guest-${randomUUID()}@example.com`;
  const invited = await api(`/api/companies/${acme.id}/invitations`, {
    cookie: bruno.cookie,
    method: "POST",
    body: { email: address, role: "employee" },
  });
  expect(invited.status).toBe(201);
  const invitation = (await invited.json()) as { id: string };
  await db.query(`DELETE FROM skeleton.members WHERE company_id = '${acme.id}' AND user_id = '${bruno.id}'`);
  await join(acme.id, ana.id, "owner");

  expect((await deleteAccount(bruno.cookie, { password: PASSWORD })).status).toBe(200);
  await ageArchive(bruno.id, 31);
  await worker.scheduled();
  expect(await archivedAt(bruno.id)).toBe("gone");

  const pending = await api(`/api/companies/${acme.id}/invitations`, { cookie: ana.cookie });
  const { items } = (await pending.json()) as { items: { id: string; email: string; invitedBy: unknown }[] };
  expect(items).toEqual([expect.objectContaining({ id: invitation.id, email: address, invitedBy: null })]);
  // Still acceptable (accepting an Invitation comes later): neither accepted,
  // canceled nor expired, and Ana can resend it.
  const [row] = await db.query<{ open: boolean }>(
    `SELECT accepted_at IS NULL AND canceled_at IS NULL AND expires_at > now() AS open FROM skeleton.invitations WHERE id = '${invitation.id}'`,
  );
  expect(row?.open).toBe(true);
  const resent = await api(`/api/companies/${acme.id}/invitations/${invitation.id}/resend`, { cookie: ana.cookie, method: "POST" });
  expect(resent.status).toBe(200);
});

// Accounts that pay: the Subscription lives in the fake Stripe.

const FAKE = "/api/fake-stripe/control";
const billedPost = (path: string, body: unknown, cookie: string) => billed.post(path, body, { cookie });

/** Subscribes `user` to the fake Stripe's Pro plan, through Checkout. */
async function subscribe(cookie: string) {
  const opened = await billedPost("/api/billing/subscribe", { plan: "prod_fake_pro" }, cookie);
  expect(opened.status).toBe(200);
  const { url } = (await opened.json()) as { url: string };
  const paid = await billed.fetch(`${new URL(url).pathname}/pay`, { method: "POST", redirect: "manual" });
  expect(paid.status).toBe(303);
}

async function stripeSubscriptions() {
  const response = await billed.fetch(`${FAKE}/subscriptions`);
  return ((await response.json()) as { subscriptions: { id: string; status: string; cancelAtPeriodEnd: boolean }[] }).subscriptions;
}

test("with an active Subscription the deletion is refused with the day the plan stays valid, until it is canceled", async () => {
  await billed.post(`${FAKE}/reset`, {});
  const ana = await signedInUser("Ana Souza");
  const cookie = cookieFrom(await billed.post("/api/auth/sign-in/email", { email: ana.email, password: PASSWORD }));
  await subscribe(cookie);
  const [paid] = await stripeSubscriptions();

  const refused = await billedPost("/api/auth/delete-user", { password: PASSWORD }, cookie);

  expect(refused.status).toBe(409);
  const body = (await refused.json()) as { code: string; periodEnd: string };
  expect(body.code).toBe("SUBSCRIPTION_ACTIVE");
  expect(new Date(body.periodEnd).getTime()).toBeGreaterThan(Date.now() + 27 * 24 * 60 * 60 * 1000);
  expect(await archivedAt(ana.id)).toBeNull();
  expect((await billed.fetch("/api/me", { headers: { cookie } })).status).toBe(200);

  // Canceled, it keeps its paid days: the deletion goes through.
  await billed.post(`${FAKE}/cancel`, { subscription: paid!.id });
  const archived = await billedPost("/api/auth/delete-user", { password: PASSWORD }, cookie);
  expect(archived.status).toBe(200);
  expect(await stripeSubscriptions()).toEqual([{ id: paid!.id, status: "active", cancelAtPeriodEnd: true }]);
});

test("after 30 days a canceled Subscription with paid days left ends in Stripe with the account", async () => {
  await billed.post(`${FAKE}/reset`, {});
  const ana = await signedInUser("Ana Souza");
  const cookie = cookieFrom(await billed.post("/api/auth/sign-in/email", { email: ana.email, password: PASSWORD }));
  await subscribe(cookie);
  const [paid] = await stripeSubscriptions();
  await billed.post(`${FAKE}/cancel`, { subscription: paid!.id });
  expect((await billedPost("/api/auth/delete-user", { password: PASSWORD }, cookie)).status).toBe(200);

  await ageArchive(ana.id, 29);
  await billed.scheduled();
  expect(await stripeSubscriptions()).toEqual([{ id: paid!.id, status: "active", cancelAtPeriodEnd: true }]);

  await ageArchive(ana.id, 31);
  await billed.scheduled();

  expect(await archivedAt(ana.id)).toBe("gone");
  expect(await stripeSubscriptions()).toEqual([{ id: paid!.id, status: "canceled", cancelAtPeriodEnd: true }]);
});
