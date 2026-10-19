import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { database } from "./db.ts";
import type { SkeletonEnv } from "./env.ts";
import { createRouter, handleErrors } from "./errors.ts";
import { health } from "./health.ts";

export type AppOptions = {
  /** The Product's id; it titles the OpenAPI document. */
  title: string;
};

/** The OpenAPI document config, shared by `/api/openapi.json` and `skeleton generate`. */
export function openApiConfig(title: string) {
  return { openapi: "3.1.0", info: { title, version: "1.0.0" } };
}

/**
 * The Skeleton's Hono app. A Product Worker exports it as its fetch handler;
 * Static Assets serve the SPA and `run_worker_first` sends `/api/*` here.
 * The OpenAPI document (`/api/openapi.json`) and Swagger UI (`/api/docs`) are
 * plain routes, so they stay out of the document itself.
 */
export function createApp({ title }: AppOptions) {
  const api = createRouter();
  api.use(database);
  api.route("/", health);

  const app = new OpenAPIHono<SkeletonEnv>().route("/api", api);
  app.doc31("/api/openapi.json", openApiConfig(title));
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));
  handleErrors(app);
  return app;
}
