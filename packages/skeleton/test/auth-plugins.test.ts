import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import type { McpTool } from "../src/platform/mcp/tool.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// A feature adds Better Auth plugins: the test composition's `greeting` feature
// brings one whose route answers under Better Auth's path, and stays out of the
// OpenAPI document and the MCP tools like Better Auth's own routes.

let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
});
afterAll(async () => {
  await worker?.close();
  await db?.drop();
});

test("a feature's Better Auth plugin answers its route under /api/auth", async () => {
  const response = await worker.fetch("/api/auth/greeting/hello");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ greeting: "hello" });
});

test("the plugin's route is neither in the OpenAPI document nor an MCP tool", async () => {
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as { paths: Record<string, unknown> };
  const tools = JSON.parse(readFileSync(new URL("./worker/mcp-tools.gen.json", import.meta.url), "utf8")) as McpTool[];

  expect(Object.keys(document.paths).filter((path) => path.startsWith("/api/auth"))).toEqual([]);
  expect(tools.filter((tool) => tool.http.path.startsWith("/api/auth"))).toEqual([]);
});
