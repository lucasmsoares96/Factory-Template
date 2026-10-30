import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend } from "../src/node/resend-mock.ts";
import { linkStripeCustomer, listAccountsWithSeats, passwordProblem, upsertVerifiedUser, userExists, verifiedUserExists } from "../src/node/accounts.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// The accounts `pnpm bootstrap product` makes in the production database must sign in through the Worker.
const resend = mockResend(() => {});
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

const signIn = (email: string, password: string) => worker.post("/api/auth/sign-in/email", { email, password });
const cookieFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

test("a user inserted by the bootstrap signs in with no verification email, and GET /api/me answers them", async () => {
  const email = `Admin-${randomUUID()}@Example.com`;
  expect(await userExists({ databaseUrl: db.url, email })).toBe(false);

  expect(await upsertVerifiedUser({ databaseUrl: db.url, email, name: "Admin", password: "correct horse battery" })).toBe("created");

  expect(await userExists({ databaseUrl: db.url, email: email.toLowerCase() })).toBe(true);
  expect(await verifiedUserExists({ databaseUrl: db.url, email })).toBe(true);
  const response = await signIn(email, "correct horse battery");
  expect(response.status).toBe(200);
  const me = await worker.fetch("/api/me", { headers: { cookie: cookieFrom(response) } });
  expect(await me.json()).toMatchObject({ email: email.toLowerCase() });
  expect((await signIn(email, "wrong password 123")).status).toBe(401);
});

test("inserting the same email again resets the password and keeps one user", async () => {
  const email = `again-${randomUUID()}@example.com`;
  await upsertVerifiedUser({ databaseUrl: db.url, email, name: "Smoke", password: "first password 1" });

  expect(await upsertVerifiedUser({ databaseUrl: db.url, email, name: "Smoke", password: "second password 2" })).toBe("password-reset");

  expect((await signIn(email, "first password 1")).status).toBe(401);
  expect((await signIn(email, "second password 2")).status).toBe(200);
  const rows = await db.query<{ n: string }>(`SELECT count(*) AS n FROM skeleton.users WHERE email = '${email}'`);
  expect(rows[0]!.n).toBe("1");
});

test("a user who signed up but never verified is verified by the reset", async () => {
  const email = `late-${randomUUID()}@example.com`;
  await worker.post("/api/auth/sign-up/email", { name: "Late", email, password: "unverified pass 1", callbackURL: "/" });
  expect((await signIn(email, "unverified pass 1")).status).toBe(403);
  expect(await verifiedUserExists({ databaseUrl: db.url, email })).toBe(false);

  await upsertVerifiedUser({ databaseUrl: db.url, email, name: "Late", password: "verified pass 22" });

  expect((await signIn(email, "verified pass 22")).status).toBe(200);
});

test("passwordProblem applies the rules sign-up applies", async () => {
  expect(passwordProblem("short")).toMatch(/at least 8/);
  expect(passwordProblem("x".repeat(129))).toMatch(/at most 128/);
  expect(passwordProblem("long enough")).toBeUndefined();
  const email = `short-${randomUUID()}@example.com`;
  const tooShort = await worker.post("/api/auth/sign-up/email", { name: "S", email, password: "short", callbackURL: "/" });
  expect(tooShort.status).toBe(400);
});

test("the accounts that exist before billing are listed with the Seats they take, and a Stripe customer is linked to one", async () => {
  const owner = `owner-${randomUUID()}@example.com`;
  const member = `member-${randomUUID()}@example.com`;
  const loner = `loner-${randomUUID()}@example.com`;
  const subscribed = `paid-${randomUUID()}@example.com`;
  const archived = `gone-${randomUUID()}@example.com`;
  for (const email of [owner, member, loner, subscribed, archived]) await upsertVerifiedUser({ databaseUrl: db.url, email, name: email.split("-")[0]!, password: "correct horse battery" });
  const id = async (email: string) => (await db.query<{ id: string }>(`SELECT id FROM skeleton.users WHERE email = '${email}'`))[0]!.id;
  await db.query(`INSERT INTO skeleton.companies (id, name) VALUES ('c-seats-1', 'Acme'), ('c-seats-2', 'Beta')`);
  await db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('c-seats-1', '${await id(owner)}', 'owner'), ('c-seats-1', '${await id(member)}', 'employee'), ('c-seats-2', '${await id(owner)}', 'owner'), ('c-seats-2', '${await id(member)}', 'employee')`);
  await db.query(`INSERT INTO skeleton.invitations (id, company_id, email, role, token_hash, invited_by, expires_at) SELECT 'inv-seats-1', 'c-seats-2', 'guest@example.com', 'employee', 'hash-seats-1', '${await id(owner)}', now() + interval '7 days'`);
  await db.query(`INSERT INTO skeleton.subscriptions (id, plan, reference_id, status) VALUES ('sub-seats-1', 'prod_x', '${await id(subscribed)}', 'canceled')`);
  await db.query(`UPDATE skeleton.users SET archived_at = now() WHERE email = '${archived}'`);

  const listed = await listAccountsWithSeats({ databaseUrl: db.url });
  const byEmail = Object.fromEntries(listed.map((account) => [account.email, account]));

  // Owner, the Member (once, though in two Companies) and the pending Invitation.
  expect(byEmail[owner]).toMatchObject({ seats: 3, subscribed: false, stripeCustomerId: null });
  expect(byEmail[member]).toMatchObject({ seats: 1 });
  expect(byEmail[loner]).toMatchObject({ seats: 1 });
  expect(byEmail[subscribed]).toMatchObject({ subscribed: true });
  expect(byEmail[archived]).toBeUndefined();

  await linkStripeCustomer({ databaseUrl: db.url, userId: byEmail[owner]!.id, customerId: "cus_linked" });
  const [row] = await db.query<{ stripe_customer_id: string }>(`SELECT stripe_customer_id FROM skeleton.users WHERE email = '${owner}'`);
  expect(row?.stripe_customer_id).toBe("cus_linked");
  expect((await listAccountsWithSeats({ databaseUrl: db.url })).find((account) => account.email === owner)?.stripeCustomerId).toBe("cus_linked");
});
