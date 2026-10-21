// The smoke of the deployed Product: `node .factory/src/ci/smoke.ts <url>`, with ACCOUNT_EMAIL and ACCOUNT_PASSWORD in the env.
//   GET /api/health -> 200 {"status":"ok"} (the Worker is up and reaches Neon, so a broken deploy shows here)
//   POST /api/auth/sign-in/email as the Product account -> 200 and a session cookie, then GET /api/me with it -> that
//     account's email. A real sign-in runs the password hash in the PasswordHasher Durable Object, so an
//     `exceededCpu` there turns the deploy red.
//   POST /mcp, no token -> 401 with a WWW-Authenticate challenge that names resource_metadata
// `smoke.ts <url> --preview` is the smoke of a PR preview (no account, no secret): it signs up for real, reads the
// verification email in the preview's outbox route (`GET /api/preview/outbox?to=`, which exists only there), follows
// the link, signs in and reads `/api/me`; the health and `/mcp` checks are the same.
// The account is made by `pnpm bootstrap product <id>` straight in the production database (production sends real
// email, so a sign-up could never be verified here). The password reaches this process only through the environment
// and is never printed; no response body is echoed either.

import { randomUUID } from "node:crypto";

export interface SmokeAccount {
  email: string;
  password: string;
}

export interface SmokeResult {
  ok: boolean;
  problems: string[];
}

export interface SmokeOptions {
  /** Missing means the Product was never bootstrapped: that fails, saying what to run. */
  account: SmokeAccount | undefined;
  fetchFn?: typeof fetch;
}

export async function smoke(origin: string, { account, fetchFn = fetch }: SmokeOptions): Promise<SmokeResult> {
  const problems: string[] = [];
  const health = await fetchFn(new URL("/api/health", origin));
  const body = (await health.json().catch(() => null)) as { status?: string } | null;
  if (health.status !== 200 || body?.status !== "ok") problems.push(`/api/health answered ${health.status}`);

  if (!account) problems.push("no account: ACCOUNT_EMAIL and ACCOUNT_PASSWORD are empty; run `pnpm bootstrap product <id>`");
  else problems.push(...(await signedIn(origin, account, fetchFn)));

  problems.push(...(await mcpChallenge(origin, fetchFn)));
  return { ok: problems.length === 0, problems };
}

/** `POST /mcp` with no token: 401 and a `WWW-Authenticate` challenge that names `resource_metadata`. */
async function mcpChallenge(origin: string, fetchFn: typeof fetch): Promise<string[]> {
  const mcp = await fetchFn(new URL("/mcp", origin), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (mcp.status !== 401) return [`/mcp answered ${mcp.status} without a token (want 401)`];
  if (!/resource_metadata="[^"]+"/.test(mcp.headers.get("www-authenticate") ?? "")) return ["/mcp 401 has no WWW-Authenticate with resource_metadata"];
  return [];
}

/** Signs in as the Product account and reads `/api/me` with the session cookie. Returns the problems found. */
async function signedIn(origin: string, account: SmokeAccount, fetchFn: typeof fetch): Promise<string[]> {
  const signIn = await fetchFn(new URL("/api/auth/sign-in/email", origin), {
    method: "POST",
    // Better Auth checks the Origin of a POST; the SPA sends its own.
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (signIn.status !== 200) return [`sign-in answered ${signIn.status}`];
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) return ["sign-in answered no session cookie"];
  const me = await fetchFn(new URL("/api/me", origin), { headers: { cookie } });
  if (me.status !== 200) return [`/api/me answered ${me.status}`];
  const user = (await me.json().catch(() => null)) as { email?: string } | null;
  return user?.email?.toLowerCase() === account.email.toLowerCase() ? [] : ["/api/me answered another user than the account"];
}

export interface PreviewSmokeOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Polls of the outbox for the verification email, and the wait between them. */
  polls?: number;
  waitMs?: number;
  /** A fresh visitor each run: the preview database is shared by every run of the PR. */
  random?: () => string;
}

/** Health, a real sign-up verified through the preview's outbox, a real sign-in, `/api/me`, and the `/mcp` challenge. */
export async function previewSmoke(origin: string, options: PreviewSmokeOptions = {}): Promise<SmokeResult> {
  const { fetchFn = fetch, polls = 12, waitMs = 2000, random = () => randomUUID() } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const problems: string[] = [];
  const health = await fetchFn(new URL("/api/health", origin));
  const body = (await health.json().catch(() => null)) as { status?: string } | null;
  if (health.status !== 200 || body?.status !== "ok") problems.push(`/api/health answered ${health.status}`);

  const email = `smoke-${random()}@example.com`;
  const password = `Smoke-${random()}`;
  const signUp = await fetchFn(new URL("/api/auth/sign-up/email", origin), {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ name: "Preview Smoke", email, password, callbackURL: "/email-verified" }),
  });
  if (signUp.status !== 200) problems.push(`sign-up answered ${signUp.status}`);
  else {
    const link = await verificationLink(origin, email, { fetchFn, sleep, polls, waitMs });
    if ("problem" in link) problems.push(link.problem);
    else {
      const verified = await fetchFn(link, { redirect: "manual" });
      if (verified.status >= 400) problems.push(`the verification link answered ${verified.status}`);
      else problems.push(...(await signedIn(origin, { email, password }, fetchFn)));
    }
  }
  problems.push(...(await mcpChallenge(origin, fetchFn)));
  return { ok: problems.length === 0, problems };
}

/** The verification link in the outbox of the preview, as a URL on `origin` (the email's own host is not trusted). */
async function verificationLink(origin: string, email: string, o: { fetchFn: typeof fetch; sleep: (ms: number) => Promise<void>; polls: number; waitMs: number }): Promise<URL | { problem: string }> {
  for (let poll = 1; poll <= o.polls; poll++) {
    const response = await o.fetchFn(new URL(`/api/preview/outbox?to=${encodeURIComponent(email)}`, origin));
    if (response.status === 404) return { problem: "/api/preview/outbox answered 404: the preview does not run with the outbox route (EMAIL_TRANSPORT=outbox and PREVIEW_OUTBOX=true)" };
    if (response.status !== 200) return { problem: `/api/preview/outbox answered ${response.status}` };
    const { emails } = (await response.json().catch(() => ({ emails: [] }))) as { emails?: { html?: string }[] };
    for (const mail of emails ?? []) {
      for (const [, href] of (mail.html ?? "").matchAll(/href="([^"]+)"/g)) {
        const url = new URL(href!.replaceAll("&amp;", "&"), origin);
        if (url.pathname.endsWith("/api/auth/verify-email")) return new URL(`${url.pathname}${url.search}`, origin);
      }
    }
    if (poll < o.polls) await o.sleep(o.waitMs);
  }
  return { problem: "no verification email reached the outbox" };
}

/** Retries while the new version propagates; the last result stands. A 429 from the rate limit clears in 10 s, inside the wait. */
export async function smokeWithRetry(origin: string, options: SmokeOptions & { attempts: number; waitMs: number; sleep?: (ms: number) => Promise<void>; run?: (origin: string) => Promise<SmokeResult> }): Promise<SmokeResult> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: SmokeResult = { ok: false, problems: ["not run"] };
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      last = await (options.run ?? ((o) => smoke(o, options)))(origin);
    } catch (error) {
      last = { ok: false, problems: [(error as Error).message] };
    }
    if (last.ok) return last;
    if (attempt < options.attempts) await sleep(options.waitMs);
  }
  return last;
}

if (import.meta.main) {
  const origin = process.argv[2];
  if (!origin) throw new Error("Usage: smoke.ts <url> [--preview]");
  const { ACCOUNT_EMAIL: email, ACCOUNT_PASSWORD: password } = process.env;
  const account = email && password ? { email, password } : undefined;
  const preview = process.argv.includes("--preview");
  const result = await smokeWithRetry(origin, { account, attempts: preview ? 6 : 12, waitMs: 5000, ...(preview ? { run: (o: string) => previewSmoke(o) } : {}) });
  if (!result.ok) {
    console.error(`smoke failed for ${origin}:\n${result.problems.join("\n")}`);
    process.exitCode = 1;
  } else console.log(`smoke ok for ${origin}`);
}
