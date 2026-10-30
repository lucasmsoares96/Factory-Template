import { z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { SkeletonEnv } from "../../platform/env.ts";
import { apiError, createRouter } from "../../platform/errors.ts";
import { billingFor, isFakeStripe } from "./context.ts";
import { FAKE_STRIPE_PATH, type FakeStripe } from "./fake-stripe/fake-stripe.ts";
import { checkoutPage, portalPage } from "./fake-stripe/pages.ts";
import { forgetPlans } from "./plans.ts";

const Advance = z.object({ seconds: z.number().int().positive(), paymentFails: z.boolean().optional() });
const Ending = z.object({ email: z.string().min(1) });
const Failing = z.object({ on: z.boolean() });
const Authenticate = z.object({ subscription: z.string().min(1), passes: z.boolean() });
const Cancel = z.object({ subscription: z.string().min(1) });
const Customer = z.object({ email: z.string().min(1) });
const OutsideSubscription = z.object({ customer: z.string().min(1), plan: z.string().min(1), quantity: z.number().int().positive(), trialDays: z.number().int().nonnegative() });
const Product = z.object({ id: z.string().min(1), metadata: z.record(z.string(), z.string()) });
const Event = z.object({ type: z.string().min(1), object: z.record(z.string(), z.unknown()), previousAttributes: z.record(z.string(), z.unknown()).optional() });

/**
 * The fake Stripe's own routes, `/api/fake-stripe/*`: the Checkout page and the
 * controls tests use (advance the clock, settle a change the bank asked to confirm, end a person's Subscriptions, fail a person's payment, edit a Plan's metadata, make Stripe fail, send an event, read
 * the calls, start over). They answer only where the fake runs (`STRIPE_FAKE`);
 * anywhere else they are a 404. Plain routes: no OpenAPI, no MCP.
 */
export function fakeStripeRoutes(entitlements: readonly string[]) {
  const router = createRouter();
  const fakeOnly = createMiddleware<SkeletonEnv>(async (c, next) => {
    if (!isFakeStripe(c.env)) return c.json(apiError("NOT_FOUND"), 404);
    await next();
  });
  router.use("/fake-stripe/*", fakeOnly);
  const fake = (c: Parameters<typeof billingFor>[0]) => billingFor(c, entitlements)!.fake!;

  router.get("/fake-stripe/checkout/:id", async (c) => {
    const details = await fake(c).checkoutDetails(c.req.param("id"));
    if (!details) return c.json(apiError("NOT_FOUND"), 404);
    return c.html(
      checkoutPage({
        sessionId: details.session.id,
        lines: details.lines as never,
        declined: c.req.query("declined") === "1",
        cancelUrl: details.session.cancel_url,
        base: FAKE_STRIPE_PATH,
      }),
    );
  });
  for (const outcome of ["pay", "decline"] as const) {
    router.post(`/fake-stripe/checkout/:id/${outcome}`, async (c) => {
      const result = await fake(c).completeCheckout(c.req.param("id"), outcome);
      if (!result) return c.json(apiError("NOT_FOUND"), 404);
      return c.redirect(result.next, 303);
    });
  }
  router.get("/fake-stripe/portal/:id", async (c) => {
    const details = await fake(c).portalDetails(c.req.param("id"));
    if (!details) return c.json(apiError("NOT_FOUND"), 404);
    return c.html(
      portalPage({
        sessionId: details.session.id,
        from: details.from as never,
        to: details.to as never,
        due: details.due,
        currency: details.currency,
        declined: c.req.query("declined") === "1",
        backUrl: details.session.return_url,
        base: FAKE_STRIPE_PATH,
      }),
    );
  });
  for (const outcome of ["pay", "authenticate", "decline"] as const) {
    router.post(`/fake-stripe/portal/:id/${outcome}`, async (c) => {
      const result = await fake(c).completePortal(c.req.param("id"), outcome);
      if (!result) return c.json(apiError("NOT_FOUND"), 404);
      return c.redirect(result.next, 303);
    });
  }
  router.post("/fake-stripe/control/authenticate", async (c) => {
    const body = Authenticate.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    if (!(await fake(c).authenticate(body.data.subscription, body.data.passes))) return c.json(apiError("NOT_FOUND"), 404);
    return c.json({ subscription: body.data.subscription, passes: body.data.passes });
  });
  router.post("/fake-stripe/control/advance", async (c) => {
    const body = Advance.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    await fake(c).advance(body.data.seconds, { paymentFails: body.data.paymentFails });
    return c.json({ now: await fake(c).now() });
  });
  router.post("/fake-stripe/control/end-subscriptions", async (c) => {
    const body = Ending.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    return c.json({ ended: await fake(c).endSubscriptions(body.data.email) });
  });
  router.post("/fake-stripe/control/fail-payment", async (c) => {
    const body = Ending.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    return c.json({ failed: await fake(c).failPayment(body.data.email) });
  });
  router.post("/fake-stripe/control/fail", async (c) => {
    const body = Failing.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    await fake(c).setFailing(body.data.on);
    return c.json({ failing: body.data.on });
  });
  router.post("/fake-stripe/control/events", async (c) => {
    const body = Event.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    return c.json({ webhookStatus: await fake(c).emit(body.data.type, body.data.object, body.data.previousAttributes) });
  });
  router.post("/fake-stripe/control/cancel", async (c) => {
    const body = Cancel.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    const updated = await fake(c).cancelAtPeriodEnd(body.data.subscription);
    if (!updated) return c.json(apiError("NOT_FOUND"), 404);
    return c.json({ subscription: body.data.subscription });
  });
  router.post("/fake-stripe/control/customers", async (c) => {
    const body = Customer.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    return c.json(await stripeCall(fake(c), "/v1/customers", { email: body.data.email, metadata: { productId: c.var.productId } }));
  });
  // What `pnpm bootstrap billing` does for an account that existed before billing: a Subscription through the API, no Checkout.
  router.post("/fake-stripe/control/outside-subscription", async (c) => {
    const body = OutsideSubscription.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    const { customer, plan, quantity, trialDays } = body.data;
    const catalog = await billingFor(c, entitlements)!.plans();
    const priced = catalog.priced.find((candidate) => candidate.id === plan);
    if (!priced) return c.json(apiError("NOT_FOUND"), 404);
    const subscription = await stripeCall(fake(c), "/v1/subscriptions", {
      customer,
      items: { 0: { price: priced.priceId, quantity } },
      ...(trialDays > 0 ? { trial_period_days: trialDays, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
      metadata: { productId: c.var.productId },
    });
    return c.json({ subscription: subscription.id });
  });
  router.get("/fake-stripe/control/subscriptions", async (c) => c.json({ subscriptions: await fake(c).subscriptions() }));
  router.post("/fake-stripe/control/products", async (c) => {
    const body = Product.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    if (!(await fake(c).patchProduct(body.data.id, body.data.metadata))) return c.json(apiError("NOT_FOUND"), 404);
    forgetPlans();
    return c.json({ updated: true });
  });
  router.get("/fake-stripe/control/events", async (c) => c.json({ events: await fake(c).events() }));
  router.get("/fake-stripe/control/requests", async (c) => c.json({ requests: await fake(c).requests() }));
  router.post("/fake-stripe/control/reset", async (c) => {
    await fake(c).reset();
    forgetPlans();
    return c.json({ reset: true });
  });
  return router;
}

/** A call to the fake's Stripe API, the way the Stripe SDK sends it (a form body). */
async function stripeCall(fake: FakeStripe, path: string, params: Record<string, unknown>) {
  const response = await fake.handle(new Request(`http://fake-stripe${path}`, { method: "POST", body: formBody(params) }));
  return (await response.json()) as { id: string };
}

/** Stripe's form encoding: `items[0][price]=...`. */
function formBody(params: Record<string, unknown>, prefix = ""): string {
  return Object.entries(params)
    .map(([key, value]) => {
      const name = prefix ? `${prefix}[${key}]` : key;
      return typeof value === "object" && value !== null ? formBody(value as Record<string, unknown>, name) : `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`;
    })
    .join("&");
}
