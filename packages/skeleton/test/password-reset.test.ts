import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { messagesFor } from "../src/i18n/index.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { linkIn } from "../src/node/email-link.ts";
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

const OLD_PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new passphrase";
const RESET_PATH = "/api/auth/reset-password/";

/** A verified user who signed up through the Worker, so their password is the one they chose. */
async function verifiedUser() {
  const email = `user-${randomUUID()}@example.com`;
  await worker.post("/api/auth/sign-up/email", {
    name: "Ana Souza",
    email,
    password: OLD_PASSWORD,
    callbackURL: "/email-verified",
  });
  const [verification] = await emailsTo(email);
  await open(linkIn(verification!.html, "/api/auth/verify-email"));
  return email;
}

/** What the forgot-password screen sends. */
function askForAReset(email: string) {
  return worker.post("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" });
}

/** What the new-password screen sends, with the token the emailed link brought it. */
function setNewPassword(token: string, newPassword = NEW_PASSWORD) {
  return worker.post("/api/auth/reset-password", { token, newPassword });
}

function signIn(email: string, password: string) {
  return worker.post("/api/auth/sign-in/email", { email, password });
}

/** The `name=value` pairs of a response's cookies, as the browser sends them back. */
function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Opens a link the way the browser does when the user clicks it in the email. */
function open(link: string) {
  const url = new URL(link);
  return worker.fetch(`${url.pathname}${url.search}`, { redirect: "manual" });
}

/** The emails Resend received for `to`, once `count` of them arrived (they are sent after the response). */
async function emailsTo(to: string, count = 1) {
  await expect.poll(() => sent.filter((e) => e.to.includes(to)).length, { timeout: 10_000 }).toBe(count);
  return sent.filter((e) => e.to.includes(to));
}

/** The reset email for `to` (the verification email came first). */
async function resetEmailTo(to: string) {
  const emails = await emailsTo(to, 2);
  return emails[1]!;
}

/** Gives deferred work (emails go out after the response) time to run, before asserting nothing was sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 1_000));

/** Follows the emailed link: Better Auth checks the token and redirects to the SPA's new-password screen. */
async function tokenFromLink(link: string) {
  const response = await open(link);
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!, worker.origin);
  expect(location.pathname).toBe("/reset-password");
  return location.searchParams.get("token")!;
}

test("a user asks for a reset, follows the emailed link and signs in with the new password only", async () => {
  const email = await verifiedUser();

  const response = await askForAReset(email);

  expect(response.status).toBe(200);
  const message = await resetEmailTo(email);
  expect(message).toMatchObject({ from: TEST_EMAIL_FROM, subject: t.emails.resetPassword.subject });
  expect(message.text).toContain(t.emails.resetPassword.button);
  const token = await tokenFromLink(linkIn(message.html, RESET_PATH));

  const reset = await setNewPassword(token);

  expect(reset.status).toBe(200);
  const old = await signIn(email, OLD_PASSWORD);
  expect(old.status).toBe(401);
  expect(await old.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
  expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
});

test("resetting the password ends every session the user had open", async () => {
  const email = await verifiedUser();
  const laptop = cookieFrom(await signIn(email, OLD_PASSWORD));
  const phone = cookieFrom(await signIn(email, OLD_PASSWORD));
  expect((await worker.fetch("/api/me", { headers: { cookie: phone } })).status).toBe(200);

  await askForAReset(email);
  const token = await tokenFromLink(linkIn((await resetEmailTo(email)).html, RESET_PATH));
  expect((await setNewPassword(token)).status).toBe(200);

  for (const cookie of [laptop, phone]) {
    const me = await worker.fetch("/api/me", { headers: { cookie } });
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  }
  const fresh = cookieFrom(await signIn(email, NEW_PASSWORD));
  expect((await worker.fetch("/api/me", { headers: { cookie: fresh } })).status).toBe(200);
});

test("asking for a reset for an unknown email answers exactly like a registered one and sends nothing", async () => {
  const registered = await verifiedUser();
  const unknown = `nobody-${randomUUID()}@example.com`;

  const forRegistered = await askForAReset(registered);
  const forUnknown = await askForAReset(unknown);

  expect(forUnknown.status).toBe(forRegistered.status);
  expect(await forUnknown.json()).toEqual(await forRegistered.json());
  await resetEmailTo(registered);
  await settle();
  expect(sent.filter((e) => e.to.includes(unknown))).toEqual([]);
});

test("a reset link works once: used again, it changes nothing", async () => {
  const email = await verifiedUser();
  await askForAReset(email);
  const link = linkIn((await resetEmailTo(email)).html, RESET_PATH);
  const token = await tokenFromLink(link);
  await setNewPassword(token);

  const again = await setNewPassword(token, "someone else's password");

  expect(again.status).toBe(400);
  expect(await again.json()).toMatchObject({ code: "INVALID_TOKEN" });
  expect((await open(link)).headers.get("location")).toBe(`${worker.origin}/reset-password?error=INVALID_TOKEN`);
  expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
});

test("a tampered link lands on the new-password screen with the error code and resets nothing", async () => {
  const email = await verifiedUser();
  await askForAReset(email);
  const link = new URL(linkIn((await resetEmailTo(email)).html, RESET_PATH));
  link.pathname = `${link.pathname}x`;

  const response = await open(link.href);

  expect(response.headers.get("location")).toBe(`${worker.origin}/reset-password?error=INVALID_TOKEN`);
  const forged = await setNewPassword(link.pathname.slice(RESET_PATH.length));
  expect(await forged.json()).toMatchObject({ code: "INVALID_TOKEN" });
  expect((await signIn(email, OLD_PASSWORD)).status).toBe(200);
});

test("a too-short new password is refused and the link still works", async () => {
  const email = await verifiedUser();
  await askForAReset(email);
  const token = await tokenFromLink(linkIn((await resetEmailTo(email)).html, RESET_PATH));

  const short = await setNewPassword(token, "short");

  expect(short.status).toBe(400);
  expect(await short.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
  expect((await setNewPassword(token)).status).toBe(200);
});
