import type { OpenAPIHono } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/server";
import type { BetterAuthPlugin } from "better-auth";
import type { Context } from "hono";
import type { Database, Transaction } from "./db.ts";
import type { SkeletonBindings, SkeletonEnv } from "./env.ts";

/** An entry in the signed-in navigation: `GET /api/nav` serves it and the signed-in shell renders it. */
export type FeatureNav = {
  /** The text shown, already translated for the build's locale or a message path of the Product. */
  label: string;
  /** The SPA path the entry opens. */
  to: string;
};

/** A section of the Company page: `GET /api/nav` serves it and the Skeleton's companies feature links to it. */
export type FeatureCompanyPage = {
  /** The text shown, already translated for the build's locale or a message path of the Product. */
  label: string;
  /** The SPA path of the section, under the Company's page: `/projects` opens `/c/<companyId>/projects`. */
  to: string;
};

/** A link on the account page: `GET /api/nav` serves it and the account page shows it. */
export type FeatureAccountPage = {
  /** The text shown, already translated for the build's locale or a message path of the Product. */
  label: string;
  /** The SPA path of the page, under the account's: `/account/plan`. */
  to: string;
};

/** What a feature may hook into when the Skeleton's companies feature emits it. */
export type FeatureEvents = {
  /** A user joined a company. */
  memberJoined?: (event: { db: Database; companyId: string; userId: string }) => Promise<void>;
  /**
   * A company is about to be deleted: delete or detach what belongs to it. `db` is
   * the deletion's transaction: when a hook throws, the whole deletion rolls back.
   */
  companyDeleting?: (event: { db: Transaction; companyId: string }) => Promise<void>;
};

/**
 * A slice of a Product (or of the Skeleton): the only way to add behaviour
 * without touching the Skeleton's core. A Product lists its features in
 * `src/features/index.ts` and `createApp()` mounts them.
 *
 * By convention a feature lives in `src/features/<id>/` and brings:
 * - `schema.ts`, picked up by the Product's drizzle config by glob;
 * - `routes/` (signed-in screens, mounted at `/<id>`) and `public/` (screens a
 *   visitor can open, also at `/<id>`), picked up by `skeleton generate` and the Vite plugin;
 * - `messages.ts`, spread into `product.config.ts`.
 */
export type Feature = {
  /** Unique within the Product; also the folder name and the UI route prefix. */
  id: string;
  /**
   * Adds the feature's routes. `app` is a router built with `createRouter()` that
   * `createApp()` mounts under `/api`; every operation in it becomes an MCP tool
   * unless it sets `x-mcp: false`.
   */
  api(app: OpenAPIHono<SkeletonEnv>): void;
  /**
   * Tools that cannot come from the OpenAPI document. Runs for every `/mcp` request,
   * so the tools it registers are not filtered by the token's scope: check it yourself.
   */
  mcp?(server: McpServer): void;
  /**
   * Better Auth plugins the feature adds to the Skeleton's auth config, after
   * the Skeleton's own options. The Skeleton's hooks still run, before the
   * plugins'; a plugin's `init` can still override options, so pick plugins that
   * leave sign-in, verification and deletion alone. Runs once per request that
   * builds the auth instance, so a plugin can read its secrets from `c.env`.
   * Their routes answer under `/api/auth/*` and, like Better Auth's own, stay out
   * of the OpenAPI document and the MCP tools. A plugin `schema` (its own tables
   * or fields) needs them in `authSchema` and a Skeleton migration: the Drizzle
   * adapter only knows the tables in that schema (billing's are there).
   */
  authPlugins?(c: Context<SkeletonEnv>): BetterAuthPlugin[];
  nav?: FeatureNav;
  companyPage?: FeatureCompanyPage;
  accountPage?: FeatureAccountPage;
  /**
   * Whether the feature is on for this deployment (its bindings decide). When it answers `false`, `GET /api/nav` leaves
   * out the feature's `nav`, `companyPage` and `accountPage`; the feature must refuse its own routes too. On by default.
   */
  enabled?(env: SkeletonBindings): boolean;
  /** Inserts the feature's demo data; used for preview databases and the E2E. Must be safe to run twice. */
  seed?(db: Database): Promise<void>;
  events?: FeatureEvents;
  /**
   * How many Seats the person has, across every Company they own: a number, or `null` for no limit. Answers `undefined`
   * when the feature sets no limit (billing off): the Seats are then not checked. Creating and accepting an Invitation
   * are refused (`NO_FREE_SEAT`) when they would take more. When the number cannot be read (billing's Stripe is down)
   * it answers a safe one, unless `strict` is set: then it throws, so that nobody is suspended on a guess.
   */
  seatLimit?(c: Context<SkeletonEnv>, ownerId: string, options?: { strict?: boolean }): Promise<number | null | undefined>;
};

/** Types a feature (identity at runtime). */
export function defineFeature(feature: Feature): Feature {
  return feature;
}

/** Fails when two features share an id: the id names routes, folders and tables. */
export function assertUniqueFeatures(features: readonly Feature[]) {
  const seen = new Set<string>();
  for (const { id } of features) {
    if (seen.has(id)) throw new Error(`Two features share the id "${id}".`);
    seen.add(id);
  }
}

/** Runs every feature's seed, in order. */
export async function seedFeatures(db: Database, features: readonly Feature[]) {
  for (const feature of features) await feature.seed?.(db);
}

/** Runs every feature's `memberJoined`, in mount order: a user just became a Member of a Company. */
export async function emitMemberJoined(
  features: readonly Feature[],
  event: Parameters<NonNullable<FeatureEvents["memberJoined"]>>[0],
) {
  for (const feature of features) await feature.events?.memberJoined?.(event);
}

/**
 * Runs every feature's `companyDeleting`, in mount order: a Company is about to
 * be deleted, and still has its Members. Pass the deletion's transaction: a hook
 * that throws rolls the whole deletion back.
 */
export async function emitCompanyDeleting(
  features: readonly Feature[],
  event: Parameters<NonNullable<FeatureEvents["companyDeleting"]>>[0],
) {
  for (const feature of features) await feature.events?.companyDeleting?.(event);
}

/**
 * The Seats `ownerId` has: the first feature that sets a limit decides. `undefined` means no feature limits Seats
 * (they are not checked), `null` that the limit is none.
 */
export async function seatLimitOf(
  c: Context<SkeletonEnv>,
  ownerId: string,
  options?: { strict?: boolean },
): Promise<number | null | undefined> {
  for (const feature of c.var.features) {
    if (feature.enabled && !feature.enabled(c.env)) continue;
    const limit = await feature.seatLimit?.(c, ownerId, options);
    if (limit !== undefined) return limit;
  }
  return undefined;
}
