import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { linkIn } from "../src/node/email-link.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { randomIp, startTestWorker, type TestWorker } from "./support/worker.ts";

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

/** A user who signed up and opened the verification link, as through the screens. */
async function verifiedUser(name = "Ana Souza") {
  const email = `user-${randomUUID()}@example.com`;
  await worker.post("/api/auth/sign-up/email", { name, email, password: PASSWORD, callbackURL: "/email-verified" });
  await expect.poll(() => sent.some((e) => e.to.includes(email)), { timeout: 10_000 }).toBe(true);
  const link = new URL(linkIn(sent.find((e) => e.to.includes(email))!.html, "/api/auth/verify-email"));
  await worker.fetch(`${link.pathname}${link.search}`, { redirect: "manual" });
  return { email, name };
}

function signIn(email: string, password: string, headers: Record<string, string> = {}) {
  return worker.post("/api/auth/sign-in/email", { email, password }, headers);
}

/** The `name=value` pairs of a response's cookies, as the browser sends them back. */
function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

test("a verified user signs in with email and password and GET /api/me answers them", async () => {
  const { email } = await verifiedUser("Bruno Lima");

  const response = await signIn(email, PASSWORD);

  expect(response.status).toBe(200);
  const me = await worker.fetch("/api/me", { headers: { cookie: cookieFrom(response) } });
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ name: "Bruno Lima", email });
});

test("a wrong password answers 401 INVALID_EMAIL_OR_PASSWORD and opens no session", async () => {
  const { email } = await verifiedUser();

  const response = await signIn(email, "wrong password 123");

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("an unknown email answers exactly like a wrong password", async () => {
  const response = await signIn(`nobody-${randomUUID()}@example.com`, PASSWORD);

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
});

test("after 3 sign-in attempts from one IP in 10 s, the next answers 429 TOO_MANY_REQUESTS, even with the right password", async () => {
  const { email } = await verifiedUser();
  const ip = randomIp();

  for (let attempt = 0; attempt < 3; attempt++) {
    expect((await signIn(email, "wrong password 123", { "cf-connecting-ip": ip })).status).toBe(401);
  }
  const blocked = await signIn(email, PASSWORD, { "cf-connecting-ip": ip });

  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toEqual({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Try again later." });
  expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(Number(blocked.headers.get("retry-after"))).toBeLessThanOrEqual(10);
  expect(blocked.headers.get("set-cookie")).toBeNull();
});

test("the limit is per client IP from cf-connecting-ip, and x-forwarded-for does not get around it", async () => {
  const { email } = await verifiedUser();
  const ip = randomIp();
  for (let attempt = 0; attempt < 3; attempt++) await signIn(email, "wrong password 123", { "cf-connecting-ip": ip });

  const spoofed = await signIn(email, PASSWORD, { "cf-connecting-ip": ip, "x-forwarded-for": randomIp() });
  const otherVisitor = await signIn(email, PASSWORD, { "cf-connecting-ip": randomIp() });

  expect(spoofed.status).toBe(429);
  expect(otherVisitor.status).toBe(200);
});

test("signing out ends the session: its cookie no longer answers GET /api/me", async () => {
  const { email } = await verifiedUser();
  const cookie = cookieFrom(await signIn(email, PASSWORD));

  const response = await worker.post("/api/auth/sign-out", {}, { cookie });

  expect(response.status).toBe(200);
  const me = await worker.fetch("/api/me", { headers: { cookie } });
  expect(me.status).toBe(401);
  expect(await me.json()).toMatchObject({ code: "UNAUTHENTICATED" });
});
