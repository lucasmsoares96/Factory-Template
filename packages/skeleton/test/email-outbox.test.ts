import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { messagesFor } from "../src/i18n/index.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { linkIn } from "../src/node/email-link.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { TEST_EMAIL_FROM, startTestWorker, type TestWorker } from "./support/worker.ts";

// Previews and `pnpm dev` set EMAIL_TRANSPORT=outbox: emails land in a table, never in Resend.
const TEST_TIMEOUT = 60_000;
const t = messagesFor("en");
const sent: SentEmail[] = [];
const resend = mockResend((email) => sent.push(email));
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url, vars: { EMAIL_TRANSPORT: "outbox" } });
});
afterAll(async () => {
  await worker?.close();
  resend.close();
  await db?.drop();
});

type OutboxRow = { to: string; from: string; subject: string; html: string; text: string };

/**
 * Better Auth sends the email after the response, in the Worker's background tasks (`waitUntil`), so the test
 * cannot await it and polls the row. The bound is the test's own timeout, not a guess at how fast the machine
 * is: a poll that gives up first fails on a slow machine while the email is still on its way.
 */
function outboxFor(to: string) {
  return vi.waitFor(
    async () => {
      const rows = await db.query<OutboxRow>(`select "to", "from", subject, html, text from skeleton.email_outbox where "to" = '${to}'`);
      expect(rows).toHaveLength(1);
      return rows;
    },
    { interval: 100, timeout: TEST_TIMEOUT - 5_000 },
  );
}

test("with the outbox transport, the verification email is stored instead of sent, and its link works", { timeout: TEST_TIMEOUT }, async () => {
  const email = `visitor-${randomUUID()}@example.com`;

  await worker.post("/api/auth/sign-up/email", {
    name: "Bia Lima",
    email,
    password: "correct horse battery",
    callbackURL: "/email-verified",
  });

  const [row] = await outboxFor(email);
  expect(row).toMatchObject({ to: email, from: TEST_EMAIL_FROM, subject: t.emails.verifyEmail.subject });
  expect(row!.text).toContain(t.emails.verifyEmail.button);
  expect(sent).toEqual([]);

  const link = new URL(linkIn(row!.html, "/api/auth/verify-email"));
  const response = await worker.fetch(`${link.pathname}${link.search}`, { redirect: "manual" });
  expect(response.headers.get("location")).toBe("/email-verified");
});
