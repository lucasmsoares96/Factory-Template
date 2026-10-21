import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { messagesFor } from "../i18n/index.ts";
import type { ProductConfig } from "../product.ts";
import { me } from "../features/me/api.ts";
import { authContext, authRoutes } from "./auth.ts";
import { database } from "./db.ts";
import { assertUniqueFeatures, type Feature } from "./feature.ts";
import type { SkeletonEnv } from "./env.ts";
import { createRouter, handleErrors } from "./errors.ts";
import { health } from "./health.ts";
import { buildLocale } from "./locale.ts";
import { AUTHORIZE_PATH, mcpBridge } from "./mcp/connections.ts";
import type { McpTool } from "./mcp/tool.ts";
import { openApiConfig } from "./openapi.ts";
import { previewOutbox } from "./preview-outbox.ts";

export { openApiConfig };

export type AppOptions = {
  /** The Product's identity (`product.config.ts`). */
  product: ProductConfig;
  /** The Product's features, mounted in order after the Skeleton's own routes. */
  features?: readonly Feature[];
  /** The MCP tools `pnpm generate` wrote for the Product (`mcp-tools.gen.json`). */
  mcpTools?: readonly McpTool[];
};

/**
 * The Skeleton's Hono app. A Product Worker exports it as its fetch handler;
 * Static Assets serve the SPA and `run_worker_first` sends `/api/*` here.
 * The OpenAPI document (`/api/openapi.json`) and Swagger UI (`/api/docs`) are
 * plain routes, so they stay out of the document itself, like Better Auth's.
 *
 * `/mcp` exposes every `/api` operation as an MCP tool (`mcpTools`), behind the
 * OAuth provider's `/oauth/*` and `/.well-known/*` routes; `/oauth/authorize` is
 * the consent page.
 */
export function createApp({ product, features = [], mcpTools = [] }: AppOptions) {
  assertUniqueFeatures(features);
  const { id: title, emailFrom, messages } = product;
  const t = messagesFor(buildLocale, messages);
  const app = new OpenAPIHono<SkeletonEnv>();
  const mcp = mcpBridge({ title, t, tools: mcpTools, app, features });
  const auth = authContext({ emailFrom, t });

  const api = createRouter();
  api.use(database, auth, mcp.context);
  api.route("/", health);
  api.route("/", authRoutes);
  api.route("/", me);
  // Answers only in a preview (see preview-outbox.ts); anywhere else it is a 404.
  api.route("/", previewOutbox);
  for (const feature of features) {
    const router = createRouter();
    feature.api(router);
    api.route("/", router);
  }

  app.route("/api", api);
  app.doc31("/api/openapi.json", openApiConfig(title));
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));
  app.use(AUTHORIZE_PATH, database, auth);
  app.route("/", mcp.routes);
  handleErrors(app);
  return app;
}
