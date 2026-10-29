/**
 * The `rak_` permissions a restricted key needs for everything billing does: the Worker (customers, Checkout, Subscriptions,
 * the Plans it reads, the Customer Portal) and the bootstrap (products, prices, payment methods, the events endpoint).
 * Write includes Read.
 *
 * NOT YET CONFIRMED against a real key: the names come from the dashboard's pre-filled link format (not documented by
 * Stripe), and nobody has made a key in a sandbox from it yet. The doctor does not depend on them being right: Stripe's
 * refusal names the permission it wants, and that name is the one the doctor prints.
 */
export const BILLING_PERMISSIONS = [
  "rak_product_write",
  "rak_price_write",
  "rak_customer_write",
  "rak_checkout_session_write",
  "rak_subscription_write",
  "rak_billing_portal_configuration_write",
  "rak_webhook_write",
  "rak_payment_method_configuration_write",
] as const;

export type KeyMode = "sandbox" | "live";

/** The pre-filled "create restricted key" link (the format is not documented; PostHog and Swetrix use it). */
export function keyCreationUrl(name: string, mode: KeyMode): string {
  const base = mode === "sandbox" ? "https://dashboard.stripe.com/test/apikeys/create" : "https://dashboard.stripe.com/apikeys/create";
  return `${base}?name=${encodeURIComponent(name)}${BILLING_PERMISSIONS.map((permission) => `&permissions[]=${permission}`).join("")}`;
}

/** Which account a key belongs to, from its prefix (`rk_`/`sk_`, `test`/`live`), or undefined when it is not a Stripe key. */
export function keyMode(key: string): KeyMode | undefined {
  const match = /^(?:rk|sk)_(test|live)_[A-Za-z0-9]+$/.exec(key);
  return match ? (match[1] === "test" ? "sandbox" : "live") : undefined;
}
