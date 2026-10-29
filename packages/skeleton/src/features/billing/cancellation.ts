import type { SkeletonEnv } from "../../platform/env.ts";
import { countSeats, seatPeople } from "../../platform/seats.ts";
import type { PlanCatalog } from "./plans.ts";

/**
 * The people who lose access to the Owner's Companies when the paid Plan ends: the Seats taken beyond what the free
 * Plan gives (1 unless it says more). The Owner always keeps their own.
 */
export async function peopleLosingAccess(db: SkeletonEnv["Variables"]["db"], catalog: PlanCatalog, ownerId: string): Promise<number> {
  const free = catalog.plans.find((plan) => plan.kind === "free")?.seats ?? 1;
  const used = Math.max(countSeats(await seatPeople(db, ownerId)), 1);
  return Math.max(used - free, 0);
}
