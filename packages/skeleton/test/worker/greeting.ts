import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";

/**
 * A test-only Better Auth plugin with one public route, `GET /greeting/hello`.
 */
export const greeting = () =>
  ({
    id: "greeting",
    endpoints: {
      greetingHello: createAuthEndpoint("/greeting/hello", { method: "GET" }, async (ctx) =>
        ctx.json({ greeting: "hello" }),
      ),
    },
  }) satisfies BetterAuthPlugin;
