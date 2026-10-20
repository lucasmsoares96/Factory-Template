import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { messagesFor } from "../src/i18n/index.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { linkIn } from "../src/node/email-link.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { TEST_EMAIL_FROM, startTestWorker, type TestWorker } from "./support/worker.ts";

const t = messagesFor("en");
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

const uniqueEmail = () => `visitor-${randomUUID()}@example.com`;

const PASSWORD = "correct horse battery";

function signUp(email: string, password = PASSWORD) {
  return worker.post("/api/auth/sign-up/email", { name: "Ana Souza", email, password, callbackURL: "/email-verified" });
}

function signIn(email: string, password = PASSWORD) {
  return worker.post("/api/auth/sign-in/email", { email, password });
}

function askForANewLink(email: string) {
  return worker.post("/api/auth/send-verification-email", { email, callbackURL: "/email-verified" });
}

/** Gives deferred work (emails go out after the response) time to run, before asserting nothing was sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 1_000));

/** Opens the link the way the browser does when the user clicks it in the email. */
function open(link: string) {
  const url = new URL(link);
  return worker.fetch(`${url.pathname}${url.search}`, { redirect: "manual" });
}

/** The emails Resend received for `to`, once `count` of them arrived (they are sent after the response). */
async function emailsTo(to: string, count = 1) {
  await expect.poll(() => sent.filter((e) => e.to.includes(to)).length, { timeout: 10_000 }).toBe(count);
  return sent.filter((e) => e.to.includes(to));
}

async function userRow(email: string) {
  const [row] = await db.query<{ name: string; email_verified: boolean }>(
    `select name, email_verified from skeleton.users where email = '${email}'`,
  );
  return row;
}

test("signing up stores an unverified user and emails them a verification link through Resend", async () => {
  const email = uniqueEmail();

  const response = await signUp(email);

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await userRow(email)).toEqual({ name: "Ana Souza", email_verified: false });
  const [message] = await emailsTo(email);
  expect(message).toMatchObject({ from: TEST_EMAIL_FROM, subject: t.emails.verifyEmail.subject });
  expect(message!.text).toContain(t.emails.verifyEmail.button);
  expect(linkIn(message!.html, "/api/auth/verify-email")).toContain("callbackURL=%2Femail-verified");
});

test("the emailed link verifies the email and lands on the SPA's confirmation page", async () => {
  const email = uniqueEmail();
  await signUp(email);
  const [message] = await emailsTo(email);

  const response = await open(linkIn(message!.html, "/api/auth/verify-email"));

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/email-verified");
  expect(await userRow(email)).toMatchObject({ email_verified: true });
});

test("a tampered link verifies nothing and lands on the confirmation page with the error code", async () => {
  const email = uniqueEmail();
  await signUp(email);
  const [message] = await emailsTo(email);
  const link = new URL(linkIn(message!.html, "/api/auth/verify-email"));
  link.searchParams.set("token", `${link.searchParams.get("token")}x`);

  const response = await open(link.href);

  expect(response.headers.get("location")).toBe("/email-verified?error=INVALID_TOKEN");
  expect(await userRow(email)).toMatchObject({ email_verified: false });
});

test("an unverified user cannot sign in until they open the link", async () => {
  const email = uniqueEmail();
  await signUp(email);

  const refused = await signIn(email);

  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  expect(refused.headers.get("set-cookie")).toBeNull();

  const [message] = await emailsTo(email);
  await open(linkIn(message!.html, "/api/auth/verify-email"));
  const accepted = await signIn(email);

  expect(accepted.status).toBe(200);
  expect(accepted.headers.get("set-cookie")).toContain("better-auth.session_token=");
});

test("the stored password is Better Auth's default scrypt hash, so it outlives the Durable Object", async () => {
  const email = uniqueEmail();
  await signUp(email);

  const [account] = await db.query<{ password: string }>(
    `select a.password from skeleton.accounts a join skeleton.users u on u.id = a.user_id where u.email = '${email}'`,
  );

  expect(await verifyPassword({ hash: account!.password, password: PASSWORD })).toBe(true);
  expect(await verifyPassword({ hash: account!.password, password: "wrong password" })).toBe(false);
});

test("an unverified user can ask for a new link, and the new link verifies the email", async () => {
  const email = uniqueEmail();
  await signUp(email);
  await emailsTo(email);

  const response = await askForANewLink(email);

  expect(response.status).toBe(200);
  const [, again] = await emailsTo(email, 2);
  await open(linkIn(again!.html, "/api/auth/verify-email"));
  expect(await userRow(email)).toMatchObject({ email_verified: true });
});

test("asking for a link for a verified or unknown email answers the same and sends nothing", async () => {
  const verified = await testAuth.saveUser(testAuth.createUser({ email: uniqueEmail(), emailVerified: true }));
  const unknown = uniqueEmail();

  for (const email of [verified.email, unknown]) {
    const response = await askForANewLink(email);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
  }
  await settle();
  expect(sent.filter((e) => e.to.includes(verified.email) || e.to.includes(unknown))).toEqual([]);
});

test("signing up again with a registered email answers like a new sign-up and changes nothing", async () => {
  const email = uniqueEmail();
  const first = await signUp(email);
  const firstBody = (await first.json()) as object;
  await emailsTo(email);

  const second = await signUp(email, "another password 123");

  expect(second.status).toBe(first.status);
  expect(Object.keys((await second.json()) as object)).toEqual(Object.keys(firstBody));
  await settle();
  expect(await emailsTo(email)).toHaveLength(1);
  const [message] = await emailsTo(email);
  await open(linkIn(message!.html, "/api/auth/verify-email"));
  expect((await signIn(email, "another password 123")).status).toBe(401);
  expect((await signIn(email)).status).toBe(200);
});
