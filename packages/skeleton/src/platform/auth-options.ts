import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { decode, verify } from "hono/jwt";
import { authSchema, companies, members, users } from "../db/schema.ts";
import { changeEmailEmail } from "../emails/change-email.tsx";
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
  /** The features' Better Auth plugins (`Feature.authPlugins`), added to the Skeleton's options. */
  plugins?: BetterAuthPlugin[];
};

/** Better Auth's own code (and message) for an address taken at sign-up. */
const EMAIL_TAKEN = { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists. Use another email." };

const emailTaken = () => new APIError("BAD_REQUEST", EMAIL_TAKEN);

/** A change-of-email link that is no longer the pending one: refused with Better Auth's code for a bad link. */
const LINK_REPLACED = { code: "INVALID_TOKEN", message: "Invalid token" };

/** Better Auth refuses the account's own email with no code; the account page needs one to translate. */
const emailUnchanged = () =>
  new APIError("BAD_REQUEST", { code: "EMAIL_UNCHANGED", message: errorMessages.EMAIL_UNCHANGED });

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
  revokeAccess,
  defer,
  plugins = [],
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
      // The verification email goes to the new address; until its link is opened
      // the account keeps the old email, for signing in too.
      changeEmail: { enabled: true },
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // An account is deleted only with its password: never on a fresh session
        // alone, nor by an emailed token (the Skeleton sends none).
        if (ctx.path === DELETE_USER_PATH) {
          const body: unknown = ctx.body;
          if (!hasPassword(body)) throw new APIError("BAD_REQUEST", PASSWORD_CONFIRMATION);
          return;
        }
        // A password change from the account page ends every other session, whatever
        // the request asks: the old password may be what someone else signed in with.
        // Better Auth deletes them and opens a new session for this browser.
        if (ctx.path === CHANGE_PASSWORD_PATH) {
          return { context: { ...ctx, body: { ...ctx.body, revokeOtherSessions: true } } };
        }
        // Better Auth answers an address another account owns like a free one and
        // sends nothing; the account page must say so, translated by the code.
        if (ctx.path === "/change-email" && typeof ctx.body?.newEmail === "string") {
          const session = await getSessionFromCtx(ctx);
          // Better Auth answers 401 itself, before anyone learns who owns the address.
          if (!session) return;
          const owner = await ownerOf(db, ctx.body.newEmail);
          if (owner === session.user.id) throw emailUnchanged();
          if (owner) throw emailTaken();
        }
        // Someone took the new address after the link was sent: changing to it
        // would break the unique email, so the link is refused like a bad token.
        if (ctx.path === "/verify-email" && typeof ctx.query?.token === "string") {
          // Only a token Better Auth signed: a forged one must not tell who owns an address.
          const change = await verifiedChangeEmail(ctx.query.token, ctx.context.secret);
          if (!change) return;
          const updateTo = change.updateTo.toLowerCase();
          const [requester] = await db
            .select({ id: users.id, pendingEmail: users.pendingEmail })
            .from(users)
            .where(eq(users.email, change.email.toLowerCase()));
          // No requester: the link was already used, and Better Auth answers USER_NOT_FOUND.
          if (!requester) return;
          const refuse = (error: { code: string; message: string }) => {
            const callbackURL = ctx.query?.callbackURL;
            if (typeof callbackURL === "string" && isOwnPath(callbackURL, ctx.context.baseURL)) {
              const separator = callbackURL.includes("?") ? "&" : "?";
              return ctx.redirect(`${callbackURL}${separator}error=${error.code}`);
            }
            return new APIError("BAD_REQUEST", error);
          };
          // A later request (the one the account page shows) or a cancelled one replaced
          // this link: an address the user gave up on must not take the account over.
          if (requester.pendingEmail !== updateTo) throw refuse(LINK_REPLACED);
          const owner = await ownerOf(db, updateTo);
          if (!owner || owner === requester.id) return;
          // The change can no longer happen: the account page stops showing it as pending.
          await db
            .update(users)
            .set({ pendingEmail: null })
            .where(and(eq(users.id, requester.id), eq(users.pendingEmail, updateTo)));
          throw refuse(EMAIL_TAKEN);
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // After a password change, as after a reset, the rest of the user's access goes too.
        if (ctx.path === CHANGE_PASSWORD_PATH) {
          const returned: unknown = ctx.context.returned;
          if (isAPIError(returned) || !hasUser(returned)) return;
          await revokeAccess?.(returned.user);
          return;
        }
        // A change of email was accepted: the account page shows it as pending.
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
    plugins,
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
