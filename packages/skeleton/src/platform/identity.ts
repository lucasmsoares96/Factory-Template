import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { SkeletonEnv } from "./env.ts";
import { apiError, errorResponse } from "./errors.ts";

/** The user a request acts for. */
export type IdentityUser = { id: string; name: string; email: string };

/**
 * Who is calling an `/api` route, whatever the credential. Routes read the user
 * from here and never from a cookie or a token, so one route serves both the SPA
 * and (ticket 06) the MCP tools. `via` says which credential proved it.
 */
export type Identity = { user: IdentityUser; via: "session" };

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

/** Tried in order; the first one that proves an identity wins. The MCP token joins in ticket 06. */
const sources: IdentitySource[] = [session];

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
  "No signed-in user: the session cookie is missing, expired or revoked.",
  "UNAUTHENTICATED",
);
