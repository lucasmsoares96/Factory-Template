import { drizzle } from "drizzle-orm/node-postgres";
import { createMiddleware } from "hono/factory";
import type { SkeletonEnv } from "./env.ts";

export type Database = ReturnType<typeof createDatabase>;

/** A Drizzle client over `pg`. It connects on the first query, never before. */
export function createDatabase(databaseUrl: string) {
  return drizzle({
    connection: { connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 },
  });
}

/**
 * One client per request, as Workers require: sockets cannot outlive the
 * request that opened them. The connection closes after the response.
 */
export const database = createMiddleware<SkeletonEnv>(async (c, next) => {
  const db = createDatabase(c.env.DATABASE_URL);
  c.set("db", db);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(db.$client.end());
  }
});
