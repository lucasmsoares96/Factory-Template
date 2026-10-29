import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type Stripe from "stripe";
import { users } from "../../db/schema.ts";
import { trialEndingEmail } from "../../emails/trial-ending.tsx";
import type { SkeletonEnv } from "../../platform/env.ts";
import { PLAN_PAGE } from "./api.ts";
import type { Billing } from "./context.ts";
import { buildLocale } from "../../platform/locale.ts";

/**
 * Stripe sends `customer.subscription.trial_will_end` three days before a trial
 * ends. The Owner (the person the Subscription belongs to, `userId` in its
 * metadata) gets an email in the app's language. An event that names no known
 * person is ignored. The send is awaited: when it fails, the webhook answers an
 * error and Stripe delivers the event again.
 */
export async function sendTrialEnding(c: Context<SkeletonEnv>, billing: Billing, event: Stripe.Event) {
  if (event.type !== "customer.subscription.trial_will_end") return;
  const subscription = event.data.object;
  const userId = subscription.metadata?.userId;
  if (!userId || !subscription.trial_end) return;
  const [user] = await c.var.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  if (!user) return;
  const productId = subscription.items.data[0]?.price.product;
  const catalog = await billing.plans();
  const plan = catalog.plans.find((candidate) => candidate.id === (typeof productId === "string" ? productId : productId?.id));
  const endsOn = new Intl.DateTimeFormat(buildLocale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(subscription.trial_end * 1000));
  await c.var.sendEmail(
    await trialEndingEmail({
      t: c.var.t,
      to: user.email,
      name: user.name,
      planName: plan?.name ?? "",
      endsOn,
      url: new URL(PLAN_PAGE, c.req.url).toString(),
    }),
  );
}
