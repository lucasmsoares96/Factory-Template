import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { linkIn } from "../src/node/email-link.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

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

/** A verified user who signed up through the Worker, so their password is the one they chose. */
async function verifiedUser() {
  const email = `user-${randomUUID()}@example.com`;
  await worker.post("/api/auth/sign-up/email", {
    name: "Ana Souza",
    email,
    password: OLD_PASSWORD,
    callbackURL: "/email-verified",
  });
  await expect.poll(() => sent.some((e) => e.to.includes(email)), { timeout: 10_000 }).toBe(true);
  const link = new URL(linkIn(sent.find((e) => e.to.includes(email))!.html, "/api/auth/verify-email"));
  await worker.fetch(`${link.pathname}${link.search}`, { redirect: "manual" });
  return email;
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

/** What the account page sends. */
function changePassword(cookie: string, body: Record<string, unknown>) {
  return worker.post("/api/auth/change-password", body, { cookie });
}

const me = (cookie: string) => worker.fetch("/api/me", { headers: { cookie } });

test("with the right current password, the password changes and the user signs in with the new one only", async () => {
  const email = await verifiedUser();
  const cookie = cookieFrom(await signIn(email, OLD_PASSWORD));

  const response = await changePassword(cookie, { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });

  expect(response.status).toBe(200);
  const old = await signIn(email, OLD_PASSWORD);
  expect(old.status).toBe(401);
  expect(await old.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
  expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
});

test("changing the password keeps the session it was changed in and ends every other one", async () => {
  const email = await verifiedUser();
  const laptop = cookieFrom(await signIn(email, OLD_PASSWORD));
  const phone = cookieFrom(await signIn(email, OLD_PASSWORD));

  // Without `revokeOtherSessions`: the Worker ends the other sessions anyway.
  const response = await changePassword(laptop, { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });

  expect(response.status).toBe(200);
  const current = cookieFrom(response);
  expect((await me(current)).status).toBe(200);
  for (const cookie of [laptop, phone]) {
    const answer = await me(cookie);
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  }
});

test("the other sessions end even when the request asks to keep them", async () => {
  const email = await verifiedUser();
  const laptop = cookieFrom(await signIn(email, OLD_PASSWORD));
  const phone = cookieFrom(await signIn(email, OLD_PASSWORD));

  const response = await changePassword(laptop, {
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
    revokeOtherSessions: false,
  });

  expect(response.status).toBe(200);
  expect((await me(cookieFrom(response))).status).toBe(200);
  expect((await me(phone)).status).toBe(401);
});

test("a wrong current password answers 400 INVALID_PASSWORD and changes nothing", async () => {
  const email = await verifiedUser();
  const laptop = cookieFrom(await signIn(email, OLD_PASSWORD));
  const phone = cookieFrom(await signIn(email, OLD_PASSWORD));

  const response = await changePassword(laptop, { currentPassword: "not my password", newPassword: NEW_PASSWORD });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_PASSWORD" });
  for (const cookie of [laptop, phone]) expect((await me(cookie)).status).toBe(200);
  expect((await signIn(email, OLD_PASSWORD)).status).toBe(200);
  expect((await signIn(email, NEW_PASSWORD)).status).toBe(401);
});

test("a new password outside the rules answers its code and changes nothing", async () => {
  const email = await verifiedUser();
  const laptop = cookieFrom(await signIn(email, OLD_PASSWORD));
  const phone = cookieFrom(await signIn(email, OLD_PASSWORD));

  for (const [newPassword, code] of [
    ["short", "PASSWORD_TOO_SHORT"],
    ["a".repeat(129), "PASSWORD_TOO_LONG"],
  ]) {
    const response = await changePassword(laptop, { currentPassword: OLD_PASSWORD, newPassword });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
  }
  for (const cookie of [laptop, phone]) expect((await me(cookie)).status).toBe(200);
  expect((await signIn(email, OLD_PASSWORD)).status).toBe(200);
});

test("changing the password needs a session", async () => {
  const response = await worker.post("/api/auth/change-password", {
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
  });

  expect(response.status).toBe(401);
});
