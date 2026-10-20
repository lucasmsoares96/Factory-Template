import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, expect, test } from "vitest";

// None of these routes touch the database, so the URL never has to answer.
const server = createTestHarness({
  workers: [
    {
      configPath: new URL("./worker/wrangler.jsonc", import.meta.url).pathname,
      secrets: { DATABASE_URL: "postgres://unused@127.0.0.1:1/unused" },
    },
  ],
});
beforeAll(() => server.listen());
afterAll(() => server.close());

test("GET /api/openapi.json serves the OpenAPI 3.1 document of every /api route", async () => {
  const response = await server.fetch("/api/openapi.json");

  expect(response.status).toBe(200);
  const document = (await response.json()) as { openapi: string; paths: Record<string, Record<string, unknown>> };
  expect(document.openapi).toBe("3.1.0");
  expect(document.paths["/api/health"]?.get).toMatchObject({
    operationId: "getHealth",
    summary: expect.any(String),
    description: expect.any(String),
  });
});

test("GET /api/docs serves Swagger UI over the document", async () => {
  const response = await server.fetch("/api/docs");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain("swagger-ui");
  expect(html).toContain("/api/openapi.json");
});

test("an unknown /api route answers 404 with a stable code and an English message", async () => {
  const response = await server.fetch("/api/does-not-exist");

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
});
