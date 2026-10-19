import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { format, type Locale, type Messages } from "../../i18n/index.ts";
import type { IdentityUser } from "../identity.ts";

/** Everything the client chose (its name, URIs, scopes) is escaped before it reaches the page. */
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const styles = `
  :root { color-scheme: light dark; --fg: #171717; --muted: #737373; --border: #e5e5e5; --bg: #fff; --card: #fff; --primary: #171717; --on-primary: #fafafa; --warn: #b45309; }
  @media (prefers-color-scheme: dark) { :root { --fg: #fafafa; --muted: #a3a3a3; --border: #262626; --bg: #0a0a0a; --card: #171717; --primary: #fafafa; --on-primary: #171717; --warn: #f59e0b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
  main { width: 100%; max-width: 26rem; border: 1px solid var(--border); border-radius: 0.75rem; background: var(--card); padding: 1.5rem; display: grid; gap: 1rem; }
  h1 { margin: 0; font-size: 1.125rem; font-weight: 600; }
  p { margin: 0; color: var(--muted); }
  .warn { color: var(--warn); }
  form { display: grid; gap: 1rem; }
  fieldset { margin: 0; border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem; display: grid; gap: 0.5rem; }
  legend { padding: 0 0.25rem; font-weight: 500; }
  label { display: flex; gap: 0.5rem; align-items: center; }
  .actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  button { font: inherit; border-radius: 0.5rem; padding: 0.5rem 1rem; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
  button[value="approve"] { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
`;

function page(locale: Locale, title: string, body: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>${styles}</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

/**
 * The page `/oauth/authorize` shows a signed-in user: which app asks (its
 * verified domain, or a warning that its name is self-asserted), where the access
 * goes, and the choice between `read` and `write`. It posts the consent `handle`
 * back; the request itself stays on the server.
 */
export function consentPage({
  locale,
  t,
  details,
  handle,
  user,
}: {
  locale: Locale;
  t: Messages;
  details: ConsentDescription;
  handle: string;
  user: IdentityUser;
}): string {
  const m = t.connect;
  const client = escape(details.clientName);
  const fill = (text: string, values: Record<string, string>) => format(escape(text), values);
  const title = fill(m.title, { client, appName: escape(t.app.title) });
  const origin = details.clientDomain
    ? fill(m.verifiedClient, { client, domain: `<strong>${escape(details.clientDomain)}</strong>` })
    : fill(m.unverifiedClient, { client });
  const access = details.scope.includes("write") ? "write" : "read";
  const option = (value: "read" | "write") =>
    `<label><input type="radio" name="access" value="${value}"${value === access ? " checked" : ""}> ${escape(m[value])}</label>`;
  return page(
    locale,
    title.replace(/<[^>]+>/g, ""),
    `<h1>${title}</h1>
<p>${origin}</p>
<p>${fill(m.redirect, { host: `<strong>${escape(details.redirectHost)}</strong>` })}</p>
${details.redirectIsLoopback ? `<p class="warn" role="note">${escape(m.loopback)}</p>` : ""}
<p>${fill(m.signedInAs, { name: escape(user.name), email: escape(user.email) })}</p>
<form method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
<fieldset><legend>${escape(m.access)}</legend>${option("read")}${option("write")}</fieldset>
<div class="actions"><button type="submit" name="decision" value="deny">${escape(m.deny)}</button><button type="submit" name="decision" value="approve">${escape(m.allow)}</button></div>
</form>`,
  );
}

/** A request the page cannot go on with: shown here, never sent back to an unverified client. */
export function consentErrorPage({ locale, t, message }: { locale: Locale; t: Messages; message: string }): string {
  return page(locale, t.connect.failedTitle, `<h1>${escape(t.connect.failedTitle)}</h1>\n<p role="alert">${escape(message)}</p>`);
}
