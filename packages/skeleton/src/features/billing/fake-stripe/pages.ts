const escape = (text: unknown) =>
  String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

type Line = {
  product: { name: string; description?: string | null };
  price: { unit_amount: number; currency: string; recurring: { interval: string } };
  quantity: number;
};

/**
 * The fake Checkout page: what Stripe's hosted page does for the person, with
 * a button that pays and one that declines the card. Plain HTML, English only:
 * it exists in `pnpm dev` and the tests, never in production.
 */
export function checkoutPage({ sessionId, lines, declined, cancelUrl, base }: { sessionId: string; lines: Line[]; declined: boolean; cancelUrl: string; base: string }) {
  const items = lines
    .map(
      (line) =>
        `<li data-testid="fake-checkout-line"><strong>${escape(line.product.name)}</strong> — ${(line.price.unit_amount / 100).toFixed(2)} ${escape(line.price.currency.toUpperCase())} / ${escape(line.price.recurring.interval)}</li>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fake Stripe Checkout</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}button,a.button{font:inherit;padding:.5rem 1rem;margin-right:.5rem;border:1px solid #888;border-radius:.375rem;background:#fff;cursor:pointer;text-decoration:none;color:inherit}.error{color:#b00020}</style></head>
<body>
<p><small>Local fake of Stripe Checkout. No card is charged.</small></p>
<h1>Subscribe</h1>
<ul>${items}</ul>
${declined ? `<p role="alert" class="error" data-testid="fake-checkout-declined">Your card was declined.</p>` : ""}
<form method="post" action="${escape(base)}/checkout/${escape(sessionId)}/pay" style="display:inline"><button type="submit" data-testid="fake-checkout-pay">Pay</button></form>
<form method="post" action="${escape(base)}/checkout/${escape(sessionId)}/decline" style="display:inline"><button type="submit" data-testid="fake-checkout-decline">Decline the card</button></form>
<a class="button" href="${escape(cancelUrl)}" data-testid="fake-checkout-back">Back</a>
</body></html>`;
}

type Side = { name: string; price: { unit_amount: number; currency: string; recurring: { interval: string } }; quantity: number };

/**
 * The fake of Stripe's confirmation page for a change of Plan (the Billing Portal's `subscription_update_confirm`):
 * what the person has, what they change to and what is charged today, with a button that pays, one that makes the bank
 * ask for confirmation (3D Secure) and one that declines the card. English only, like the Checkout page.
 */
export function portalPage({ sessionId, from, to, due, currency, declined, backUrl, base }: { sessionId: string; from: Side; to: Side; due: number; currency: string; declined: boolean; backUrl: string; base: string }) {
  const side = (testid: string, line: Side) =>
    `<p data-testid="${testid}"><strong>${escape(line.name)}</strong> — ${line.quantity} × ${(line.price.unit_amount / 100).toFixed(2)} ${escape(line.price.currency.toUpperCase())} / ${escape(line.price.recurring.interval)}</p>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fake Stripe: confirm your plan change</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}button,a.button{font:inherit;padding:.5rem 1rem;margin-right:.5rem;border:1px solid #888;border-radius:.375rem;background:#fff;cursor:pointer;text-decoration:none;color:inherit}.error{color:#b00020}</style></head>
<body>
<p><small>Local fake of Stripe's plan change page. No card is charged.</small></p>
<h1>Confirm your plan change</h1>
${side("fake-portal-from", from)}
${side("fake-portal-to", to)}
<p data-testid="fake-portal-due">Due today: ${(due / 100).toFixed(2)} ${escape(currency.toUpperCase())}</p>
${declined ? `<p role="alert" class="error" data-testid="fake-portal-declined">Your card was declined.</p>` : ""}
<form method="post" action="${escape(base)}/portal/${escape(sessionId)}/pay" style="display:inline"><button type="submit" data-testid="fake-portal-pay">Confirm</button></form>
<form method="post" action="${escape(base)}/portal/${escape(sessionId)}/authenticate" style="display:inline"><button type="submit" data-testid="fake-portal-authenticate">Confirm (the bank asks for confirmation)</button></form>
<form method="post" action="${escape(base)}/portal/${escape(sessionId)}/decline" style="display:inline"><button type="submit" data-testid="fake-portal-decline">Decline the card</button></form>
<a class="button" href="${escape(backUrl)}" data-testid="fake-portal-back">Back</a>
</body></html>`;
}
