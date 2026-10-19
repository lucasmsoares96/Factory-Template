import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { createEmptyDatabase } from "./support/database.ts";

const configPath = new URL("./worker/wrangler.jsonc", import.meta.url).pathname;
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
});
afterAll(() => db.drop());

function harness(databaseUrl: string) {
  return createTestHarness({ workers: [{ configPath, secrets: { DATABASE_URL: databaseUrl } }] });
}

test("GET /api/health answers ok when the database answers", async () => {
  const server = harness(db.url);
  try {
    await server.listen();

    const response = await server.fetch("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  } finally {
    await server.close();
  }
});

test("GET /api/health answers 503 with a stable code when the database is unreachable", async () => {
  const unreachable = new URL(db.url);
  unreachable.port = "1";
  const server = harness(unreachable.toString());
  try {
    await server.listen();

    const response = await server.fetch("/api/health");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "DATABASE_UNAVAILABLE", message: "The database is unavailable." });
  } finally {
    await server.close();
  }
});
