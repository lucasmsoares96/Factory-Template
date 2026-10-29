import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { subscriptions } from "../../db/schema.ts";
import type { SkeletonEnv } from "../../platform/env.ts";
import { apiError, createRouter, errorResponse } from "../../platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";
import { billingFor, type Billing } from "./context.ts";
import { countSeats, seatPeople } from "../../platform/seats.ts";
import { LIVE_STATUSES as LIVE, planOf } from "./entitlements.ts";
import type { Plan } from "./plans.ts";

/** The SPA page a person returns to from Checkout. */
export const PLAN_PAGE = "/account/plan";

const PlanSchema = z
  .object({
    id: z.string().openapi({ description: "The Plan's id: what subscribePlan takes.", example: "prod_Rk2pQ9vT4mWs1a" }),
    name: z.string().openapi({ description: "The Plan's name, as set in Stripe.", example: "Pro" }),
    description: z.string().nullable().openapi({ description: "What the Plan offers, as set in Stripe.", example: "For small teams." }),
    kind: z.enum(["free", "fixed", "per_seat"]).openapi({
      description: "`free`: no price. `fixed`: one monthly price for a fixed number of Seats. `per_seat`: a monthly price for each Seat.",
      example: "fixed",
    }),
    seats: z.number().int().nullable().openapi({ description: "The Seats a `free` or `fixed` Plan gives; `null` when each Seat is paid for.", example: 3 }),
    price: z
      .object({
        amount: z.number().int().openapi({ description: "The monthly price in the currency's smallest unit (cents).", example: 1900 }),
        currency: z.string().openapi({ description: "The lower-case ISO currency code.", example: "usd" }),
        interval: z.literal("month").openapi({ description: "How often the price is charged." }),
      })
      .nullable()
      .openapi({ description: "The monthly price; `null` for the free Plan." }),
    trialDays: z
      .number()
      .int()
      .openapi({ description: "The days of free trial a person's first Subscription to this Plan gets; 0 when there is none. Only a `fixed` Plan has one, and a person has one trial ever.", example: 14 }),
    entitlements: z
      .record(z.string(), z.union([z.boolean(), z.number()]))
      .openapi({ description: "What the Plan unlocks, by the Product's Entitlement names: on or off, or up to a number.", example: { reports: true, projects: 10 } }),
  })
  .openapi("Plan");

const CurrentPlan = z
  .object({
    // A union, not `.nullable()`: that would turn the shared `Plan` schema itself into a nullable one.
    plan: z.union([PlanSchema, z.null()]),
    subscription: z
      .object({
        status: z.enum(["active", "trialing", "past_due"]).openapi({ description: "`past_due`: the last payment failed.", example: "active" }),
        periodEnd: z.iso.datetime().nullable().openapi({ description: "When the current period ends and the Subscription renews.", example: "2026-11-28T12:00:00.000Z" }),
        cancelAtPeriodEnd: z.boolean().openapi({ description: "Whether the Subscription ends when the current period does.", example: false }),
      })
      .nullable()
      .openapi({ description: "The person's Subscription; `null` when they are on the free Plan." }),
    plans: z.array(PlanSchema).openapi({ description: "Every Plan the Product sells, read from Stripe (kept for 5 minutes)." }),
  })
  .openapi("CurrentPlan");

const Checkout = z
  .object({ url: z.string().openapi({ description: "Where to send the person to pay: Stripe's Checkout page.", example: "https://checkout.stripe.com/c/pay/cs_test_a1" }) })
  .openapi("Checkout");

/** Answers 404 `NOT_FOUND` when the Worker has no Stripe key: no billing route answers then. */
const billingOn = (entitlements: readonly string[]): MiddlewareHandler<SkeletonEnv> =>
  createMiddleware<SkeletonEnv>(async (c, next) => {
    if (!billingFor(c, entitlements)) return c.json(apiError("NOT_FOUND"), 404);
    await next();
  });

const getPlanRoute = (on: MiddlewareHandler<SkeletonEnv>) =>
  createRoute({
    method: "get",
    path: "/billing/plan",
    operationId: "getPlan",
    summary: "Get the signed-in user's Plan",
    description:
      "Answers the Plan the user is on (`plan`; `null` only when Stripe has no free Plan to fall back to), their Subscription (`null` on the free Plan) and every Plan the Product sells. A person without a Subscription is on the free Plan. The Plans are read from Stripe and kept for 5 minutes. Answers 404 when billing is off.",
    middleware: [on, requireIdentity] as const,
    responses: {
      200: { description: "The user's Plan and the available Plans.", content: { "application/json": { schema: CurrentPlan } } },
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off: the Worker has no Stripe key.", "NOT_FOUND"),
      502: errorResponse("Stripe did not answer.", "BILLING_UNAVAILABLE"),
    },
  });

const subscribeRoute = (on: MiddlewareHandler<SkeletonEnv>) =>
  createRoute({
    method: "post",
    path: "/billing/subscribe",
    operationId: "subscribePlan",
    summary: "Subscribe to a fixed monthly Plan",
    description:
      "Opens Stripe's Checkout for a fixed monthly Plan and answers its URL; the SPA sends the user there. The Subscription changes when Stripe's event arrives, never by this call.",
    // Sends a person to a payment page: nothing an agent does for them.
    "x-mcp": false,
    middleware: [on, requireIdentity] as const,
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({ plan: z.string().min(1).openapi({ description: "The Plan's id, from getPlan.", example: "prod_Rk2pQ9vT4mWs1a" }) }).openapi("SubscribePlan"),
          },
        },
      },
    },
    responses: {
      200: { description: "Checkout is open.", content: { "application/json": { schema: Checkout } } },
      400: errorResponse("The request is invalid.", "VALIDATION_FAILED"),
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off, or the Product has no fixed monthly Plan with this id.", "NOT_FOUND"),
      409: errorResponse("The user already has a Subscription.", "ALREADY_SUBSCRIBED"),
      502: errorResponse("Stripe did not answer.", "BILLING_UNAVAILABLE"),
    },
  });

/** The `upgradeSubscription` endpoint `@better-auth/stripe` adds to the auth API (the plugins are not typed in `Auth`). */
type PluginApi = {
  upgradeSubscription(options: {
    headers: Headers;
    body: { plan: string; successUrl: string; cancelUrl: string; disableRedirect: boolean; metadata: Record<string, string> };
  }): Promise<{ url?: string }>;
};

async function readCatalog(billing: Billing) {
  try {
    return await billing.plans();
  } catch (error) {
    console.error("Reading the Plans from Stripe failed:", error);
    return undefined;
  }
}

/** The Seats the Plan gives: its number, 1 on the free Plan unless it says more, `null` when each Seat is paid for. */
export function seatsOf(plan: Plan | null): number | null {
  if (!plan) return 1;
  if (plan.kind === "per_seat") return null;
  return plan.seats ?? (plan.kind === "free" ? 1 : null);
}

const SeatsSchema = z
  .object({
    used: z.number().int().openapi({ description: "The Seats taken: each distinct person in the Companies the user owns, once.", example: 6 }),
    total: z.number().int().nullable().openapi({ description: "The Seats the Plan gives; `null` when there is no limit.", example: 15 }),
    companies: z.array(
      z.object({
        id: z.string().openapi({ description: "The Company's id.", example: "2f1c6a0e-8d1b-4a51-9f3e-6b0c1d2e3f40" }),
        name: z.string().openapi({ description: "Its name.", example: "Acme" }),
        people: z.array(
          z.object({
            name: z.string().nullable().openapi({ description: "Their name; `null` for an address that was only invited.", example: "Ana Souza" }),
            email: z.string().openapi({ description: "Their email.", example: "ana@example.com" }),
            status: z.enum(["owner", "member", "invited"]).openapi({ description: "`invited`: a pending Invitation.", example: "member" }),
          }),
        ),
      }),
    ).openapi({ description: "The people of each Company the user owns. A person in two of them appears in both and takes one Seat." }),
  })
  .openapi("Seats");

const getSeatsRoute = (on: MiddlewareHandler<SkeletonEnv>) =>
  createRoute({
    method: "get",
    path: "/billing/seats",
    operationId: "getSeats",
    summary: "Get the Seats the signed-in user uses",
    description:
      "Answers how many Seats the user's Plan gives (`total`; `null` when there is no limit), how many are taken (`used`) and the people of each Company the user owns. The Owner, each Member and each pending Invitation take a Seat, counted once per person across the user's Companies. A user who owns no Company uses 1. Answers 404 when billing is off.",
    middleware: [on, requireIdentity] as const,
    responses: {
      200: { description: "The user's Seats.", content: { "application/json": { schema: SeatsSchema } } },
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off: the Worker has no Stripe key.", "NOT_FOUND"),
      502: errorResponse("Stripe did not answer.", "BILLING_UNAVAILABLE"),
    },
  });

export function billingApi(entitlements: readonly string[]) {
  const on = billingOn(entitlements);
  return createRouter()
    .openapi(getPlanRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const catalog = await readCatalog(billing);
      if (!catalog) return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      const { plan, live } = await planOf(c.var.db, catalog, c.var.identity.user.id);
      return c.json(
        {
          plan,
          subscription: live
            ? {
                status: live.status as (typeof LIVE)[number],
                periodEnd: live.periodEnd?.toISOString() ?? null,
                cancelAtPeriodEnd: live.cancelAtPeriodEnd ?? false,
              }
            : null,
          plans: catalog.plans satisfies Plan[],
        },
        200,
      );
    })
    .openapi(getSeatsRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const catalog = await readCatalog(billing);
      if (!catalog) return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      const { user } = c.var.identity;
      const { plan } = await planOf(c.var.db, catalog, user.id);
      const people = await seatPeople(c.var.db, user.id);
      const companies = new Map<string, { id: string; name: string; people: { name: string | null; email: string; status: "owner" | "member" | "invited" }[] }>();
      for (const person of people) {
        const company = companies.get(person.companyId) ?? { id: person.companyId, name: person.companyName, people: [] };
        company.people.push({ name: person.name, email: person.email, status: person.status });
        companies.set(person.companyId, company);
      }
      // Whoever owns nothing still holds the one Seat of their own account.
      return c.json({ used: Math.max(countSeats(people), 1), total: seatsOf(plan), companies: [...companies.values()] }, 200);
    })
    .openapi(subscribeRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const { plan: planId } = c.req.valid("json");
      const catalog = await readCatalog(billing);
      if (!catalog) return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      const plan = catalog.priced.find((candidate) => candidate.id === planId && candidate.kind === "fixed");
      if (!plan) return c.json(apiError("NOT_FOUND"), 404);
      const owned = await c.var.db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.referenceId, c.var.identity.user.id));
      if (owned.some((row) => (LIVE as readonly string[]).includes(row.status))) return c.json(apiError("ALREADY_SUBSCRIBED"), 409);
      try {
        const api = c.var.auth().api as unknown as PluginApi;
        const session = await api.upgradeSubscription({
          headers: c.req.raw.headers,
          // Every customer and Subscription Stripe creates here carries the Product's id.
          body: { plan: plan.id, successUrl: PLAN_PAGE, cancelUrl: PLAN_PAGE, disableRedirect: true, metadata: { productId: billing.productId } },
        });
        if (session.url) return c.json({ url: session.url }, 200);
      } catch (error) {
        console.error("Opening Checkout failed:", error);
      }
      return c.json(apiError("BILLING_UNAVAILABLE"), 502);
    });
}
