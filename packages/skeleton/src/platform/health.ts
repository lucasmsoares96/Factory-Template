import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import type { SkeletonEnv } from "./env.ts";

const Healthy = z.object({ status: z.literal("ok") }).openapi("Health");
const Unhealthy = z
  .object({
    status: z.literal("error"),
    code: z.literal("DATABASE_UNAVAILABLE"),
    message: z.string(),
  })
  .openapi("HealthError");

const getHealth = createRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Check the service health",
  description: "Answers ok when the Worker is up and its database answers a query.",
  responses: {
    200: { description: "The service and its database are up.", content: { "application/json": { schema: Healthy } } },
    503: { description: "The database did not answer.", content: { "application/json": { schema: Unhealthy } } },
  },
});

export const health = new OpenAPIHono<SkeletonEnv>().openapi(getHealth, async (c) => {
  try {
    await c.var.db.execute(sql`select 1`);
    return c.json({ status: "ok" as const }, 200);
  } catch {
    return c.json(
      { status: "error" as const, code: "DATABASE_UNAVAILABLE" as const, message: "The database is unavailable." },
      503,
    );
  }
});
