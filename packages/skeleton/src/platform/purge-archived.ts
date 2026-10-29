import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { Context } from "hono";
import { users } from "../db/schema.ts";
import { ARCHIVE_DAYS } from "./auth-options.ts";
import type { SkeletonEnv } from "./env.ts";
import { emitAccountPurging } from "./feature.ts";

/**
 * Set only in the `env` of the in-Worker request `scheduled` makes to the sweep's route: a
 * symbol, so no binding, header or client can ever set it (like `MCP_CONNECTION`).
 */
export const PURGE_ARCHIVED = Symbol("skeleton.purge-archived");

/** The sweep's route, under `/api`. It answers only the Worker's own scheduled run. */
export const PURGE_ARCHIVED_PATH = "/internal/purge-archived";

/**
 * Deletes the accounts archived for `ARCHIVE_DAYS` or more (their Members, sessions and
 * Subscriptions go with them), after every feature ended what outlives them
 * (`accountPurging`: billing ends a canceled Subscription's paid days). An account whose
 * features fail stays archived and is tried again at the next run. Answers how many went.
 */
export async function purgeArchivedAccounts(c: Context<SkeletonEnv>): Promise<number> {
  const cutoff = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
  const due = await c.var.db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.archivedAt), lte(users.archivedAt, cutoff)));
  let purged = 0;
  for (const { id } of due) {
    try {
      await emitAccountPurging(c.var.features, { c, userId: id });
      await c.var.db.delete(users).where(and(eq(users.id, id), lte(users.archivedAt, cutoff)));
      purged += 1;
    } catch (error) {
      console.error(`Deleting the archived account ${id} failed:`, error);
    }
  }
  return purged;
}
