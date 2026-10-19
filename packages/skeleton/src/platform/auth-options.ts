import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { authSchema } from "../db/schema.ts";
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
  /** Runs work (emails) after the response, so a new and an existing email answer alike. */
  defer?: (task: Promise<unknown>) => void;
};

/**
 * The Skeleton's Better Auth config: email and password, with a verified email
 * required before any session. The Worker builds one per request (bindings only
 * exist inside a request); tests build a test-only instance from the same config.
 */
export function authOptions({ db, secret, baseURL, t, sendEmail, password, defer }: AuthOptionsInput) {
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
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => sendEmail(await verificationEmail({ t, user, url })),
    },
    advanced: defer ? { backgroundTasks: { handler: defer } } : {},
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}
