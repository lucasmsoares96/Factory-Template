import { z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { SkeletonEnv } from "../../platform/env.ts";
import { apiError, createRouter } from "../../platform/errors.ts";
import { billingFor, isFakeStripe } from "./context.ts";
import { FAKE_STRIPE_PATH } from "./fake-stripe/fake-stripe.ts";
import { checkoutPage } from "./fake-stripe/pages.ts";
import { forgetPlans } from "./plans.ts";

const Advance = z.object({ seconds: z.number().int().positive(), paymentFails: z.boolean().optional() });
const Failing = z.object({ on: z.boolean() });
const Cancel = z.object({ subscription: z.string().min(1) });
const Product = z.object({ id: z.string().min(1), metadata: z.record(z.string(), z.string()) });
const Event = z.object({ type: z.string().min(1), object: z.record(z.string(), z.unknown()), previousAttributes: z.record(z.string(), z.unknown()).optional() });

/**
 * The fake Stripe's own routes, `/api/fake-stripe/*`: the Checkout page and the
 * controls tests use (advance the clock, edit a Plan's metadata, make Stripe fail, send an event, read
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
  router.post("/fake-stripe/control/advance", async (c) => {
    const body = Advance.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    await fake(c).advance(body.data.seconds, { paymentFails: body.data.paymentFails });
    return c.json({ now: await fake(c).now() });
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
  router.get("/fake-stripe/control/subscriptions", async (c) => c.json({ subscriptions: await fake(c).subscriptions() }));
  router.post("/fake-stripe/control/products", async (c) => {
    const body = Product.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("VALIDATION_FAILED"), 400);
    if (!(await fake(c).patchProduct(body.data.id, body.data.metadata))) return c.json(apiError("NOT_FOUND"), 404);
    forgetPlans();
    return c.json({ updated: true });
  });
  router.get("/fake-stripe/control/requests", async (c) => c.json({ requests: await fake(c).requests() }));
  router.post("/fake-stripe/control/reset", async (c) => {
    await fake(c).reset();
    forgetPlans();
    return c.json({ reset: true });
  });
  return router;
}
