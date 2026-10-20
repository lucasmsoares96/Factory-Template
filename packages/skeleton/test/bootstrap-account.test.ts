import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend } from "../src/node/resend-mock.ts";
import { passwordProblem, upsertVerifiedUser, userExists } from "../src/node/accounts.ts";
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
