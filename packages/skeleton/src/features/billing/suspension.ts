import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type Stripe from "stripe";
import { subscriptions } from "../../db/schema.ts";
import type { SkeletonEnv } from "../../platform/env.ts";
import { reconcileSeats } from "../../platform/suspension.ts";

/**
 * A Subscription changed in Stripe (the plugin has already written it): the Owner's Seats may have changed with it, so
 * the Suspended Members are recalculated. The person is found by the Subscription's id, which the plugin keeps; an event
 * for a Subscription nobody has is ignored. A failure answers the webhook with an error, so that Stripe delivers it again.
 */
export async function reconcileOnSubscriptionEvent(c: Context<SkeletonEnv>, event: Stripe.Event) {
  const object = event.data.object as { id?: string; subscription?: string | { id: string } | null };
  let stripeId: string | undefined;
  if (event.type.startsWith("customer.subscription.")) stripeId = object.id;
  else if (event.type === "checkout.session.completed") stripeId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id;
  if (!stripeId) return;
  const owned = await c.var.db
    .select({ referenceId: subscriptions.referenceId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, stripeId));
  for (const { referenceId } of owned) await reconcileSeats(c, referenceId, { rethrow: true });
}
