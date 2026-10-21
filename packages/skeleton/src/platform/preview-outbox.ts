import { desc, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { emailOutbox } from "../db/schema.ts";
import { apiError, createRouter } from "./errors.ts";
import type { SkeletonEnv } from "./env.ts";

/**
 * The outbox route exists only in a preview: the outbox transport AND `PREVIEW_OUTBOX=true`, which only the preview
 * config of the deploy sets. Production sends through Resend and has neither; `pnpm dev` and the tests use the outbox
 * but not the flag. Anywhere else it answers like any unknown route.
 */
export function isPreview(env: { EMAIL_TRANSPORT?: string; PREVIEW_OUTBOX?: string }): boolean {
  return env.EMAIL_TRANSPORT === "outbox" && env.PREVIEW_OUTBOX === "true";
}

const onlyInPreview = createMiddleware<SkeletonEnv>(async (c, next) => {
  if (!isPreview(c.env)) return c.json(apiError("NOT_FOUND"), 404);
  await next();
});

const LIMIT = 20;

/**
 * `GET /api/preview/outbox?to=<email>`: the emails stored for one address, newest first (the reviewer's inbox, and
 * the smoke's way to verify a sign-up). Plain routes, so they stay out of the OpenAPI document and the MCP tools.
 */
export const previewOutbox = createRouter();
previewOutbox.use("/preview/*", onlyInPreview);
previewOutbox.get("/preview/outbox", async (c) => {
  const to = c.req.query("to");
  if (!to) return c.json(apiError("VALIDATION_FAILED"), 400);
  const emails = await c.var.db
    .select({ to: emailOutbox.to, from: emailOutbox.from, subject: emailOutbox.subject, html: emailOutbox.html, text: emailOutbox.text, createdAt: emailOutbox.createdAt })
    .from(emailOutbox)
    .where(eq(emailOutbox.to, to))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(LIMIT);
  return c.json({ emails });
});
