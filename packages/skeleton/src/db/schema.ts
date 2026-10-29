import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  /**
   * The address the user asked to change to, until they open the link sent
   * there. Not a Better Auth field: the Skeleton sets and clears it (auth-options.ts).
   */
  pendingEmail: text("pending_email"),
  /**
   * The Stripe customer this person is: the card and the invoices are theirs (ADR 0015).
   * Not a Skeleton field: `@better-auth/stripe` reads and writes it, and only when billing is on.
   */
  stripeCustomerId: text("stripe_customer_id"),
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

/**
 * A person's agreement to pay for one Plan, kept in sync with Stripe by
 * `@better-auth/stripe` (model `subscription`, fields as the plugin declares
 * them). `referenceId` is the paying user's id (ADR 0015); `plan` is the Plan's
 * key, the Stripe product id lower-cased. Deleting the user deletes it.
 */
export const subscriptions = skeletonSchema.table(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("incomplete"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    seats: integer("seats"),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
  },
  (table) => [
    index("subscriptions_reference_id_idx").on(table.referenceId),
    uniqueIndex("subscriptions_stripe_subscription_id_idx").on(table.stripeSubscriptionId),
  ],
);

/** The schema the Better Auth Drizzle adapter reads (`usePlural: true`): the core tables and the billing plugin's. */
export const authSchema = { users, sessions, accounts, verifications, subscriptions };

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

/**
 * The tenants. The id is random and never changes (the SPA's URLs and the
 * Products' foreign keys use it); names may repeat.
 */
export const companies = skeletonSchema.table("companies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A user's membership in a Company, with exactly one role. The database keeps
 * one Member per Company and user, and a single Owner per Company. Deleting the
 * Company or the user deletes the Member. `createdAt` (when they joined) keeps
 * milliseconds only, so a list cursor built from it in JavaScript is exact. A
 * Suspended Member keeps the row, with `suspendedAt` set.
 */
export const members = skeletonSchema.table(
  "members",
  {
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role")
      .notNull()
      .references(() => memberRoles.id),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    /** When the user last opened the Company in the SPA: where they land after signing in. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, precision: 3 }),
    /** When the Owner's Seats fell short and the Member lost access to the Company; `null` while they have it. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.userId] }),
    index("members_user_id_idx").on(table.userId, table.createdAt),
    uniqueIndex("members_one_owner_idx").on(table.companyId).where(sql`${table.role} = 'owner'`),
  ],
);

/**
 * An offer, sent by email, for one address to join a Company with a role
 * (never `owner`). The email is kept lowercase. Only the SHA-256 hash of the
 * link's token is stored. It belongs to the Company: deleting the account of
 * whoever invited keeps it (`invitedBy` becomes null). Pending means neither
 * accepted nor canceled; the database keeps one pending Invitation per email
 * and Company. `createdAt` keeps milliseconds only, for the list's cursor.
 */
export const invitations = skeletonSchema.table(
  "invitations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role")
      .notNull()
      .references(() => memberRoles.id),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, precision: 3 }),
    canceledAt: timestamp("canceled_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [
    index("invitations_company_id_idx").on(table.companyId, table.createdAt),
    uniqueIndex("invitations_one_pending_idx")
      .on(table.companyId, table.email)
      .where(sql`${table.acceptedAt} is null and ${table.canceledAt} is null`),
    check("invitations_not_owner", sql`${table.role} <> 'owner'`),
  ],
);
