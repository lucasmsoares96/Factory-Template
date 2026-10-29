import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type Stripe from "stripe";
import { subscriptions, users } from "../../db/schema.ts";
import { paymentFailedEmail } from "../../emails/payment-failed.tsx";
import { subscriptionCanceledEmail } from "../../emails/subscription-canceled.tsx";
import type { SkeletonEnv } from "../../platform/env.ts";
import { buildLocale } from "../../platform/locale.ts";
import { PLAN_PAGE } from "./api.ts";
import { peopleLosingAccess } from "./cancellation.ts";
import type { Billing } from "./context.ts";
import { retryDeadline } from "./grace.ts";

const day = (date: Date) => new Intl.DateTimeFormat(buildLocale, { dateStyle: "long", timeZone: "UTC" }).format(date);

/**
 * Stripe changed a Subscription (the plugin has already written it). Two changes are told to the Owner, and only to the
 * Owner, by email in the app's language: the payment failed (the day the card can be updated until) and the Subscription
 * was set to end with the period (its last day and how many people lose access then). Only the change itself counts, read
 * from the event's `previous_attributes`, so a later update of the same state sends nothing. The send is awaited: when it
 * fails, the webhook answers an error and Stripe delivers the event again.
 */
export async function sendSubscriptionNotices(c: Context<SkeletonEnv>, billing: Billing, event: Stripe.Event) {
  if (event.type !== "customer.subscription.updated") return;
  const subscription = event.data.object;
  const previous = event.data.previous_attributes ?? {};
  const failed = subscription.status === "past_due" && "status" in previous && previous.status !== "past_due";
  const canceled = subscription.cancel_at_period_end && "cancel_at_period_end" in previous && previous.cancel_at_period_end === false;
  if (!failed && !canceled) return;
  const [row] = await c.var.db
    .select({ ownerId: subscriptions.referenceId, plan: subscriptions.plan, periodStart: subscriptions.periodStart, periodEnd: subscriptions.periodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
  if (!row) return;
  const [owner] = await c.var.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, row.ownerId));
  if (!owner) return;
  const catalog = await billing.plans();
  const planName = catalog.plans.find((plan) => plan.id.toLowerCase() === row.plan)?.name ?? "";
  const url = new URL(PLAN_PAGE, c.req.url).toString();
  if (failed && row.periodStart) {
    await c.var.sendEmail(await paymentFailedEmail({ t: c.var.t, to: owner.email, name: owner.name, planName, deadline: day(retryDeadline(row.periodStart)), url }));
  }
  if (canceled && row.periodEnd) {
    const losingAccess = await peopleLosingAccess(c.var.db, catalog, row.ownerId);
    await c.var.sendEmail(await subscriptionCanceledEmail({ t: c.var.t, to: owner.email, name: owner.name, planName, endsOn: day(row.periodEnd), losingAccess, url }));
  }
}
