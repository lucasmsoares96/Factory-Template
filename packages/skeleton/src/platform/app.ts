import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { messagesFor, type MessageOverrides } from "../i18n/index.ts";
import { authRoutes } from "./auth.ts";
import { database } from "./db.ts";
import type { SkeletonEnv } from "./env.ts";
import { createRouter, handleErrors } from "./errors.ts";
import { health } from "./health.ts";
import { buildLocale } from "./locale.ts";
import { openApiConfig } from "./openapi.ts";

export { openApiConfig };

export type AppOptions = {
  /** The Product's id; it titles the OpenAPI document. */
  title: string;
  /** The sender of every email, e.g. `Example <no-reply@example.com>`. */
  emailFrom: string;
  /** The Product's texts over the Skeleton's (the same ones its SPA uses); emails use them. */
  messages?: MessageOverrides;
};

/**
 * The Skeleton's Hono app. A Product Worker exports it as its fetch handler;
 * Static Assets serve the SPA and `run_worker_first` sends `/api/*` here.
 * The OpenAPI document (`/api/openapi.json`) and Swagger UI (`/api/docs`) are
 * plain routes, so they stay out of the document itself, like Better Auth's.
 */
export function createApp({ title, emailFrom, messages }: AppOptions) {
  const t = messagesFor(buildLocale, messages);
  const api = createRouter();
  api.use(database);
  api.route("/", health);
  api.route("/", authRoutes({ emailFrom, t }));

  const app = new OpenAPIHono<SkeletonEnv>().route("/api", api);
  app.doc31("/api/openapi.json", openApiConfig(title));
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));
  handleErrors(app);
  return app;
}
