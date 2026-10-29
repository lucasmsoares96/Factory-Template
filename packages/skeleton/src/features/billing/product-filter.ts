import type { BetterAuthPlugin } from "better-auth";
import type Stripe from "stripe";
import { AUTH_BASE_PATH } from "../../platform/auth-base-path.ts";

/**
 * Several Products can share one Stripe account, and Stripe sends every event
 * to every endpoint. Every customer and Subscription billing creates carries the
 * Product's id in its metadata (`productId`); this plugin answers 200 and does
 * nothing for a verified event whose object names another Product. An event
 * with a bad signature, or one that names no Product, passes through to the
 * Stripe plugin, which refuses the first and finds nobody for the second.
 */
export function productFilter({ productId, stripe, webhookSecret }: { productId: string; stripe: Stripe; webhookSecret: string }) {
  return {
    id: "billing-product-filter",
    async onRequest(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== `${AUTH_BASE_PATH}/stripe/webhook`) return;
      const signature = request.headers.get("stripe-signature");
      if (!signature || !webhookSecret) return;
      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(await request.clone().text(), signature, webhookSecret);
      } catch {
        return;
      }
      const owner = (event.data.object as { metadata?: Record<string, string> | null }).metadata?.productId;
      if (owner !== undefined && owner !== productId) return { response: Response.json({ success: true, ignored: true }) };
    },
  } satisfies BetterAuthPlugin;
}
