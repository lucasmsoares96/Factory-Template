// The smoke of the deployed Product: `node .factory/src/ci/smoke.ts <url>`, with ACCOUNT_EMAIL and ACCOUNT_PASSWORD in the env.
//   GET /api/health -> 200 {"status":"ok"} (the Worker is up and reaches Neon, so a broken deploy shows here)
//   POST /api/auth/sign-in/email as the Product account -> 200 and a session cookie, then GET /api/me with it -> that
//     account's email. A real sign-in runs the password hash in the PasswordHasher Durable Object, so an
//     `exceededCpu` there turns the deploy red.
//   POST /mcp, no token -> 401 with a WWW-Authenticate challenge that names resource_metadata
// The account is made by `pnpm bootstrap product <id>` straight in the production database (production sends real
// email, so a sign-up could never be verified here). The password reaches this process only through the environment
// and is never printed; no response body is echoed either.

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

  const mcp = await fetchFn(new URL("/mcp", origin), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (mcp.status !== 401) problems.push(`/mcp answered ${mcp.status} without a token (want 401)`);
  else if (!/resource_metadata="[^"]+"/.test(mcp.headers.get("www-authenticate") ?? "")) problems.push("/mcp 401 has no WWW-Authenticate with resource_metadata");
  return { ok: problems.length === 0, problems };
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

/** Retries while the new version propagates; the last result stands. A 429 from the rate limit clears in 10 s, inside the wait. */
export async function smokeWithRetry(origin: string, options: SmokeOptions & { attempts: number; waitMs: number; sleep?: (ms: number) => Promise<void> }): Promise<SmokeResult> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: SmokeResult = { ok: false, problems: ["not run"] };
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      last = await smoke(origin, options);
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
  if (!origin) throw new Error("Usage: smoke.ts <url>");
  const { ACCOUNT_EMAIL: email, ACCOUNT_PASSWORD: password } = process.env;
  const account = email && password ? { email, password } : undefined;
  const result = await smokeWithRetry(origin, { account, attempts: 12, waitMs: 5000 });
  if (!result.ok) {
    console.error(`smoke failed for ${origin}:\n${result.problems.join("\n")}`);
    process.exitCode = 1;
  } else console.log(`smoke ok for ${origin}`);
}
