import { stripe } from "@better-auth/stripe";
import { defineFeature, type Feature } from "../../platform/feature.ts";
import { billingApi } from "./api.ts";
import { billingEnabled, billingFor } from "./context.ts";
import { sendTrialEnding } from "./trial-ending.ts";
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
          subscription: { enabled: true, requireEmailVerification: true, plans: async () =>
              (await on.plans()).priced.map(({ id, priceId, lookupKey, trialDays }) => ({
                name: id,
                ...(lookupKey ? { lookupKey } : { priceId }),
                // The plugin gives the trial to a person's first Subscription only (any past trial refuses it).
                ...(trialDays > 0 ? { freeTrial: { days: trialDays } } : {}),
              })),
          },
          onEvent: (event) => sendTrialEnding(c, on, event),
        }),
      ];
    },
    accountPage: { label: "billing.nav", to: "/account/plan" },
    enabled: billingEnabled,
  });
}
