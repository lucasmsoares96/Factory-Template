import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { decode, verify } from "hono/jwt";
import { authSchema, users } from "../db/schema.ts";
import { changeEmailEmail } from "../emails/change-email.tsx";
import { resetPasswordEmail } from "../emails/reset-password.tsx";
import { verificationEmail } from "../emails/verify-email.tsx";
import type { Messages } from "../i18n/index.ts";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-rules.ts";
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

/** Better Auth's own code (and message) for an address taken at sign-up. */
const EMAIL_TAKEN = { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists. Use another email." };

const emailTaken = () => new APIError("BAD_REQUEST", EMAIL_TAKEN);

/** The id of the user who signs in with `email`, if any (emails are stored lower-cased). */
async function ownerOf(db: NodePgDatabase, email: string): Promise<string | undefined> {
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()));
  return owner?.id;
}

/**
 * The new address a change-of-email token moves the account to (its
 * `updateTo`), or `undefined` for any other verification token.
 */
function changeEmailTarget(token: string): string | undefined {
  try {
    const { updateTo } = decode(token).payload;
    return typeof updateTo === "string" ? updateTo : undefined;
  } catch {
    // Not a JWT: Better Auth refuses it as INVALID_TOKEN.
    return undefined;
  }
}

/**
 * The account a change-of-email link moves (its `email`) and the address it
 * moves it to (its `updateTo`), only when Better Auth signed the token (HS256
 * with the auth secret) and it has not expired; `undefined` otherwise, and
 * Better Auth refuses the link itself.
 */
async function verifiedChangeEmail(token: string, secret: string) {
  try {
    const { email, updateTo } = await verify(token, secret, "HS256");
    return typeof email === "string" && typeof updateTo === "string" ? { email, updateTo } : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `url` is a path on this app's own origin (never `//host` or `/\host`). */
function isOwnPath(url: string, baseURL: string): boolean {
  const origin = new URL(baseURL).origin;
  return url.startsWith("/") && new URL(url, origin).origin === origin;
}

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
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
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
      // A change of email sends its link to the new address, which the token
      // carries as `updateTo` (Better Auth passes `user.email` as that address).
      sendVerificationEmail: async ({ user, url, token }) => {
        const newEmail = changeEmailTarget(token);
        return sendEmail(
          newEmail
            ? await changeEmailEmail({ t, user, newEmail, url })
            : await verificationEmail({ t, user, url }),
        );
      },
      // The link in the new address was opened: the change is no longer pending.
      afterEmailVerification: async (user) => {
        await db.update(users).set({ pendingEmail: null }).where(eq(users.id, user.id));
      },
    },
    // The verification email goes to the new address; until its link is opened
    // the account keeps the old email, for signing in too.
    user: { changeEmail: { enabled: true } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Better Auth answers an address another account owns like a free one and
        // sends nothing; the account page must say so, translated by the code.
        if (ctx.path === "/change-email" && typeof ctx.body?.newEmail === "string") {
          const session = await getSessionFromCtx(ctx);
          // Better Auth answers 401 itself, before anyone learns who owns the address.
          if (!session) return;
          const owner = await ownerOf(db, ctx.body.newEmail);
          if (owner && owner !== session.user.id) throw emailTaken();
        }
        // Someone took the new address after the link was sent: changing to it
        // would break the unique email, so the link is refused like a bad token.
        if (ctx.path === "/verify-email" && typeof ctx.query?.token === "string") {
          // Only a token Better Auth signed: a forged one must not tell who owns an address.
          const change = await verifiedChangeEmail(ctx.query.token, ctx.context.secret);
          if (!change) return;
          const requester = await ownerOf(db, change.email);
          const owner = await ownerOf(db, change.updateTo);
          // No requester: the link was already used, and Better Auth answers USER_NOT_FOUND.
          if (!requester || !owner || owner === requester) return;
          // The change can no longer happen: the account page stops showing it as pending.
          await db
            .update(users)
            .set({ pendingEmail: null })
            .where(and(eq(users.id, requester), eq(users.pendingEmail, change.updateTo.toLowerCase())));
          const callbackURL = ctx.query.callbackURL;
          if (typeof callbackURL === "string" && isOwnPath(callbackURL, ctx.context.baseURL)) {
            const separator = callbackURL.includes("?") ? "&" : "?";
            throw ctx.redirect(`${callbackURL}${separator}error=${EMAIL_TAKEN.code}`);
          }
          throw emailTaken();
        }
      }),
      // The request was accepted: the account page shows the change as pending.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/change-email" || isAPIError(ctx.context.returned)) return;
        const session = await getSessionFromCtx(ctx);
        if (!session) return;
        await db
          .update(users)
          .set({ pendingEmail: String(ctx.body.newEmail).toLowerCase() })
          .where(eq(users.id, session.user.id));
      }),
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
