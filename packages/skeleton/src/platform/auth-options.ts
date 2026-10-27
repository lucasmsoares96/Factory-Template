import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { authSchema, companies, members } from "../db/schema.ts";
import { resetPasswordEmail } from "../emails/reset-password.tsx";
import { verificationEmail } from "../emails/verify-email.tsx";
import type { Messages } from "../i18n/index.ts";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-rules.ts";
import { AUTH_BASE_PATH } from "./auth-base-path.ts";
import type { SendEmail } from "./email.ts";
import { errorMessages } from "./error-codes.ts";

export { AUTH_BASE_PATH };

/** Better Auth's route for a signed-in user's password change (current plus new password). */
const CHANGE_PASSWORD_PATH = "/change-password";
/** Better Auth's route for a signed-in user's account deletion. */
const DELETE_USER_PATH = "/delete-user";

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
   * Revokes what outlives a password reset or change, or the account, besides
   * the sessions, which Better Auth deletes itself. The Worker passes `revokeAccess`.
   */
  revokeAccess?: (user: { id: string }) => Promise<void>;
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
  revokeAccess,
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
      onPasswordReset: async ({ user }) => revokeAccess?.(user),
    },
    user: {
      // The account page deletes the account, confirming with the password (the
      // before hook requires it). Better Auth checks the password, runs
      // `beforeDelete`, then deletes the user and their sessions; the database
      // deletes their Members and keeps the Invitations they sent.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await refuseOwner(db, user);
          await revokeAccess?.(user);
        },
      },
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
      // An account is deleted only with its password: never on a fresh session
      // alone, nor by an emailed token (the Skeleton sends none).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === DELETE_USER_PATH) {
          const body: unknown = ctx.body;
          if (!hasPassword(body)) throw new APIError("BAD_REQUEST", PASSWORD_CONFIRMATION);
          return;
        }
        if (ctx.path !== CHANGE_PASSWORD_PATH) return;
        return { context: { ...ctx, body: { ...ctx.body, revokeOtherSessions: true } } };
      }),
      // Then, as after a reset, the rest of the user's access goes too.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== CHANGE_PASSWORD_PATH) return;
        const returned: unknown = ctx.context.returned;
        if (isAPIError(returned) || !hasUser(returned)) return;
        await revokeAccess?.(returned.user);
      }),
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

/** Better Auth's own code for a wrong password, so the account page shows one message for both. */
const PASSWORD_CONFIRMATION = { code: "INVALID_PASSWORD", message: "Confirm with your password." };

/** A `/delete-user` body with a password and no deletion token. */
function hasPassword(body: unknown): boolean {
  if (typeof body !== "object" || body === null || "token" in body) return false;
  return "password" in body && typeof body.password === "string" && body.password !== "";
}

/**
 * Refuses to delete the account of an Owner, so no Company is left without one:
 * 409 `OWNER_OF_COMPANIES` with the Companies the user owns (by name), to
 * transfer or delete first. Nothing has changed yet when it throws.
 */
async function refuseOwner(db: NodePgDatabase, user: { id: string }) {
  const owned = await db
    .select({ id: companies.id, name: companies.name })
    .from(members)
    .innerJoin(companies, eq(companies.id, members.companyId))
    .where(and(eq(members.userId, user.id), eq(members.role, "owner")))
    .orderBy(asc(companies.name), asc(companies.id));
  if (owned.length === 0) return;
  throw new APIError("CONFLICT", { code: "OWNER_OF_COMPANIES", message: errorMessages.OWNER_OF_COMPANIES, companies: owned });
}

/** What `/change-password` answers on success: `{ token, user }`. */
function hasUser(value: unknown): value is { user: { id: string } } {
  const user = typeof value === "object" && value !== null && "user" in value ? value.user : undefined;
  return typeof user === "object" && user !== null && "id" in user && typeof user.id === "string";
}
