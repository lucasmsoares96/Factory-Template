/**
 * The `rak_` permissions a restricted key needs for everything billing does: the Worker (customers, Checkout, Subscriptions,
 * the Plans it reads, the Customer Portal) and the bootstrap (products, prices, payment methods, the events endpoint).
 * Write includes Read.
 *
 * Checked against a real key made from the link in a Stripe sandbox on 2026-10-29. The dashboard silently ignores a wrong
 * name, so two were fixed from Stripe's own refusals (`rak_plan_write` for Prices, `rak_payment_method_configurations_write`,
 * plural). The Customer Portal permission is still pending: the link does not tick it, so it is not in this list and the
 * doctor tries a portal write instead (`PORTAL_WRITE_FALLBACK` names it only when Stripe's refusal does not).
 */
export const BILLING_PERMISSIONS = [
  "rak_product_write",
  "rak_plan_write",
  "rak_customer_write",
  "rak_checkout_session_write",
  "rak_subscription_write",
  "rak_webhook_write",
  "rak_payment_method_configurations_write",
] as const;

/** What the doctor reports when a portal write is refused and Stripe names no permission. Not confirmed. */
export const PORTAL_WRITE_FALLBACK = "rak_billing_portal_configuration_write";

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
