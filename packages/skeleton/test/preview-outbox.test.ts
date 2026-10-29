import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// The route a reviewer (and the preview smoke) reads emails from. It exists only in a preview: the outbox transport
// AND the preview-only flag. Production sends through Resend, and `pnpm dev` and the tests use the outbox without the flag.
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
const workers: Record<"production" | "outboxOnly" | "preview" | "flagOnly", TestWorker> = {} as never;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  workers.production = await startTestWorker({ databaseUrl: db.url });
  workers.outboxOnly = await startTestWorker({ databaseUrl: db.url, vars: { EMAIL_TRANSPORT: "outbox" } });
  workers.flagOnly = await startTestWorker({ databaseUrl: db.url, vars: { PREVIEW_OUTBOX: "true" } });
  workers.preview = await startTestWorker({ databaseUrl: db.url, vars: { EMAIL_TRANSPORT: "outbox", PREVIEW_OUTBOX: "true" } });
});
afterAll(async () => {
  await Promise.all(Object.values(workers).map((w) => w?.close()));
  await db?.drop();
});

async function outbox(worker: TestWorker, to: string) {
  return worker.fetch(`/api/preview/outbox?to=${encodeURIComponent(to)}`);
}

describe("GET /api/preview/outbox", () => {
  test("is absent in the production configuration (Resend transport), flag or not", async () => {
    for (const worker of [workers.production, workers.flagOnly]) {
      const response = await outbox(worker, "someone@example.com");
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
    }
  });

  test("is absent with the outbox transport alone (pnpm dev, the tests)", async () => {
    expect((await outbox(workers.outboxOnly, "someone@example.com")).status).toBe(404);
  });

  test("in a preview it answers the emails stored for one address, newest first", async () => {
    const email = `visitor-${randomUUID()}@example.com`;
    await workers.preview.post("/api/auth/sign-up/email", { name: "Bia Lima", email, password: "correct horse battery", callbackURL: "/email-verified" });

    let body: { emails: { to: string; subject: string; html: string; text: string }[] } = { emails: [] };
    await expect
      .poll(async () => {
        const response = await outbox(workers.preview, email);
        expect(response.status).toBe(200);
        body = (await response.json()) as typeof body;
        return body.emails.length;
      })
      .toBe(1);
    expect(body.emails[0]).toMatchObject({ to: email });
    expect(body.emails[0]!.html).toContain("/api/auth/verify-email");
  });

  test("in a preview it answers HTML to a browser, with clickable links and emails that cannot run script", async () => {
    const email = `visitor-${randomUUID()}@example.com`;
    await workers.preview.post("/api/auth/sign-up/email", { name: "Bia Lima", email, password: "correct horse battery", callbackURL: "/email-verified" });
    const url = `/api/preview/outbox?to=${encodeURIComponent(email)}`;
    let page = "";
    await expect
      .poll(async () => {
        const response = await workers.preview.fetch(url, { headers: { accept: "text/html" } });
        expect(response.headers.get("content-type")).toContain("text/html");
        page = await response.text();
        return page.includes("/api/auth/verify-email");
      })
      .toBe(true);
    expect(page).toContain(email);
    expect(page).toMatch(/<a href="[^"]*\/api\/auth\/verify-email[^"]*"/);
    const href = page.match(/<a href="([^"]*\/api\/auth\/verify-email[^"]*)"/)![1]!;
    expect(href).toContain("&callbackURL=");
    expect(href).not.toContain("&amp;");
    const frame = await workers.preview.fetch(`/api/preview/outbox/email?to=${encodeURIComponent(email)}&index=0`);
    expect(frame.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(page).toMatch(/<iframe sandbox="[^"]*"/);
    expect((await workers.production.fetch(url, { headers: { accept: "text/html" } })).status).toBe(404);
    expect((await workers.production.fetch(`/api/preview/outbox/email?to=${encodeURIComponent(email)}&index=0`)).status).toBe(404);
  });

  test("needs an address: it never lists the whole outbox", async () => {
    const response = await workers.preview.fetch("/api/preview/outbox");
    expect(response.status).toBe(400);
  });

  test("is not part of the OpenAPI document nor of the MCP tools", async () => {
    const doc = (await (await workers.preview.fetch("/api/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths).some((p) => p.includes("preview"))).toBe(false);
  });
});
