import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.ts";
import { MCP_CONNECTION, type SkeletonEnv } from "./env.ts";
import { apiError, errorResponse } from "./errors.ts";

/** The user a request acts for. */
export type IdentityUser = { id: string; name: string; email: string };

/**
 * Who is calling an `/api` route, whatever the credential. Routes read the user
 * from here and never from a cookie or a token, so one route serves both the SPA
 * and the MCP tools. `via` says which credential proved it: the SPA's session
 * cookie, or an MCP Connection's token (verified at `/mcp`).
 */
export type Identity = { user: IdentityUser; via: "session" | "mcp" };

/** A way to prove who is calling: answers `null` when its credential is absent or invalid. */
type IdentitySource = (c: Context<SkeletonEnv>) => Promise<Identity | null>;

/**
 * The SPA's Better Auth session cookie. When Better Auth extends the session,
 * its refreshed cookie goes out on the route's response.
 */
const session: IdentitySource = async (c) => {
  const { headers, response } = await c.var.auth().api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
  if (!response) return null;
  const { id, name, email } = response.user;
  return { user: { id, name, email }, via: "session" };
};

/**
 * An MCP tool call: `/mcp` verified the Connection's token and calls the tool's
 * route with the token's user in its `env`; the agent's token itself never
 * reaches the route. The token carries only the user's id, so the user is read
 * here: a deleted user proves nothing.
 */
const mcpConnection: IdentitySource = async (c) => {
  const connection = c.env[MCP_CONNECTION];
  if (!connection) return null;
  const [user] = await c.var.db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, connection.userId));
  return user ? { user, via: "mcp" } : null;
};

/**
 * Tried in order; the first one that proves an identity wins. A tool call never
 * carries a cookie, so the MCP Connection goes first and skips Better Auth.
 */
const sources: IdentitySource[] = [mcpConnection, session];

/** The single place that resolves who is calling, or `null` for an anonymous request. */
export async function resolveIdentity(c: Context<SkeletonEnv>): Promise<Identity | null> {
  for (const source of sources) {
    const identity = await source(c);
    if (identity) return identity;
  }
  return null;
}

/**
 * Route middleware for every operation that acts for a user: sets
 * `c.var.identity`, or answers 401 `UNAUTHENTICATED`. Declare the 401 with
 * `unauthenticatedResponse` in the route's `responses`.
 */
export const requireIdentity = createMiddleware<SkeletonEnv>(async (c, next) => {
  const identity = await resolveIdentity(c);
  if (!identity) return c.json(apiError("UNAUTHENTICATED"), 401);
  c.set("identity", identity);
  await next();
});

/** The 401 every route behind `requireIdentity` declares in its `responses`. */
export const unauthenticatedResponse = errorResponse(
  "No signed-in user: the session cookie (or the MCP Connection) is missing, expired or revoked.",
  "UNAUTHENTICATED",
);
