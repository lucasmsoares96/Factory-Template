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

function updateMe(body: unknown, cookie?: string) {
  return worker.fetch("/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });
}

test("PATCH /api/me renames the signed-in user, trimmed, and answers what GET /api/me answers", async () => {
  const { user, cookie } = await signedInUser();

  const response = await updateMe({ name: "  Ana Lima  " }, cookie);

  expect(response.status).toBe(200);
  const renamed = { id: user.id, name: "Ana Lima", email: user.email };
  expect(await response.json()).toEqual(renamed);
  expect(await (await worker.fetch("/api/me", { headers: { cookie } })).json()).toEqual(renamed);
});

test("PATCH /api/me answers 400 VALIDATION_FAILED for a missing, blank or too long name, and keeps the old one", async () => {
  const { user, cookie } = await signedInUser();

  for (const body of [{}, { name: "" }, { name: "   " }, { name: "a".repeat(101) }, { name: 42 }]) {
    const response = await updateMe(body, cookie);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
  expect(await (await updateMe({ name: "a".repeat(100) }, cookie)).json()).toMatchObject({ name: "a".repeat(100) });
  expect(await (await updateMe({ name: "a".repeat(101) }, cookie)).json()).toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await (await worker.fetch("/api/me", { headers: { cookie } })).json()).toMatchObject({
    id: user.id,
    name: "a".repeat(100),
  });
});

test("PATCH /api/me answers 400 VALIDATION_FAILED for a malformed or empty JSON body", async () => {
  const { cookie } = await signedInUser();

  for (const body of ["{", ""]) {
    const response = await worker.fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
});

test("PATCH /api/me answers 401 UNAUTHENTICATED without a session", async () => {
  const response = await updateMe({ name: "Ana Lima" });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
});

test("PATCH /api/me is described in the OpenAPI document with its errors", async () => {
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  const operation = document.paths["/api/me"]?.patch;

  expect(operation).toMatchObject({
    operationId: "updateMe",
    summary: expect.any(String),
    description: expect.any(String),
  });
  expect(Object.keys(operation!.responses as object).sort()).toEqual(["200", "400", "401"]);
});

test("GET /api/nav answers the account page's entry, translated, then each Product feature's nav entry", async () => {
  const { cookie } = await signedInUser();

  const response = await worker.fetch("/api/nav", { headers: { cookie } });

  expect(response.status).toBe(200);
  // The test composition's `notes` feature declares `nav: { label: "Notes", to: "/notes" }`.
  expect(await response.json()).toEqual({
    entries: [
      { label: "Account", to: "/account" },
      { label: "Notes", to: "/notes" },
    ],
  });
});

test("GET /api/nav answers 401 UNAUTHENTICATED without a session, and is not an MCP tool", async () => {
  const response = await worker.fetch("/api/nav");

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  expect(document.paths["/api/nav"]?.get).toMatchObject({ operationId: "getNav", "x-mcp": false });
});
