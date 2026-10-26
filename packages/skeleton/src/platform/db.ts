import { drizzle } from "drizzle-orm/node-postgres";
import { createMiddleware } from "hono/factory";
import type { SkeletonEnv } from "./env.ts";

export type Database = ReturnType<typeof createDatabase>;

/** A transaction on a `Database`: the same queries, rolled back together when one throws. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A Drizzle client over `pg`. It connects on the first query, never before. */
export function createDatabase(databaseUrl: string) {
  return drizzle({
    connection: { connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 },
  });
}

/**
 * One client per request, as Workers require: sockets cannot outlive the
 * request that opened them. `c.var.defer(task)` runs work after the response
 * (`waitUntil`); the connection closes once the response and every deferred
 * task are done.
 */
export const database = createMiddleware<SkeletonEnv>(async (c, next) => {
  const db = createDatabase(c.env.DATABASE_URL);
  const deferred: Promise<unknown>[] = [];
  c.set("db", db);
  c.set("defer", (task) => {
    deferred.push(task.catch((error: unknown) => console.error("Deferred task failed:", error)));
  });
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(Promise.allSettled(deferred).then(() => db.$client.end()));
  }
});
