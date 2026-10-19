import { createTestHarness } from "wrangler";
import { builtWorkerConfig } from "@workspace/skeleton/node";
import { afterAll, beforeAll, expect, test } from "vitest";

const server = createTestHarness({
  workers: [
    {
      configPath: builtWorkerConfig(import.meta.dirname + "/.."),
      secrets: { DATABASE_URL: process.env.DATABASE_URL ?? "", BETTER_AUTH_SECRET: "e2e-secret-at-least-32-characters-long" },
    },
  ],
});
beforeAll(() => server.listen());

/** A request the way a browser sends it when the user opens a URL. */
const navigate = (path: string) =>
  server.fetch(path, { headers: { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
afterAll(() => server.close());

test("serves the SPA at the root", async () => {
  const response = await navigate("/");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(await response.text()).toContain(`<div id="root"></div>`);
});

test("serves the SPA for any client-side route", async () => {
  const response = await navigate("/some/client/route");

  expect(response.status).toBe(200);
  expect(await response.text()).toContain(`<div id="root"></div>`);
});

test("answers /api/health from the Worker", async () => {
  const response = await server.fetch("/api/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("never falls back to the SPA under /api/, even for a browser navigation", async () => {
  const response = await navigate("/api/does-not-exist");

  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(`<div id="root">`);
});

test("answers /mcp from the Worker: 401 with the challenge that leads an MCP client to sign-in", async () => {
  const response = await server.fetch("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

  expect(response.status).toBe(401);
  const challenge = response.headers.get("www-authenticate") ?? "";
  expect(challenge).toMatch(/^Bearer .*resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
  const metadata = await server.fetch(new URL(/resource_metadata="([^"]+)"/.exec(challenge)![1]!).pathname);
  expect(await metadata.json()).toMatchObject({ resource: expect.stringMatching(/\/mcp$/) });
  const authorize = await navigate("/oauth/authorize");
  expect(await authorize.text()).not.toContain(`<div id="root">`);
});
