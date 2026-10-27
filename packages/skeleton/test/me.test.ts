import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

const resend = mockResend(() => {});
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

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(
    testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }),
  );
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, cookie: headers.get("cookie")! };
}

test("GET /api/me answers the signed-in user from the session cookie", async () => {
  const { user, cookie } = await signedInUser();

  const response = await worker.fetch("/api/me", { headers: { cookie } });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: user.id, name: "Ana Souza", email: user.email, pendingEmail: null });
});

test("GET /api/me answers 401 UNAUTHENTICATED without a session", async () => {
  const response = await worker.fetch("/api/me");

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
});

test("GET /api/me answers 401 UNAUTHENTICATED for a forged or revoked session cookie", async () => {
  const { cookie } = await signedInUser();
  const forged = cookie.replace(/=([^;.]+)/, "=forged");
  await db.query(`delete from skeleton.sessions`);

  for (const value of [forged, cookie]) {
    const response = await worker.fetch("/api/me", { headers: { cookie: value } });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  }
});

test("GET /api/me is described in the OpenAPI document with its errors", async () => {
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  const operation = document.paths["/api/me"]?.get;

  expect(operation).toMatchObject({
    operationId: "getMe",
    summary: expect.any(String),
    description: expect.any(String),
  });
  expect(Object.keys(operation!.responses as object).sort()).toEqual(["200", "401"]);
});
