import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { messagesFor } from "../i18n/index.ts";
import type { ExecutionContext } from "hono";
import type { ProductConfig } from "../product.ts";
import { account } from "../features/account/index.ts";
import { companies } from "../features/companies/index.ts";
import { invitations } from "../features/invitations/index.ts";
import { me } from "../features/me/api.ts";
import { authContext, authRoutes } from "./auth.ts";
import { database } from "./db.ts";
import { emailContext } from "./email.ts";
import { assertUniqueFeatures, type Feature } from "./feature.ts";
import type { SkeletonEnv } from "./env.ts";
import { apiError, createRouter, handleErrors } from "./errors.ts";
import { health } from "./health.ts";
import { buildLocale } from "./locale.ts";
import { AUTHORIZE_PATH, mcpBridge } from "./mcp/connections.ts";
import type { McpTool } from "./mcp/tool.ts";
import { navRoutes } from "./nav.ts";
import { openApiConfig } from "./openapi.ts";
import { previewOutbox } from "./preview-outbox.ts";
import { PURGE_ARCHIVED, PURGE_ARCHIVED_PATH, purgeArchivedAccounts } from "./purge-archived.ts";

export { openApiConfig };

/** The Skeleton's own features, in every Product, mounted before the Product's. */
const skeletonFeatures: readonly Feature[] = [account, companies, invitations];

export type AppOptions = {
  /** The Product's identity (`product.config.ts`). */
  product: ProductConfig;
  /** The Product's features, mounted in order after the Skeleton's own routes and features. */
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
export function createApp({ product, features: productFeatures = [], mcpTools = [] }: AppOptions) {
  const features = [...skeletonFeatures, ...productFeatures];
  assertUniqueFeatures(features);
  const { id: title, emailFrom, messages } = product;
  const t = messagesFor(buildLocale, messages);
  const app = new OpenAPIHono<SkeletonEnv>();
  const mcp = mcpBridge({ title, t, tools: mcpTools, app, features });
  const auth = authContext({ productId: title, emailFrom, t, features });

  const api = createRouter();
  api.use(database, auth, emailContext({ emailFrom, t }), mcp.context, async (c, next) => {
    c.set("features", features);
    await next();
  });
  api.route("/", health);
  api.route("/", authRoutes);
  api.route("/", me);
  api.route("/", navRoutes({ features, t }));
  // Answers only in a preview (see preview-outbox.ts); anywhere else it is a 404.
  api.route("/", previewOutbox);
  // The daily sweep of archived accounts: only the Worker's own `scheduled` run reaches it.
  api.post(PURGE_ARCHIVED_PATH, async (c) => {
    if (!(PURGE_ARCHIVED in c.env)) return c.json(apiError("NOT_FOUND"), 404);
    return c.json({ purged: await purgeArchivedAccounts(c) });
  });
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
  // The Worker's cron trigger (daily, in the Product's wrangler config) deletes the accounts
  // whose 30 days of archive are over. It calls its own route so the sweep gets the request's
  // usual context (database, auth, features).
  return Object.assign(app, {
    async scheduled(_controller: unknown, env: SkeletonEnv["Bindings"], ctx: ExecutionContext) {
      const response = await app.request(`/api${PURGE_ARCHIVED_PATH}`, { method: "POST" }, { ...env, [PURGE_ARCHIVED]: true }, ctx);
      if (!response.ok) throw new Error(`Deleting the archived accounts failed: ${response.status}.`);
    },
  });
}
