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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wantsHtml(accept: string | undefined): boolean {
  return (accept ?? "").toLowerCase().includes("text/html");
}

/** The http(s) links of an email's HTML, entity-decoded (`&amp;` in an href is `&` in the URL). */
function linksOf(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const url = (match[1] ?? match[2] ?? "").replace(/&amp;/gi, "&").replace(/&#38;|&#x26;/gi, "&");
    if (/^https?:\/\//i.test(url)) links.add(url);
  }
  return [...links];
}

function listPage(to: string, emails: { subject: string; html: string; createdAt: Date }[]): string {
  const items = emails
    .map((email, index) => {
      const links = linksOf(email.html)
        .map((url) => `<li><a href="${url.replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E")}">${escapeHtml(url)}</a></li>`)
        .join("");
      const src = `/api/preview/outbox/email?to=${encodeURIComponent(to)}&index=${index}`;
      return `<article data-testid="outbox-email"><h2>${escapeHtml(email.subject)}</h2>
<p>To: ${escapeHtml(to)} · ${escapeHtml(new Date(email.createdAt).toISOString())}</p>
<ul data-testid="outbox-links">${links}</ul>
<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" src="${escapeHtml(src)}" title="${escapeHtml(email.subject)}" style="width:100%;height:24rem;border:1px solid #ccc"></iframe></article>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Outbox: ${escapeHtml(to)}</title></head><body style="font-family:sans-serif;max-width:50rem;margin:2rem auto"><h1>Outbox: ${escapeHtml(to)}</h1>
${items || "<p>No emails.</p>"}</body></html>`;
}

/**
 * `GET /api/preview/outbox?to=<email>`: the emails stored for one address, newest first (the reviewer's inbox, and
 * the smoke's way to verify a sign-up). JSON by default; a request that accepts `text/html` gets a page that lists them.
 * Each email is shown in a sandboxed frame served with a sandbox CSP, so its HTML never runs script in the outbox page.
 * Plain routes, so they stay out of the OpenAPI document and the MCP tools.
 */
export const previewOutbox = createRouter();
previewOutbox.use("/preview/*", onlyInPreview);

async function emailsOf(c: { var: { db: any } }, to: string) {
  return (await c.var.db
    .select({ to: emailOutbox.to, from: emailOutbox.from, subject: emailOutbox.subject, html: emailOutbox.html, text: emailOutbox.text, createdAt: emailOutbox.createdAt })
    .from(emailOutbox)
    .where(eq(emailOutbox.to, to))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(LIMIT)) as { to: string; from: string; subject: string; html: string; text: string; createdAt: Date }[];
}

previewOutbox.get("/preview/outbox", async (c) => {
  const to = c.req.query("to");
  if (!to) return c.json(apiError("VALIDATION_FAILED"), 400);
  const emails = await emailsOf(c, to);
  if (wantsHtml(c.req.header("accept"))) {
    return c.html(listPage(to, emails), 200, { "Content-Security-Policy": "script-src 'none'; object-src 'none'; base-uri 'none'" });
  }
  return c.json({ emails });
});

previewOutbox.get("/preview/outbox/email", async (c) => {
  const to = c.req.query("to");
  const index = Number(c.req.query("index"));
  if (!to || !Number.isInteger(index) || index < 0) return c.json(apiError("VALIDATION_FAILED"), 400);
  const email = (await emailsOf(c, to))[index];
  if (!email) return c.json(apiError("NOT_FOUND"), 404);
  return c.html(`<base target="_blank">${email.html}`, 200, {
    "Content-Security-Policy": "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'",
  });
});
