import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { authSchema } from "../db/schema.ts";
import { resetPasswordEmail } from "../emails/reset-password.tsx";
import { verificationEmail } from "../emails/verify-email.tsx";
import type { Messages } from "../i18n/index.ts";
import { AUTH_BASE_PATH } from "./auth-base-path.ts";
import type { SendEmail } from "./email.ts";

export { AUTH_BASE_PATH };

export type AuthOptionsInput = {
  db: NodePgDatabase;
  secret: string;
  /** The origin the Worker answers on: links in emails point here. */
  baseURL: string;
  /** The build locale's texts with the Product's overrides: the emails use them. */
  t: Messages;
  sendEmail: SendEmail;
  /** Better Auth's scrypt by default; the Worker passes the `PasswordHasher` pool. */
  password?: NonNullable<BetterAuthOptions["emailAndPassword"]>["password"];
  /**
   * Where Better Auth counts requests per client IP: the Worker passes the
   * `RateLimiter` Durable Object. Without it, an in-memory counter (tests).
   */
  rateLimit?: NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"];
  /**
   * Revokes what outlives a password reset besides the sessions, which Better
   * Auth deletes itself. The Worker passes `revokeAccessAfterPasswordReset`.
   */
  onPasswordReset?: (user: { id: string }) => Promise<void>;
  /** Runs work (emails) after the response, so a new and an existing email answer alike. */
  defer?: (task: Promise<unknown>) => void;
};

/**
 * The Skeleton's Better Auth config: email and password, with a verified email
 * required before any session. The Worker builds one per request (bindings only
 * exist inside a request); tests build a test-only instance from the same config.
 */
export function authOptions({
  db,
  secret,
  baseURL,
  t,
  sendEmail,
  password,
  rateLimit,
  onPasswordReset,
  defer,
}: AuthOptionsInput) {
  return {
    appName: t.app.title,
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      password,
      // Better Auth answers an unknown email exactly like a registered one and
      // only emails the registered: the email goes out after the response.
      sendResetPassword: async ({ user, url }) => sendEmail(await resetPasswordEmail({ t, user, url })),
      // Whoever reset the password may be taking the account back: every session
      // ends, and the user signs in again with the new password.
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => onPasswordReset?.(user),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => sendEmail(await verificationEmail({ t, user, url })),
    },
    // Always on: Better Auth only turns it on when NODE_ENV is "production", which
    // a Worker never sees. Its rules stay the defaults (sign-in and sign-up: 3 per
    // 10 s per IP). It runs before the password hash, so it also spares the hasher.
    rateLimit: { enabled: true, customStorage: rateLimit },
    advanced: {
      // Cloudflare sets this header to the client's IP and overwrites any value the
      // client sent; Better Auth's default (`x-forwarded-for`) is client-controlled.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...(defer ? { backgroundTasks: { handler: defer } } : {}),
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}
