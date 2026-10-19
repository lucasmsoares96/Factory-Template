import { OpenAPIHono } from "@hono/zod-openapi";
import { database } from "./db.ts";
import type { SkeletonEnv } from "./env.ts";
import { health } from "./health.ts";

/**
 * The Skeleton's Hono app. A Product Worker exports it as its fetch handler;
 * Static Assets serve the SPA and `run_worker_first` sends `/api/*` here.
 */
export function createApp() {
  const api = new OpenAPIHono<SkeletonEnv>();
  api.use(database);
  api.route("/", health);

  return new OpenAPIHono<SkeletonEnv>().route("/api", api);
}
