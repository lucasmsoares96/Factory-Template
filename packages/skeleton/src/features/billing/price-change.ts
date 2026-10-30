import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type Stripe from "stripe";
import { users } from "../../db/schema.ts";
import { priceChangeEmail } from "../../emails/price-change.tsx";
import type { SkeletonEnv } from "../../platform/env.ts";
import { buildLocale } from "../../platform/locale.ts";
import { PLAN_PAGE } from "./api.ts";
import type { Billing } from "./context.ts";

/** Set by `pnpm bootstrap billing <id> migrate-prices` on the schedules it makes. */
export const PRICE_CHANGE_MARK = "priceChange";

/**
 * `pnpm bootstrap billing <id> migrate-prices` moves a Subscription to a Plan's new price at its next renewal with a
 * Stripe subscription schedule: the current phase on the old price, the next on the new one. The update that sets those
 * phases (`subscription_schedule.updated` whose `previous_attributes` carry `phases`) is the one that tells the Owner,
 * once, in the app's language, with the old and the new price and the date. Any other event, or a schedule the bootstrap
 * did not make, is ignored. The send is awaited: when it fails, the webhook answers an error and Stripe delivers the event again.
 */
export async function sendPriceChange(c: Context<SkeletonEnv>, billing: Billing, event: Stripe.Event) {
  if (event.type !== "subscription_schedule.updated") return;
  const schedule = event.data.object;
  if (!event.data.previous_attributes || !("phases" in event.data.previous_attributes)) return;
  const userId = schedule.metadata?.userId;
  const [current, next] = schedule.phases;
  if (schedule.metadata?.[PRICE_CHANGE_MARK] !== "true" || !userId || !current || !next) return;
  const priceOf = (phase: Stripe.SubscriptionSchedule.Phase) => phase.items[0]?.price;
  const [oldId, newId] = [priceOf(current), priceOf(next)].map((price) => (typeof price === "string" ? price : price?.id));
  if (!oldId || !newId) return;
  const [user] = await c.var.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  if (!user) return;
  const [oldPrice, newPrice] = await Promise.all([billing.stripe.prices.retrieve(oldId), billing.stripe.prices.retrieve(newId)]);
  const money = (price: Stripe.Price) =>
    new Intl.NumberFormat(buildLocale, { style: "currency", currency: price.currency.toUpperCase() }).format((price.unit_amount ?? 0) / 10 ** (currencyDigits(price.currency)));
  const product = typeof newPrice.product === "string" ? newPrice.product : newPrice.product.id;
  const plan = (await billing.plans()).plans.find((candidate) => candidate.id === product);
  await c.var.sendEmail(
    await priceChangeEmail({
      t: c.var.t,
      to: user.email,
      name: user.name,
      planName: plan?.name ?? "",
      oldPrice: money(oldPrice),
      newPrice: money(newPrice),
      startsOn: new Intl.DateTimeFormat(buildLocale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(next.start_date * 1000)),
      url: new URL(PLAN_PAGE, c.req.url).toString(),
    }),
  );
}

function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2;
}
