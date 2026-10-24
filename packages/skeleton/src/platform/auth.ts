import { betterAuth } from "better-auth";
import type { Context } from "hono";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Messages } from "../i18n/index.ts";
import { authOptions } from "./auth-options.ts";
import { createEmailSender, emailTransport } from "./email.ts";
import type { SkeletonEnv } from "./env.ts";
import { apiError } from "./errors.ts";
import { passwordHashing } from "./password.ts";
import { revokeAccessAfterCredentialChange } from "./credential-change.ts";
import { rateLimitStorage } from "./rate-limit.ts";

export type AuthConfig = {
  /** The Product's sender, e.g. `Example <no-reply@example.com>`. */
  emailFrom: string;
  t: Messages;
};

export type Auth = ReturnType<typeof createAuth>;

/**
 * The request's Better Auth instance. Links in emails use the origin the request
 * reached: on Workers that is a hostname routed to this Worker, never a header
 * the client controls.
 */
export function createAuth(c: Context<SkeletonEnv>, { emailFrom, t }: AuthConfig) {
  return betterAuth(
    authOptions({
      db: c.var.db,
      secret: c.env.BETTER_AUTH_SECRET,
      baseURL: new URL(c.req.url).origin,
      t,
      sendEmail: createEmailSender({
        transport: emailTransport(c.env.EMAIL_TRANSPORT),
        from: emailFrom,
        resendApiKey: c.env.RESEND_API_KEY,
        db: c.var.db,
      }),
      password: passwordHashing(c.env.PASSWORD_HASHER),
      rateLimit: rateLimitStorage(c.env.RATE_LIMITER),
      onCredentialChange: (user) => revokeAccessAfterCredentialChange(c, user),
      defer: c.var.defer,
    }),
  );
}

/**
 * Gives every `/api` route `c.var.auth()`: the request's Better Auth instance,
 * built on first use (the health check never builds one).
 */
export function authContext(config: AuthConfig) {
  return createMiddleware<SkeletonEnv>(async (c, next) => {
    let auth: Auth | undefined;
    c.set("auth", () => (auth ??= createAuth(c, config)));
    await next();
  });
}

/**
 * Better Auth's routes under `/api/auth/*`. They stay out of the OpenAPI document
 * (and the MCP). Better Auth's 429 carries no `code`, so it is answered as
 * `TOO_MANY_REQUESTS` like any other API error, with `Retry-After` in seconds.
 */
export const authRoutes = new Hono<SkeletonEnv>().on(["GET", "POST"], "/auth/*", async (c) => {
  const response = await c.var.auth().handler(c.req.raw);
  if (response.status !== 429) return response;
  const retryAfter = response.headers.get("x-retry-after") ?? "";
  return c.json(apiError("TOO_MANY_REQUESTS"), 429, { "Retry-After": retryAfter, "X-Retry-After": retryAfter });
});
