import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { authSchema } from "../db/schema.ts";
import { resetPasswordEmail } from "../emails/reset-password.tsx";
import { verificationEmail } from "../emails/verify-email.tsx";
import type { Messages } from "../i18n/index.ts";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-rules.ts";
import { AUTH_BASE_PATH } from "./auth-base-path.ts";
import type { SendEmail } from "./email.ts";

export { AUTH_BASE_PATH };

/** Better Auth's route for a signed-in user's password change (current plus new password). */
const CHANGE_PASSWORD_PATH = "/change-password";

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
   * Revokes what outlives a password reset or change besides the sessions, which
   * Better Auth deletes itself. The Worker passes `revokeAccessAfterCredentialChange`.
   */
  onCredentialChange?: (user: { id: string }) => Promise<void>;
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
  onCredentialChange,
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
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Better Auth answers an unknown email exactly like a registered one and
      // only emails the registered: the email goes out after the response.
      sendResetPassword: async ({ user, url }) => sendEmail(await resetPasswordEmail({ t, user, url })),
      // Whoever reset the password may be taking the account back: every session
      // ends, and the user signs in again with the new password.
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => onCredentialChange?.(user),
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
    hooks: {
      // A password change from the account page ends every other session, whatever
      // the request asks: the old password may be what someone else signed in with.
      // Better Auth deletes them and opens a new session for this browser.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== CHANGE_PASSWORD_PATH) return;
        return { context: { ...ctx, body: { ...ctx.body, revokeOtherSessions: true } } };
      }),
      // Then, as after a reset, the rest of the user's access goes too.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== CHANGE_PASSWORD_PATH) return;
        const returned: unknown = ctx.context.returned;
        if (isAPIError(returned) || !hasUser(returned)) return;
        await onCredentialChange?.(returned.user);
      }),
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

/** What `/change-password` answers on success: `{ token, user }`. */
function hasUser(value: unknown): value is { user: { id: string } } {
  const user = typeof value === "object" && value !== null && "user" in value ? value.user : undefined;
  return typeof user === "object" && user !== null && "id" in user && typeof user.id === "string";
}
