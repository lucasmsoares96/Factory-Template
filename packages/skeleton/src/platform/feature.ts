import type { OpenAPIHono } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Database, Transaction } from "./db.ts";
import type { SkeletonEnv } from "./env.ts";

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
  nav?: FeatureNav;
  companyPage?: FeatureCompanyPage;
  /** Inserts the feature's demo data; used for preview databases and the E2E. Must be safe to run twice. */
  seed?(db: Database): Promise<void>;
  events?: FeatureEvents;
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
