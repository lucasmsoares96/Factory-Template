// The smoke of the deployed Product: `node .factory/src/ci/smoke.ts <url>`. No secret, no browser.
//   GET /api/health -> 200 {"status":"ok"} (the Worker is up and reaches Neon, so a broken deploy shows here)
//   POST /mcp, no token -> 401 with a WWW-Authenticate challenge that names resource_metadata
// A real sign-in is not possible here: production sends real email (no outbox to read the verification from) and the
// smoke job holds no secret, so there is no smoke account to sign in with. The gap is recorded in ticket 14.

export interface SmokeResult {
  ok: boolean;
  problems: string[];
}

export async function smoke(origin: string, fetchFn: typeof fetch = fetch): Promise<SmokeResult> {
  const problems: string[] = [];
  const health = await fetchFn(new URL("/api/health", origin));
  const body = (await health.json().catch(() => null)) as { status?: string } | null;
  if (health.status !== 200 || body?.status !== "ok") problems.push(`/api/health answered ${health.status}`);

  const mcp = await fetchFn(new URL("/mcp", origin), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (mcp.status !== 401) problems.push(`/mcp answered ${mcp.status} without a token (want 401)`);
  else if (!/resource_metadata="[^"]+"/.test(mcp.headers.get("www-authenticate") ?? "")) problems.push("/mcp 401 has no WWW-Authenticate with resource_metadata");
  return { ok: problems.length === 0, problems };
}

/** Retries while the new version propagates; the last result stands. */
export async function smokeWithRetry(origin: string, options: { attempts: number; waitMs: number; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<SmokeResult> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: SmokeResult = { ok: false, problems: ["not run"] };
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      last = await smoke(origin, options.fetchFn);
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
  const result = await smokeWithRetry(origin, { attempts: 12, waitMs: 5000 });
  if (!result.ok) {
    console.error(`smoke failed for ${origin}:\n${result.problems.join("\n")}`);
    process.exitCode = 1;
  } else console.log(`smoke ok for ${origin}`);
}
