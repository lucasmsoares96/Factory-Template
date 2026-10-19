import { createRoute, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { apiError, apiErrorSchema, createRouter } from "./errors.ts";

const Health = z.object({ status: z.literal("ok") }).openapi("Health");

const getHealth = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Check the service health",
  description: "Answers ok when the Worker is up and its database answers a query.",
  // A probe for the platform, not something an agent acts on.
  "x-mcp": false,
  responses: {
    200: { description: "The service and its database are up.", content: { "application/json": { schema: Health } } },
    503: {
      description: "The database did not answer.",
      content: { "application/json": { schema: apiErrorSchema("DATABASE_UNAVAILABLE") } },
    },
  },
});

export const health = createRouter().openapi(getHealth, async (c) => {
  try {
    await c.var.db.execute(sql`select 1`);
    return c.json({ status: "ok" as const }, 200);
  } catch {
    return c.json(apiError("DATABASE_UNAVAILABLE"), 503);
  }
});
