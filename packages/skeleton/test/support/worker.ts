import { createTestHarness } from "wrangler";

/** The secret the test Worker and the test-only Better Auth instance share. */
export const TEST_SECRET = "skeleton-test-secret-at-least-32-characters";

/** The sender the test composition passes to `createApp()` (test/worker/index.ts). */
export const TEST_EMAIL_FROM = "Skeleton Test <no-reply@skeleton.test>";

const configPath = new URL("../worker/wrangler.jsonc", import.meta.url).pathname;

/** The Skeleton's test-only composition, for `createTestHarness({ workers: [...] })`. */
export function testWorker(secrets: Record<string, string>, vars: Record<string, string> = {}) {
  return { configPath, secrets, vars };
}

/** A random client IP, as Cloudflare puts in `cf-connecting-ip`. */
export const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".")}`;

/**
 * Starts the test composition on `databaseUrl` (already migrated), with Resend
 * as the email transport unless `vars` say otherwise. POSTs carry the Worker's
 * own `Origin`, as the SPA's do. Better Auth limits requests per client IP
 * (`cf-connecting-ip`), so each request comes from a random IP unless the test
 * sets the header; tests of the rate limit pin one.
 */
export async function startTestWorker({ databaseUrl, vars }: { databaseUrl: string; vars?: Record<string, string> }) {
  const server = createTestHarness({
    workers: [
      testWorker({ DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: TEST_SECRET, RESEND_API_KEY: "re_test" }, vars),
    ],
  });
  const { url } = await server.listen();
  const origin = url.origin;
  // Each response is read in full before it is returned: a body left unread holds
  // the harness's connection, and tests often ignore the body.
  const fetch = async (path: string, init: Parameters<typeof server.fetch>[1] = {}) => {
    const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
    if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", randomIp());
    const response = await server.fetch(path, { ...init, headers: Object.fromEntries(headers) });
    const body = await response.arrayBuffer();
    const nullBody = [101, 204, 205, 304].includes(response.status);
    return new Response(nullBody ? null : body, {
      status: response.status,
      headers: response.headers,
    });
  };
  return {
    origin,
    fetch,
    post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", origin, ...headers },
        body: JSON.stringify(body),
      }),
    /**
     * The ids of the user's MCP Connections (OAuth grants), read from the
     * Worker's `OAUTH_KV` in `workers-oauth-provider`'s key layout
     * (`grant:<userId>:<grantId>`, the user id URL-encoded as the Skeleton stores it).
     */
    grantsOf: async (userId: string) => {
      const env = await server.getWorker<{ OAUTH_KV: GrantStore }>().getEnv();
      const prefix = `grant:${encodeURIComponent(userId)}:`;
      const { keys } = await env.OAUTH_KV.list({ prefix });
      return keys.map((key) => key.name.slice(prefix.length)).filter((id) => !id.includes(":"));
    },
    /** Prints the Worker's runtime logs; call it when a test fails. */
    debug: () => server.debug(),
    close: () => server.close(),
  };
}

/** The part of a KV namespace `grantsOf` reads (the Worker types are not in scope here). */
type GrantStore = { list(options: { prefix: string }): Promise<{ keys: { name: string }[] }> };

export type TestWorker =Awaited<ReturnType<typeof startTestWorker>>;
