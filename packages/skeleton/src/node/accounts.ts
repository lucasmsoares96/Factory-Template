import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { accounts, subscriptions, users } from "../db/schema.ts";
import { countSeats, seatPeople } from "../platform/seats.ts";

export { passwordProblem, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../platform/password-rules.ts";

// Accounts made straight in the database, for `pnpm bootstrap product`: the hash is Better Auth's own scrypt with its
// default parameters (the function the `PasswordHasher` Durable Object runs), so the Worker signs these users in.

type Target = { databaseUrl: string; email: string };

/** Better Auth stores and looks up emails in lower case. */
const normalize = (email: string) => email.trim().toLowerCase();

async function withDb<T>(databaseUrl: string, use: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const db = drizzle({ connection: { connectionString: databaseUrl, max: 1 } });
  try {
    return await use(db);
  } finally {
    await db.$client.end();
  }
}

/** Whether a user with this email is in the database; a database the migrations never reached has none. */
export function userExists({ databaseUrl, email }: Target): Promise<boolean> {
  return withDb(databaseUrl, (db) =>
    absentTables(async () => {
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, normalize(email))).limit(1);
      return rows.length > 0;
    }),
  );
}

/** A read on a database the migrations never reached answers `false` instead of failing. */
async function absentTables(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "42P01" || code === "3F000") return false; // undefined_table / invalid_schema_name
    throw error;
  }
}

/** Whether `email` is a verified user (one who can sign in); a database the migrations never reached has none. */
export function verifiedUserExists({ databaseUrl, email }: Target): Promise<boolean> {
  return withDb(databaseUrl, (db) =>
    absentTables(async () => {
      const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.email, normalize(email)), eq(users.emailVerified, true))).limit(1);
      return rows.length > 0;
    }),
  );
}

/**
 * Makes `email` a verified user who signs in with `password`. A new email gets a `user` row (`emailVerified`) and a
 * `credential` `account` row; an existing one is verified and gets the new password hash (a reset). One transaction.
 * The password is hashed here and never stored or returned.
 */
export async function upsertVerifiedUser({ databaseUrl, email, name, password }: Target & { name: string; password: string }): Promise<"created" | "password-reset"> {
  const hash = await hashPassword(password);
  const address = normalize(email);
  return withDb(databaseUrl, (db) =>
    db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, address)).limit(1);
      if (!existing) {
        const id = randomUUID();
        await tx.insert(users).values({ id, name, email: address, emailVerified: true });
        await tx.insert(accounts).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: hash });
        return "created" as const;
      }
      await tx.update(users).set({ emailVerified: true }).where(eq(users.id, existing.id));
      const credential = and(eq(accounts.userId, existing.id), eq(accounts.providerId, "credential"));
      const updated = await tx.update(accounts).set({ password: hash }).where(credential).returning({ id: accounts.id });
      if (updated.length === 0) {
        await tx.insert(accounts).values({ id: randomUUID(), accountId: existing.id, providerId: "credential", userId: existing.id, password: hash });
      }
      return "password-reset" as const;
    }),
  );
}

/** An account that exists in the database, as `pnpm bootstrap billing` sees it when it turns billing on. */
export type ExistingAccount = {
  id: string;
  email: string;
  name: string;
  /** The Seats the people in the Companies the account owns take (the Owner's own at least). */
  seats: number;
  /** The account has a Subscription row, of any status. */
  subscribed: boolean;
  stripeCustomerId: string | null;
};

/** The accounts that can sign in (verified, not archived), oldest first, with the Seats they take and whether billing already knows them. */
export function listAccountsWithSeats({ databaseUrl }: { databaseUrl: string }): Promise<ExistingAccount[]> {
  return withDb(databaseUrl, async (db) => {
    const rows = await db
      .select({ id: users.id, email: users.email, name: users.name, stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(and(eq(users.emailVerified, true), isNull(users.archivedAt)))
      .orderBy(asc(users.createdAt), asc(users.id));
    const withSubscription = new Set((await db.select({ id: subscriptions.referenceId }).from(subscriptions)).map((row) => row.id));
    const found: ExistingAccount[] = [];
    for (const row of rows) {
      found.push({ ...row, seats: Math.max(countSeats(await seatPeople(db, row.id)), 1), subscribed: withSubscription.has(row.id) });
    }
    return found;
  });
}

/** Records the Stripe customer of a user, where `@better-auth/stripe` looks for it when a Subscription event arrives. */
export function linkStripeCustomer({ databaseUrl, userId, customerId }: { databaseUrl: string; userId: string; customerId: string }): Promise<void> {
  return withDb(databaseUrl, async (db) => {
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
  });
}
