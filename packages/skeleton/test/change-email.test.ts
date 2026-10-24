import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { messagesFor } from "../src/i18n/index.ts";
import { linkIn } from "../src/node/email-link.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { TEST_EMAIL_FROM, startTestWorker, type TestWorker } from "./support/worker.ts";

const t = messagesFor("en");
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
const VERIFY_PATH = "/api/auth/verify-email";

const newAddress = () => `user-${randomUUID()}@example.com`;

/** The emails Resend received for `to`, once `count` of them arrived (they are sent after the response). */
async function emailsTo(to: string, count = 1) {
  await expect.poll(() => sent.filter((e) => e.to.includes(to)).length, { timeout: 10_000 }).toBe(count);
  return sent.filter((e) => e.to.includes(to));
}

/** Gives deferred work (emails go out after the response) time to run, before asserting nothing was sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 1_000));

/** Opens a link the way the browser does when the user clicks it in the email. */
function open(link: string, cookie?: string) {
  const url = new URL(link);
  return worker.fetch(`${url.pathname}${url.search}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}

function signIn(email: string, password = PASSWORD) {
  return worker.post("/api/auth/sign-in/email", { email, password });
}

/** A verified user who signed up through the Worker, signed in: their email and session cookie. */
async function signedInUser() {
  const email = newAddress();
  await worker.post("/api/auth/sign-up/email", { name: "Ana Souza", email, password: PASSWORD, callbackURL: "/email-verified" });
  const [verification] = await emailsTo(email);
  await open(linkIn(verification!.html, VERIFY_PATH));
  const response = await signIn(email);
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { email, cookie };
}

/** What the account page sends. */
function changeEmail(newEmail: string, cookie?: string) {
  return worker.post(
    "/api/auth/change-email",
    { newEmail, callbackURL: "/email-verified" },
    cookie ? { cookie } : {},
  );
}

async function me(cookie: string) {
  return (await worker.fetch("/api/me", { headers: { cookie } })).json();
}

test("asking to change the email sends a verification email to the new address and keeps the old one until then", async () => {
  const { email, cookie } = await signedInUser();
  const newEmail = newAddress();

  const response = await changeEmail(newEmail, cookie);

  expect(response.status).toBe(200);
  const [message] = await emailsTo(newEmail);
  expect(message).toMatchObject({ from: TEST_EMAIL_FROM, subject: t.emails.changeEmail.subject });
  expect(message!.text).toContain(t.emails.changeEmail.button);
  expect(message!.text).toContain(newEmail);
  await settle();
  expect(sent.filter((e) => e.to.includes(email))).toHaveLength(1);
  expect(await me(cookie)).toMatchObject({ email, pendingEmail: newEmail });
  expect((await signIn(email)).status).toBe(200);
  const withNew = await signIn(newEmail);
  expect(withNew.status).toBe(401);
  expect(await withNew.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
});

test("opening the link in the new address changes the account's email: it signs in with the new one only", async () => {
  const { email, cookie } = await signedInUser();
  const newEmail = newAddress();
  await changeEmail(newEmail, cookie);
  const [message] = await emailsTo(newEmail);

  const verified = await open(linkIn(message!.html, VERIFY_PATH));

  expect(verified.status).toBe(302);
  expect(new URL(verified.headers.get("location")!, worker.origin).pathname).toBe("/email-verified");
  expect(await me(cookie)).toMatchObject({ email: newEmail, pendingEmail: null });
  expect((await signIn(newEmail)).status).toBe(200);
  const withOld = await signIn(email);
  expect(withOld.status).toBe(401);
  expect(await withOld.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
});

test("an email that belongs to another account is refused with a stable code, and nothing is sent", async () => {
  const other = await signedInUser();
  const { email, cookie } = await signedInUser();

  const response = await changeEmail(other.email.toUpperCase(), cookie);

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" });
  await settle();
  expect(sent.filter((e) => e.to.includes(other.email))).toHaveLength(1);
  expect(await me(cookie)).toMatchObject({ email, pendingEmail: null });
});

test("a link to an address another account took in the meantime is refused with a stable code, and changes nothing", async () => {
  const { email, cookie } = await signedInUser();
  const newEmail = newAddress();
  await changeEmail(newEmail, cookie);
  const [message] = await emailsTo(newEmail);
  await worker.post("/api/auth/sign-up/email", { name: "Bruno", email: newEmail, password: PASSWORD, callbackURL: "/email-verified" });

  const verified = await open(linkIn(message!.html, VERIFY_PATH));

  expect(verified.status).toBe(302);
  const location = new URL(verified.headers.get("location")!, worker.origin);
  expect(location.pathname).toBe("/email-verified");
  expect(location.searchParams.get("error")).toBe("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
  expect(await me(cookie)).toMatchObject({ email });
  expect((await signIn(email)).status).toBe(200);
});

test("asking to change the email needs a session, and says nothing about who owns an address", async () => {
  const other = await signedInUser();

  const response = await changeEmail(other.email);

  expect(response.status).toBe(401);
  expect(await response.json()).not.toMatchObject({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" });
});

test("GET /api/me answers no pending email when no change was asked", async () => {
  const { email, cookie } = await signedInUser();

  expect(await me(cookie)).toMatchObject({ email, pendingEmail: null });
});
