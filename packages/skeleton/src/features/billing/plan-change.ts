import type { subscriptions } from "../../db/schema.ts";
import type { PlanCatalog, Plan, StripePlan } from "./plans.ts";

export type Interval = "month" | "year";

/** Where a person stands: the Plan, how often they pay and how many Seats they have. */
export type Standing = { plan: Plan; interval: Interval; seats: number | null };

/** What a person asks for. `seats` is read for a Plan priced per Seat only; `interval` defaults to the current one. */
export type ChangeRequest = { plan: string; interval?: Interval; seats?: number };

export type ChangeError = "NOT_FOUND" | "VALIDATION_FAILED" | "ALREADY_ON_PLAN" | "SEATS_BELOW_MINIMUM";

export type Change =
  | { error: ChangeError; minimum?: number }
  | {
      error?: undefined;
      target: StripePlan;
      interval: Interval;
      /** The Seats bought: only for a Plan priced per Seat. */
      seats: number | null;
      /** `now`: a rise, charged for what is left of the period. `period_end`: a drop, or a mix, when the paid period ends. */
      timing: "now" | "period_end";
      /** The Seats the person has once the change applies; `null` for no limit. */
      seatsAfter: number | null;
    };

/** The Seats a Plan gives: its own number for a fixed one, the ones bought for a Plan priced per Seat. */
function seatsGiven(plan: Plan, bought: number | null): number | null {
  return plan.kind === "per_seat" ? bought : plan.seats;
}

/** What the Plan costs a month: its price, times the Seats bought for a Plan priced per Seat. */
function monthly(plan: Plan, bought: number | null): number {
  return (plan.price?.amount ?? 0) * (plan.kind === "per_seat" ? (bought ?? 1) : 1);
}

/**
 * Where the person stands, from their live Subscription row: the Plan they are on, how often they pay (`billingInterval`,
 * monthly unless the row says `year`) and the Seats they bought (`seats` of the row, for a Plan priced per Seat).
 * `null` on the free Plan or without a Plan.
 */
export function standingOf(plan: Plan | null, live: typeof subscriptions.$inferSelect | undefined): Standing | null {
  if (!plan || !live || plan.kind === "free") return null;
  return {
    plan,
    interval: live.billingInterval === "year" ? "year" : "month",
    seats: plan.kind === "per_seat" ? (live.seats ?? plan.minSeats ?? 1) : null,
  };
}

/** Whether the Plan can be bought at the interval: it has a price for it. */
export const hasInterval = (plan: Plan, interval: Interval) => (interval === "year" ? plan.yearlyPrice !== null : plan.price !== null);

/**
 * The Seats a purchase of `plan` takes: the request's for a Plan priced per Seat (below the Plan's minimum is refused),
 * the Plan's own for a fixed one. `fallback` is what a per-Seat purchase without a number takes.
 */
export function seatsToBuy(plan: Plan, requested: number | undefined, fallback: number | null): { seats: number | null } | { error: "SEATS_BELOW_MINIMUM"; minimum: number } {
  if (plan.kind !== "per_seat") return { seats: null };
  const minimum = plan.minSeats ?? 1;
  const seats = requested ?? Math.max(fallback ?? minimum, minimum);
  return seats < minimum ? { error: "SEATS_BELOW_MINIMUM", minimum } : { seats };
}

/**
 * Decides a change of Plan for a person who pays already. A change that only goes up (more per month, more Seats, or
 * monthly to yearly) applies at once; one that drops anything (a cheaper Plan, fewer Seats, yearly to monthly), or mixes a
 * rise with a drop, waits for the end of the paid period.
 */
export function decideChange(catalog: PlanCatalog, standing: Standing, request: ChangeRequest): Change {
  const target = catalog.priced.find((plan) => plan.id === request.plan);
  if (!target) return { error: "NOT_FOUND" };
  const interval = request.interval ?? standing.interval;
  if (!hasInterval(target, interval) || !Number.isInteger(request.seats ?? 1)) return { error: "VALIDATION_FAILED" };
  const bought = seatsToBuy(target, request.seats, target.id === standing.plan.id ? standing.seats : null);
  if ("error" in bought) return bought;
  if (target.id === standing.plan.id && interval === standing.interval && bought.seats === standing.seats) return { error: "ALREADY_ON_PLAN" };

  const before = monthly(standing.plan, standing.seats);
  const after = monthly(target, bought.seats);
  const rises = after > before || (standing.interval === "month" && interval === "year");
  const drops = after < before || (standing.interval === "year" && interval === "month");
  return {
    target,
    interval,
    seats: bought.seats,
    timing: rises && !drops ? "now" : "period_end",
    seatsAfter: seatsGiven(target, bought.seats),
  };
}
