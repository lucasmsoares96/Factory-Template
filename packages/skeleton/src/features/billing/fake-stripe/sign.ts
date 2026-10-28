/**
 * Stripe's webhook signature header for `payload`: `t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<payload>">`.
 * The fake signs with it and tests sign their own events with it; both only need Web Crypto.
 */
export async function stripeSignature(secret: string, payload: string, seconds = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${seconds}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${seconds},v1=${hex}`;
}
