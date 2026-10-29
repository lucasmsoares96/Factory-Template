import { stripe } from "@better-auth/stripe";
import { defineFeature, type Feature } from "../../platform/feature.ts";
import { billingApi } from "./api.ts";
import type { Context } from "hono";
import type { SkeletonEnv } from "../../platform/env.ts";
import { entitlementFor } from "./entitlements.ts";
import { billingEnabled, billingFor } from "./context.ts";
import { productFilter } from "./product-filter.ts";
import { fakeStripeRoutes } from "./routes.ts";

export { stripeSignature } from "./fake-stripe/sign.ts";
export type { Plan } from "./plans.ts";

export type BillingFeature<Name extends string> = Feature & {
  /** The value of an Entitlement for the Company of the request (`c.var.member`). */
  entitlement(c: Context<SkeletonEnv>, name: Name): Promise<boolean | number>;
};

/**
 * Billing: a person subscribes to one of the Product's Plans and Stripe is the
 * source of truth (ADR 0015). Runs `@better-auth/stripe` in its user mode, so the
 * Stripe customer is the person who pays. The Plans are Stripe products tagged
 * with the Product's id; `entitlements` names what the Product's code checks
 * (`entitlement_<name>` in a product's metadata says which Plans grant it).
 *
 * `entitlement(c, name)` answers an Entitlement's value for the Company of a
 * request behind `requireMember`: its value in the Owner's Plan, `true`/`false`
 * or a number. A name the Product did not declare is a type error. A name that
 * no Plan sets is off in production and on in a Preview. The Product decides
 * what to block and how to count.
 *
 * Billing is on only where the Worker has `STRIPE_SECRET_KEY`: without it the
 * account page links to no Plan page, no `/api/billing` route answers and the
 * Stripe plugin is not added. `pnpm dev` and the tests run on a fake Stripe.
 */
export function billing<const Name extends string>({ entitlements }: { entitlements: readonly Name[] }): BillingFeature<Name> {
  return {
    ...defineFeature({
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
    accountPage: { label: "billing.nav", to: "/account/plan" },
    enabled: billingEnabled,
    }),
    entitlement: (c, name) => entitlementFor(c, entitlements, name),
  };
}
