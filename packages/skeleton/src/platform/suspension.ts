import type { Context } from "hono";
import type { SkeletonEnv } from "./env.ts";
import { seatLimitOf } from "./feature.ts";
import { applySeatLimit, lockSeats, ownerOf, type SeatReconciliation } from "./seats.ts";

/**
 * Recalculates who is suspended among the Companies `ownerId` owns, against the Seats a feature gives them now (see
 * `applySeatLimit`). Run it whenever the Seats or the people change: a Subscription event, someone joins, leaves or is
 * removed, an Invitation is canceled, a Company is deleted. Where no feature limits Seats, nobody stays suspended.
 *
 * It never suspends on a guess: when the limit cannot be read it changes nothing. A failure is logged and swallowed,
 * so the change that triggered it stands, unless `rethrow` is set (the Stripe webhook, which Stripe then retries).
 */
export async function reconcileSeats(
  c: Context<SkeletonEnv>,
  ownerId: string,
  { rethrow = false }: { rethrow?: boolean } = {},
): Promise<SeatReconciliation | undefined> {
  try {
    const limit = await seatLimitOf(c, ownerId, { strict: true });
    return await c.var.db.transaction(async (tx) => {
      await lockSeats(tx, ownerId);
      return applySeatLimit(tx, ownerId, limit);
    });
  } catch (error) {
    if (rethrow) throw error;
    console.error("Recalculating the Suspended Members failed:", error);
    return undefined;
  }
}

/** `reconcileSeats` for the Owner of a Company, when it still has one. */
export async function reconcileSeatsOfCompany(c: Context<SkeletonEnv>, companyId: string) {
  const ownerId = await ownerOf(c.var.db, companyId);
  if (ownerId) await reconcileSeats(c, ownerId);
}
