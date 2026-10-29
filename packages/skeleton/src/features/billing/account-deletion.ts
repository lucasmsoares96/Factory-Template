import { APIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { subscriptions } from "../../db/schema.ts";
import type { SkeletonEnv } from "../../platform/env.ts";
import { errorMessages } from "../../platform/error-codes.ts";
import { billingFor } from "./context.ts";

type Event = { c: Context<SkeletonEnv>; userId: string };

const LIVE = ["active", "trialing", "past_due"];

const liveSubscriptions = (c: Context<SkeletonEnv>, userId: string) =>
  c.var.db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.referenceId, userId), inArray(subscriptions.status, LIVE)));

/**
 * An account with a Subscription that is not canceled cannot be deleted: 409 `SUBSCRIPTION_ACTIVE`,
 * with the day the plan stays valid after canceling (`periodEnd`), which is not refunded. A
 * Subscription already set to cancel at the period's end is no obstacle: its paid days end
 * with the account (`endSubscriptions`).
 */
export async function refuseActiveSubscription({ c, userId }: Event, entitlements: readonly string[]) {
  if (!billingFor(c, entitlements)) return;
  const active = (await liveSubscriptions(c, userId)).filter((row) => !row.cancelAtPeriodEnd);
  if (active.length === 0) return;
  const periodEnd = active.map((row) => row.periodEnd).filter((date) => date !== null).sort((a, b) => b.getTime() - a.getTime())[0];
  throw new APIError("CONFLICT", {
    code: "SUBSCRIPTION_ACTIVE",
    message: errorMessages.SUBSCRIPTION_ACTIVE,
    periodEnd: periodEnd?.toISOString() ?? null,
  });
}

/** Ends, in Stripe, the Subscriptions of an account that is going for good: a canceled one's remaining paid days end now. */
export async function endSubscriptions({ c, userId }: Event, entitlements: readonly string[]) {
  const billing = billingFor(c, entitlements);
  if (!billing) return;
  for (const row of await liveSubscriptions(c, userId)) {
    if (!row.stripeSubscriptionId) continue;
    try {
      await billing.stripe.subscriptions.cancel(row.stripeSubscriptionId);
    } catch (error) {
      // Already gone in Stripe: nothing left to end.
      if ((error as { code?: string }).code !== "resource_missing") throw error;
    }
  }
}
