import { stripe } from "@better-auth/stripe";
import { defineFeature, type Feature } from "../../platform/feature.ts";
import { billingApi, planOf, seatsOf } from "./api.ts";
import { billingEnabled, billingFor } from "./context.ts";
import { productFilter } from "./product-filter.ts";
import { fakeStripeRoutes } from "./routes.ts";

export { stripeSignature } from "./fake-stripe/sign.ts";
export type { Plan } from "./plans.ts";

/**
 * Billing: a person subscribes to one of the Product's Plans and Stripe is the
 * source of truth (ADR 0015). Runs `@better-auth/stripe` in its user mode, so the
 * Stripe customer is the person who pays. The Plans are Stripe products tagged
 * with the Product's id; `entitlements` names what the Product's code checks
 * (`entitlement_<name>` in a product's metadata says which Plans grant it).
 *
 * Billing is on only where the Worker has `STRIPE_SECRET_KEY`: without it the
 * account page links to no Plan page, no `/api/billing` route answers and the
 * Stripe plugin is not added. `pnpm dev` and the tests run on a fake Stripe.
 */
export function billing({ entitlements }: { entitlements: readonly string[] }): Feature {
  return defineFeature({
    id: "billing",
    api(app) {
      app.route("/", billingApi(entitlements));
      app.route("/", fakeStripeRoutes(entitlements));
    },
    authPlugins(c) {
      const on = billingFor(c, entitlements);
      if (!on) return [];
      return [
        productFilter({ productId: on.productId, stripe: on.stripe, webhookSecret: on.webhookSecret }),
        stripe({
          stripeClient: on.stripe,
          stripeWebhookSecret: on.webhookSecret,
          subscription: { enabled: true, requireEmailVerification: true, plans: async () => (await on.plans()).priced.map(({ id, priceId, lookupKey }) => ({ name: id, ...(lookupKey ? { lookupKey } : { priceId }) })) },
        }),
      ];
    },
    async seatLimit(c, ownerId) {
      const on = billingFor(c, entitlements);
      if (!on) return undefined;
      try {
        return seatsOf((await planOf(c.var.db, await on.plans(), ownerId)).plan);
      } catch (error) {
        // Stripe is down: keep the Owner at the free Plan's one Seat rather than let the limit lapse.
        console.error("Reading the Plans from Stripe failed:", error);
        return 1;
      }
    },
    accountPage: { label: "billing.nav", to: "/account/plan" },
    enabled: billingEnabled,
  });
}
