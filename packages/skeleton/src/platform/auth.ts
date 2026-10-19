import { betterAuth } from "better-auth";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Messages } from "../i18n/index.ts";
import { authOptions } from "./auth-options.ts";
import { createEmailSender, emailTransport } from "./email.ts";
import type { SkeletonEnv } from "./env.ts";
import { passwordHashing } from "./password.ts";

export type AuthConfig = {
  /** The Product's sender, e.g. `Example <no-reply@example.com>`. */
  emailFrom: string;
  t: Messages;
};

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
      defer: c.var.defer,
    }),
  );
}

/** Better Auth's routes under `/api/auth/*`. They stay out of the OpenAPI document (and the MCP). */
export function authRoutes(config: AuthConfig) {
  return new Hono<SkeletonEnv>().on(["GET", "POST"], "/auth/*", (c) => createAuth(c, config).handler(c.req.raw));
}
