import { sql } from "drizzle-orm";
import { boolean, index, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Every Skeleton table lives in this Postgres schema, apart from the Product's tables in `public`. */
export const skeletonSchema = pgSchema("skeleton");

/**
 * The roles a Member can hold in a Company. The Skeleton seeds `owner` and
 * `employee`; a Product adds its own roles with an `INSERT` in its migrations.
 */
export const memberRoles = skeletonSchema.table("member_roles", {
  id: text("id").primaryKey(),
});

// Better Auth's core tables (models `user`, `session`, `account`, `verification`,
// with `usePlural`). Property names are the fields Better Auth reads and writes.
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = skeletonSchema.table("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = skeletonSchema.table(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = skeletonSchema.table(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Better Auth's scrypt hash (`salt:key`), computed in the `PasswordHasher` Durable Object. */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = skeletonSchema.table(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/** The schema the Better Auth Drizzle adapter reads (`usePlural: true`). */
export const authSchema = { users, sessions, accounts, verifications };

/**
 * Every email the outbox transport "sent": in previews and tests the Worker
 * writes here instead of calling Resend.
 */
export const emailOutbox = skeletonSchema.table(
  "email_outbox",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    to: text("to").notNull(),
    from: text("from").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("email_outbox_to_idx").on(table.to, table.createdAt)],
);
