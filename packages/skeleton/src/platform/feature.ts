import type { OpenAPIHono } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Database } from "./db.ts";
import type { SkeletonEnv } from "./env.ts";

/** An entry in the signed-in navigation (rendered by the shell that comes with the Factory's account feature). */
export type FeatureNav = {
  /** The text shown, already translated for the build's locale or a message path of the Product. */
  label: string;
  /** The SPA path the entry opens. */
  to: string;
};

/** A section of the company page (rendered by the Factory's companies feature). */
export type FeatureCompanyPage = {
  label: string;
  /** The SPA path of the section, under the company's page. */
  to: string;
};

/** What a feature may hook into when the Factory's companies feature emits it. */
export type FeatureEvents = {
  /** A user joined a company. */
  memberJoined?: (event: { db: Database; companyId: string; userId: string }) => Promise<void>;
  /** A company is about to be deleted: delete or detach what belongs to it. */
  companyDeleting?: (event: { db: Database; companyId: string }) => Promise<void>;
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
