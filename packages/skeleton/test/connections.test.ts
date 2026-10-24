import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  authorizationRequest,
  connectMcpClient,
  discover,
  exchangeCode,
  registerClient,
  type Discovery,
} from "../src/node/mcp-agent.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// The user's MCP Connections over HTTP: each one is created the way an agent
// connects (the SDK client's flow: registration, consent, code exchange), then
// listed and revoked through `/api/connections`.

const resend = mockResend(() => {});
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;
let discovery: Discovery;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
  discovery = await discover(worker.origin);
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

const cookiesOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);

/** The user connects an agent named `appName` with `access`: answers its access token. */
async function connectAgent(cookie: string, appName: string, access: "read" | "write" = "read") {
  const request = authorizationRequest(
    discovery,
    await registerClient(discovery, appName),
    access === "write" ? "read write" : "read",
  );
  const page = await fetch(request.url, { headers: { cookie }, redirect: "manual" });
  const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1]!;
  const answer = await fetch(request.url, {
    method: "POST",
    headers: { cookie: [cookie, ...cookiesOf(page)].join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle, decision: "approve", access }),
    redirect: "manual",
  });
  return (await exchangeCode(discovery, request, answer.headers.get("location")!)).access_token;
}

type Connection = { id: string; appName: string; createdAt: string; access: "read" | "write" };
type Connections = { connections: Connection[]; nextCursor: string | null };

async function listConnections(cookie?: string, query = "") {
  return worker.fetch(`/api/connections${query}`, { headers: cookie ? { cookie } : {} });
}

function revokeConnection(id: string, cookie?: string) {
  return worker.fetch(`/api/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { origin: worker.origin, ...(cookie && { cookie }) },
  });
}

/** Calls tools/list on `/mcp` with `token`: answers the HTTP status. */
async function mcpStatus(token: string) {
  const response = await fetch(new URL("/mcp", worker.origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  await response.body?.cancel();
  return response.status;
}

test("GET /api/connections answers each agent the user connected: app, date and access", async () => {
  const before = Date.now();
  const { cookie } = await signedInUser();
  await connectAgent(cookie, "Reader Agent", "read");
  await connectAgent(cookie, "Writer Agent", "write");

  const response = await listConnections(cookie);

  expect(response.status).toBe(200);
  const body = (await response.json()) as Connections;
  expect(body.nextCursor).toBeNull();
  expect(body.connections.map(({ appName, access }) => ({ appName, access })).sort((a, b) => a.appName.localeCompare(b.appName))).toEqual([
    { appName: "Reader Agent", access: "read" },
    { appName: "Writer Agent", access: "write" },
  ]);
  for (const connection of body.connections) {
    expect(connection.id).toEqual(expect.any(String));
    expect(Date.parse(connection.createdAt)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(Date.parse(connection.createdAt)).toBeLessThanOrEqual(Date.now());
  }
});

test("GET /api/connections never answers another user's Connections, and an empty list without any", async () => {
  const ana = await signedInUser("Ana Souza");
  const bia = await signedInUser("Bia Lima");
  await connectAgent(ana.cookie, "Ana's Agent");

  const response = await listConnections(bia.cookie);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ connections: [], nextCursor: null });
});

test("GET /api/connections pages with `limit` and the cursor it answers", async () => {
  const { cookie } = await signedInUser();
  for (const name of ["Agent 1", "Agent 2", "Agent 3"]) await connectAgent(cookie, name);

  const first = (await (await listConnections(cookie, "?limit=2")).json()) as Connections;
  expect(first.connections).toHaveLength(2);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = (await (
    await listConnections(cookie, `?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)
  ).json()) as Connections;

  expect([...first.connections, ...second.connections].map((connection) => connection.appName).sort()).toEqual([
    "Agent 1",
    "Agent 2",
    "Agent 3",
  ]);
  expect(second.nextCursor).toBeNull();
  for (const limit of ["0", "101", "x"]) {
    const invalid = await listConnections(cookie, `?limit=${limit}`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
});

test("without a session, listing and revoking answer 401 UNAUTHENTICATED", async () => {
  for (const response of [await listConnections(), await revokeConnection("any")]) {
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  }
});

test("DELETE /api/connections/{id} revokes the Connection: its token gets 401 at /mcp right away", async () => {
  const { cookie } = await signedInUser();
  const token = await connectAgent(cookie, "Doomed Agent", "write");
  const kept = await connectAgent(cookie, "Kept Agent");
  expect(await mcpStatus(token)).toBe(200);
  const { connections } = (await (await listConnections(cookie)).json()) as Connections;
  const doomed = connections.find((connection) => connection.appName === "Doomed Agent")!;

  const response = await revokeConnection(doomed.id, cookie);

  expect(response.status).toBe(204);
  expect(await mcpStatus(token)).toBe(401);
  expect(await mcpStatus(kept)).toBe(200);
  const after = (await (await listConnections(cookie)).json()) as Connections;
  expect(after.connections.map((connection) => connection.appName)).toEqual(["Kept Agent"]);
  const again = await revokeConnection(doomed.id, cookie);
  expect(again.status).toBe(404);
});

test("revoking another user's Connection, or one that does not exist, answers 404 NOT_FOUND and revokes nothing", async () => {
  const ana = await signedInUser("Ana Souza");
  const bia = await signedInUser("Bia Lima");
  const token = await connectAgent(ana.cookie, "Ana's Agent");
  const { connections } = (await (await listConnections(ana.cookie)).json()) as Connections;

  for (const id of [connections[0]!.id, "missing"]) {
    const response = await revokeConnection(id, bia.cookie);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  }
  expect(await mcpStatus(token)).toBe(200);
  expect(((await (await listConnections(ana.cookie)).json()) as Connections).connections).toHaveLength(1);
});

test("an agent lists its user's Connections with a `read` token and revokes one with a `write` token", async () => {
  const { cookie } = await signedInUser();
  const reader = await connectAgent(cookie, "Reader Agent");
  const writer = await connectMcpClient(worker.origin, await connectAgent(cookie, "Writer Agent", "write"));
  const readerClient = await connectMcpClient(worker.origin, reader);
  try {
    const listed = await readerClient.callTool({ name: "listConnections", arguments: {} });
    expect(listed.isError).toBeFalsy();
    const { connections } = listed.structuredContent as Connections;
    expect(connections.map((connection) => connection.appName).sort()).toEqual(["Reader Agent", "Writer Agent"]);

    const revoked = await writer.callTool({
      name: "revokeConnection",
      arguments: { id: connections.find((connection) => connection.appName === "Reader Agent")!.id },
    });
    expect(revoked.isError).toBeFalsy();
    expect(await mcpStatus(reader)).toBe(401);
  } finally {
    await readerClient.close().catch(() => {});
    await writer.close();
  }
});
