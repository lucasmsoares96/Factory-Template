import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { messagesFor, type MessageOverrides } from "../i18n/index.ts";
import { me } from "../features/me/api.ts";
import { authContext, authRoutes } from "./auth.ts";
import { database } from "./db.ts";
import type { SkeletonEnv } from "./env.ts";
import { createRouter, handleErrors } from "./errors.ts";
import { health } from "./health.ts";
import { buildLocale } from "./locale.ts";
import { AUTHORIZE_PATH, mcpBridge } from "./mcp/connections.ts";
import type { McpTool } from "./mcp/tool.ts";
import { openApiConfig } from "./openapi.ts";

export { openApiConfig };

export type AppOptions = {
  /** The Product's id; it titles the OpenAPI document. */
  title: string;
  /** The sender of every email, e.g. `Example <no-reply@example.com>`. */
  emailFrom: string;
  /** The Product's texts over the Skeleton's (the same ones its SPA uses); emails use them. */
  messages?: MessageOverrides;
  /** More routers under `/api`, each built with `createRouter()` (ticket 07 makes them Features). */
  routers?: OpenAPIHono<SkeletonEnv>[];
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
export function createApp({ title, emailFrom, messages, routers = [], mcpTools = [] }: AppOptions) {
  const t = messagesFor(buildLocale, messages);
  const app = new OpenAPIHono<SkeletonEnv>();
  const mcp = mcpBridge({ title, t, tools: mcpTools, app });
  const auth = authContext({ emailFrom, t });

  const api = createRouter();
  api.use(database, auth, mcp.context);
  api.route("/", health);
  api.route("/", authRoutes);
  api.route("/", me);
  for (const router of routers) api.route("/", router);

  app.route("/api", api);
  app.doc31("/api/openapi.json", openApiConfig(title));
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));
  app.use(AUTHORIZE_PATH, database, auth);
  app.route("/", mcp.routes);
  handleErrors(app);
  return app;
}
