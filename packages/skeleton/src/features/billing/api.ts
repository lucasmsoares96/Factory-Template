import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { subscriptions, users } from "../../db/schema.ts";
import type { SkeletonEnv } from "../../platform/env.ts";
import { apiError, createRouter, errorResponse } from "../../platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";
import { billingFor, type Billing } from "./context.ts";
import { countLosingAccess, countSeats, seatPeople } from "../../platform/seats.ts";
import { LIVE_STATUSES as LIVE, planOf } from "./entitlements.ts";
import { decideChange, hasInterval, seatsToBuy, standingOf, type Interval } from "./plan-change.ts";
import type { Plan, PlanCatalog } from "./plans.ts";
import { peopleLosingAccess } from "./cancellation.ts";
import { retryDeadline } from "./grace.ts";

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
    yearlyPrice: z
      .object({
        amount: z.number().int().openapi({ description: "The yearly price in the currency's smallest unit (cents). For a Plan priced per Seat it is per Seat.", example: 19000 }),
        currency: z.string().openapi({ description: "The lower-case ISO currency code.", example: "usd" }),
        interval: z.literal("year").openapi({ description: "How often the price is charged." }),
      })
      .nullable()
      .openapi({ description: "The yearly price; `null` when the Plan is not sold by the year." }),
    minSeats: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "The fewest Seats a `per_seat` Plan sells: one more than the biggest fixed Plan gives. `null` for the other kinds.", example: 11 }),
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
        interval: z.enum(["month", "year"]).openapi({ description: "How often the person pays.", example: "month" }),
        seats: z.number().int().nullable().openapi({ description: "The Seats bought, for a Plan priced per Seat; `null` for the others.", example: 12 }),
        scheduledChange: z
          .object({
            plan: z.string().openapi({ description: "The id of the Plan the Subscription moves to.", example: "prod_Rk2pQ9vT4mWs1a" }),
            interval: z.enum(["month", "year"]).openapi({ description: "How often the person pays after the change.", example: "month" }),
            seats: z.number().int().nullable().openapi({ description: "The Seats bought after the change, for a Plan priced per Seat.", example: 12 }),
            at: z.iso.datetime().nullable().openapi({ description: "When the change applies: the end of the paid period.", example: "2026-11-28T12:00:00.000Z" }),
          })
          .nullable()
          .openapi({ description: "A change the person scheduled for the end of the paid period; `null` when there is none." }),
        pastDueUntil: z.iso
          .datetime()
          .nullable()
          .openapi({ description: "While `past_due`: the last day to update the card before Stripe gives up and the person goes back to the free Plan; `null` otherwise.", example: "2026-11-05T12:00:00.000Z" }),
        losingAccess: z
          .number()
          .int()
          .openapi({ description: "How many people lose access to the user's Companies when the paid Plan ends: the Seats taken beyond the free Plan's.", example: 4 }),
      })
      .nullable()
      .openapi({ description: "The person's Subscription; `null` when they are on the free Plan." }),
    plans: z.array(PlanSchema).openapi({ description: "Every Plan the Product sells, read from Stripe (kept for 5 minutes)." }),
  })
  .openapi("CurrentPlan");

const Portal = z
  .object({ url: z.string().openapi({ description: "Where to send the person to manage the card and see invoices: Stripe's Customer Portal.", example: "https://billing.stripe.com/p/session/test_a1" }) })
  .openapi("Portal");

const Canceled = z
  .object({
    endsAt: z.iso.datetime().nullable().openapi({ description: "The last day of the paid period: the Plan stays until then and is not renewed.", example: "2026-11-28T12:00:00.000Z" }),
    losingAccess: z.number().int().openapi({ description: "How many people lose access to the user's Companies on that day.", example: 4 }),
  })
  .openapi("Canceled");

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
    summary: "Subscribe to a Plan",
    description:
      "Opens Stripe's Checkout for a fixed Plan, or for a Plan priced per Seat with the Seats chosen (at least its `minSeats`), monthly or yearly, and answers its URL; the SPA sends the user there. The Subscription changes when Stripe's event arrives, never by this call.",
    // Sends a person to a payment page: nothing an agent does for them.
    "x-mcp": false,
    middleware: [on, requireIdentity] as const,
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                plan: z.string().min(1).openapi({ description: "The Plan's id, from getPlan.", example: "prod_Rk2pQ9vT4mWs1a" }),
                interval: z.enum(["month", "year"]).default("month").openapi({ description: "How often to pay. The Plan needs a price for it.", example: "month" }),
                seats: z.number().int().min(1).optional().openapi({ description: "The Seats to buy, for a Plan priced per Seat (default: its minimum). Ignored for a fixed Plan.", example: 12 }),
              })
              .openapi("SubscribePlan"),
          },
        },
      },
    },
    responses: {
      200: { description: "Checkout is open.", content: { "application/json": { schema: Checkout } } },
      400: errorResponse("The request is invalid, the Plan has no price at this interval, or the Seats are below the Plan's minimum.", "VALIDATION_FAILED", "SEATS_BELOW_MINIMUM"),
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off, or the Product has no paid Plan with this id.", "NOT_FOUND"),
      409: errorResponse("The user already has a Subscription.", "ALREADY_SUBSCRIBED"),
      502: errorResponse("Stripe did not answer.", "BILLING_UNAVAILABLE"),
    },
  });

const ChangeBody = z
  .object({
    plan: z.string().min(1).openapi({ description: "The id of the Plan to move to, from getPlan. It may be the current one.", example: "prod_Rk2pQ9vT4mWs1a" }),
    interval: z.enum(["month", "year"]).optional().openapi({ description: "How often to pay after the change (default: as now). The Plan needs a price for it.", example: "year" }),
    seats: z.number().int().min(1).optional().openapi({ description: "The Seats to buy, for a Plan priced per Seat (default: the ones bought now, else its minimum).", example: 12 }),
  })
  .openapi("PlanChangeRequest");

const PlanChange = z
  .object({
    timing: z.enum(["now", "period_end"]).openapi({
      description: "`now`: a rise, which applies as soon as the payment is confirmed. `period_end`: a drop (or a mix), which applies when the paid period ends.",
      example: "now",
    }),
    effectiveAt: z.iso.datetime().nullable().openapi({ description: "When a `period_end` change applies; `null` for `now`.", example: "2026-11-28T12:00:00.000Z" }),
    seatsAfter: z.number().int().nullable().openapi({ description: "The Seats the person has once the change applies; `null` for no limit.", example: 3 }),
    used: z.number().int().openapi({ description: "The Seats taken today.", example: 6 }),
    peopleLosingAccess: z.number().int().openapi({ description: "How many people are suspended once the change applies and the Seats fall short (pending Invitations are canceled first).", example: 2 }),
  })
  .openapi("PlanChangePreview");

const PlanChangeDone = z
  .object({
    url: z.string().openapi({ description: "Where to send the person: Stripe's confirmation page for a `now` change (it shows the prorated amount), the Plan page for a `period_end` one.", example: "https://billing.stripe.com/p/session/test_a1" }),
    timing: z.enum(["now", "period_end"]).openapi({ description: "When the change applies; as in the preview.", example: "now" }),
    effectiveAt: z.iso.datetime().nullable().openapi({ description: "When a `period_end` change applies; `null` for `now`.", example: "2026-11-28T12:00:00.000Z" }),
  })
  .openapi("PlanChangeResult");

const previewChangeRoute = (on: MiddlewareHandler<SkeletonEnv>) =>
  createRoute({
    method: "post",
    path: "/billing/change/impact",
    operationId: "previewPlanChange",
    summary: "Preview a change of Plan",
    description:
      "Says when a change of Plan would apply and what it does to the Seats, without changing anything: a rise applies now, a drop at the end of the paid period (`effectiveAt`), with how many people would lose access then. A POST because the request is a body, not because it writes.",
    "x-mcp": false,
    middleware: [on, requireIdentity] as const,
    request: { body: { required: true, content: { "application/json": { schema: ChangeBody } } } },
    responses: {
      200: { description: "What the change would do.", content: { "application/json": { schema: PlanChange } } },
      400: errorResponse("The request is invalid, the Plan has no price at this interval, or the Seats are below the Plan's minimum.", "VALIDATION_FAILED", "SEATS_BELOW_MINIMUM"),
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off, or the Product has no paid Plan with this id.", "NOT_FOUND"),
      409: errorResponse("The user has no paid Subscription to change, or already has what they ask for.", "NOT_SUBSCRIBED", "ALREADY_ON_PLAN"),
      502: errorResponse("Stripe did not answer.", "BILLING_UNAVAILABLE"),
    },
  });

const changePlanRoute = (on: MiddlewareHandler<SkeletonEnv>) =>
  createRoute({
    method: "post",
    path: "/billing/change",
    operationId: "changePlan",
    summary: "Change the Plan, its interval or its Seats",
    description:
      "Moves a paying user to another Plan, interval (monthly or yearly) or number of Seats. A rise answers the URL of Stripe's confirmation page, which shows the prorated amount; the Seats rise only when Stripe's event says the payment was confirmed (a bank confirmation pending keeps them as they are). A drop is scheduled for the end of the paid period and the Seats fall then, when the suspension acts.",
    "x-mcp": false,
    middleware: [on, requireIdentity] as const,
    request: { body: { required: true, content: { "application/json": { schema: ChangeBody } } } },
    responses: {
      200: { description: "The change is under way.", content: { "application/json": { schema: PlanChangeDone } } },
      400: errorResponse("The request is invalid, the Plan has no price at this interval, or the Seats are below the Plan's minimum.", "VALIDATION_FAILED", "SEATS_BELOW_MINIMUM"),
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off, or the Product has no paid Plan with this id.", "NOT_FOUND"),
      409: errorResponse("The user has no paid Subscription to change, or already has what they ask for.", "NOT_SUBSCRIBED", "ALREADY_ON_PLAN"),
      502: errorResponse("Stripe did not answer.", "BILLING_UNAVAILABLE"),
    },
  });

const portalRoute = (on: MiddlewareHandler<SkeletonEnv>) =>
  createRoute({
    method: "post",
    path: "/billing/portal",
    operationId: "openBillingPortal",
    summary: "Open Stripe's Customer Portal",
    description:
      "Opens a session of Stripe's Customer Portal, with the Product's portal configuration (change the card, see invoices; changing the Plan is off there), and answers its URL; the SPA sends the user there. Answers 404 `NO_SUBSCRIPTION` when the user has never paid and so has no Stripe customer.",
    // Sends a person to a payment page: nothing an agent does for them.
    "x-mcp": false,
    middleware: [on, requireIdentity] as const,
    responses: {
      200: { description: "The portal session is open.", content: { "application/json": { schema: Portal } } },
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off, or the user has no Stripe customer.", "NOT_FOUND", "NO_SUBSCRIPTION"),
      502: errorResponse("Stripe did not answer, or the Product has no portal configuration.", "BILLING_UNAVAILABLE"),
    },
  });

const cancelRoute = (on: MiddlewareHandler<SkeletonEnv>) =>
  createRoute({
    method: "post",
    path: "/billing/cancel",
    operationId: "cancelSubscription",
    summary: "Cancel the Subscription at the end of the period",
    description:
      "Sets the user's Subscription to end when the paid period does, with no refund: the Plan and the Seats stay until then. Answers the last day and how many people lose access to the user's Companies on it. The Subscription changes when Stripe's event arrives, but the answer is already final.",
    // Ends a payment agreement: nothing an agent does for the person.
    "x-mcp": false,
    middleware: [on, requireIdentity] as const,
    responses: {
      200: { description: "The Subscription ends with the period.", content: { "application/json": { schema: Canceled } } },
      401: unauthenticatedResponse,
      404: errorResponse("Billing is off, or the user has no Subscription.", "NOT_FOUND", "NO_SUBSCRIPTION"),
      409: errorResponse("The Subscription is already set to end.", "ALREADY_CANCELED"),
      502: errorResponse("Stripe did not answer.", "BILLING_UNAVAILABLE"),
    },
  });

/** The `upgradeSubscription` endpoint `@better-auth/stripe` adds to the auth API (the plugins are not typed in `Auth`). */
type PluginApi = {
  upgradeSubscription(options: {
    headers: Headers;
    body: {
      plan: string;
      annual?: boolean;
      seats?: number;
      subscriptionId?: string;
      scheduleAtPeriodEnd?: boolean;
      successUrl: string;
      cancelUrl: string;
      returnUrl?: string;
      disableRedirect: boolean;
      metadata: Record<string, string>;
    };
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

/**
 * The Seats the Plan gives: its number, 1 on the free Plan unless it says more; on a Plan priced per Seat the ones the
 * Subscription bought (`null` when it does not say).
 */
export function seatsOf(plan: Plan | null, live?: { seats: number | null }): number | null {
  if (!plan) return 1;
  if (plan.kind === "per_seat") return live?.seats ?? null;
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


/**
 * The change the person scheduled for the end of the paid period, read from the Subscription's schedule in Stripe: its
 * second phase. `null` when there is none, or when Stripe does not answer (the page then shows no schedule).
 */
async function scheduledChangeOf(billing: Billing, catalog: PlanCatalog, live: { stripeScheduleId: string | null; periodEnd: Date | null }) {
  if (!live.stripeScheduleId) return null;
  try {
    const schedule = await billing.stripe.subscriptionSchedules.retrieve(live.stripeScheduleId);
    if (schedule.status !== "active") return null;
    const item = schedule.phases[1]?.items[0];
    if (!item) return null;
    const priceId = typeof item.price === "string" ? item.price : item.price.id;
    const plan = catalog.priced.find((candidate) => candidate.priceId === priceId || candidate.yearly?.priceId === priceId);
    if (!plan) return null;
    return {
      plan: plan.id,
      interval: plan.yearly?.priceId === priceId ? ("year" as const) : ("month" as const),
      seats: plan.kind === "per_seat" ? (item.quantity ?? null) : null,
      at: live.periodEnd?.toISOString() ?? null,
    };
  } catch (error) {
    console.error("Reading the scheduled change from Stripe failed:", error);
    return null;
  }
}

type Resolved = Awaited<ReturnType<typeof planOf>>;

/** The Subscription row's Stripe id, the live one the plugin changes. */
const stripeIdOf = (live: NonNullable<Resolved["live"]>) => live.stripeSubscriptionId ?? undefined;

/** A change as the routes answer it: the codes of `Change` on their status. */
function changeFailure(c: Context<SkeletonEnv>, error: "NOT_FOUND" | "VALIDATION_FAILED" | "ALREADY_ON_PLAN" | "SEATS_BELOW_MINIMUM" | "NOT_SUBSCRIBED") {
  if (error === "NOT_FOUND") return c.json(apiError("NOT_FOUND"), 404);
  if (error === "ALREADY_ON_PLAN" || error === "NOT_SUBSCRIBED") return c.json(apiError(error), 409);
  return c.json(apiError(error), 400);
}

/** The steps both change routes share: the Plans, the person's Plan and the decision. */
async function decide(c: Context<SkeletonEnv>, billing: Billing, request: { plan: string; interval?: Interval; seats?: number }) {
  const catalog = await readCatalog(billing);
  if (!catalog) return { failure: c.json(apiError("BILLING_UNAVAILABLE"), 502) };
  const { plan, live } = await planOf(c.var.db, catalog, c.var.identity.user.id);
  const standing = standingOf(plan, live);
  if (!standing || !live) return { failure: changeFailure(c, "NOT_SUBSCRIBED") };
  const change = decideChange(catalog, standing, request);
  if (change.error) return { failure: changeFailure(c, change.error) };
  return { change, live };
}

export function billingApi(entitlements: readonly string[]) {
  const on = billingOn(entitlements);
  return createRouter()
    .openapi(getPlanRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const catalog = await readCatalog(billing);
      if (!catalog) return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      const { plan, live } = await planOf(c.var.db, catalog, c.var.identity.user.id);
      const losingAccess = live ? await peopleLosingAccess(c.var.db, catalog, c.var.identity.user.id) : 0;
      return c.json(
        {
          plan,
          subscription: live
            ? {
                status: live.status as (typeof LIVE)[number],
                periodEnd: live.periodEnd?.toISOString() ?? null,
                cancelAtPeriodEnd: live.cancelAtPeriodEnd ?? false,
                interval: live.billingInterval === "year" ? ("year" as const) : ("month" as const),
                seats: plan?.kind === "per_seat" ? live.seats : null,
                scheduledChange: await scheduledChangeOf(billing, catalog, live),
                pastDueUntil: live.status === "past_due" && live.periodStart ? retryDeadline(live.periodStart).toISOString() : null,
                losingAccess,
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
      const { plan, live } = await planOf(c.var.db, catalog, user.id);
      const people = await seatPeople(c.var.db, user.id);
      const companies = new Map<string, { id: string; name: string; people: { name: string | null; email: string; status: "owner" | "member" | "invited" }[] }>();
      for (const person of people) {
        const company = companies.get(person.companyId) ?? { id: person.companyId, name: person.companyName, people: [] };
        company.people.push({ name: person.name, email: person.email, status: person.status });
        companies.set(person.companyId, company);
      }
      // Whoever owns nothing still holds the one Seat of their own account.
      return c.json({ used: Math.max(countSeats(people), 1), total: seatsOf(plan, live), companies: [...companies.values()] }, 200);
    })
    .openapi(portalRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const { user } = c.var.identity;
      const [row] = await c.var.db.select({ customer: users.stripeCustomerId }).from(users).where(eq(users.id, user.id));
      if (!row?.customer) return c.json(apiError("NO_SUBSCRIPTION"), 404);
      try {
        // The Product's own configuration: the one `pnpm bootstrap` tagged with its id.
        let configuration: string | undefined;
        for await (const candidate of billing.stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
          if (candidate.metadata?.productId === billing.productId) {
            configuration = candidate.id;
            break;
          }
        }
        if (!configuration) {
          console.error(`Stripe has no Customer Portal configuration tagged with the Product "${billing.productId}".`);
          return c.json(apiError("BILLING_UNAVAILABLE"), 502);
        }
        const session = await billing.stripe.billingPortal.sessions.create({
          customer: row.customer,
          configuration,
          return_url: new URL(PLAN_PAGE, c.req.url).toString(),
        });
        return c.json({ url: session.url }, 200);
      } catch (error) {
        console.error("Opening the Customer Portal failed:", error);
        return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      }
    })
    .openapi(cancelRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const { user } = c.var.identity;
      const owned = await c.var.db.select().from(subscriptions).where(eq(subscriptions.referenceId, user.id));
      const live = owned.find((row) => (LIVE as readonly string[]).includes(row.status));
      if (!live?.stripeSubscriptionId) return c.json(apiError("NO_SUBSCRIPTION"), 404);
      if (live.cancelAtPeriodEnd) return c.json(apiError("ALREADY_CANCELED"), 409);
      const catalog = await readCatalog(billing);
      if (!catalog) return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      const losingAccess = await peopleLosingAccess(c.var.db, catalog, user.id);
      try {
        await billing.stripe.subscriptions.update(live.stripeSubscriptionId, { cancel_at_period_end: true });
      } catch (error) {
        console.error("Canceling the Subscription failed:", error);
        return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      }
      // Stripe's event says the same; writing it now keeps the page right if the event is late.
      await c.var.db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.id, live.id));
      return c.json({ endsAt: live.periodEnd?.toISOString() ?? null, losingAccess }, 200);
    })
    .openapi(subscribeRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const { plan: planId, interval, seats: requested } = c.req.valid("json");
      const catalog = await readCatalog(billing);
      if (!catalog) return c.json(apiError("BILLING_UNAVAILABLE"), 502);
      const plan = catalog.priced.find((candidate) => candidate.id === planId);
      if (!plan) return c.json(apiError("NOT_FOUND"), 404);
      if (!hasInterval(plan, interval)) return c.json(apiError("VALIDATION_FAILED"), 400);
      const bought = seatsToBuy(plan, requested, null);
      if ("error" in bought) return c.json(apiError(bought.error), 400);
      const owned = await c.var.db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.referenceId, c.var.identity.user.id));
      if (owned.some((row) => (LIVE as readonly string[]).includes(row.status))) return c.json(apiError("ALREADY_SUBSCRIBED"), 409);
      try {
        const api = c.var.auth().api as unknown as PluginApi;
        const session = await api.upgradeSubscription({
          headers: c.req.raw.headers,
          // Every customer and Subscription Stripe creates here carries the Product's id.
          body: {
            plan: plan.id,
            annual: interval === "year",
            ...(bought.seats !== null ? { seats: bought.seats } : {}),
            successUrl: PLAN_PAGE,
            cancelUrl: PLAN_PAGE,
            disableRedirect: true,
            metadata: { productId: billing.productId },
          },
        });
        if (session.url) return c.json({ url: session.url }, 200);
      } catch (error) {
        console.error("Opening Checkout failed:", error);
      }
      return c.json(apiError("BILLING_UNAVAILABLE"), 502);
    })
    .openapi(previewChangeRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const decided = await decide(c, billing, c.req.valid("json"));
      if (decided.failure) return decided.failure;
      const { change, live } = decided;
      const people = await seatPeople(c.var.db, c.var.identity.user.id);
      return c.json(
        {
          timing: change.timing,
          effectiveAt: change.timing === "period_end" ? (live.periodEnd?.toISOString() ?? null) : null,
          seatsAfter: change.seatsAfter,
          used: Math.max(countSeats(people), 1),
          // A rise never takes Seats away; only what a drop leaves short is counted.
          peopleLosingAccess: change.timing === "period_end" ? countLosingAccess(people, change.seatsAfter) : 0,
        },
        200,
      );
    })
    .openapi(changePlanRoute(on), async (c) => {
      const billing = billingFor(c, entitlements)!;
      const decided = await decide(c, billing, c.req.valid("json"));
      if (decided.failure) return decided.failure;
      const { change, live } = decided;
      try {
        const api = c.var.auth().api as unknown as PluginApi;
        const session = await api.upgradeSubscription({
          headers: c.req.raw.headers,
          body: {
            plan: change.target.id,
            annual: change.interval === "year",
            ...(change.seats !== null ? { seats: change.seats } : {}),
            subscriptionId: stripeIdOf(live),
            scheduleAtPeriodEnd: change.timing === "period_end",
            successUrl: PLAN_PAGE,
            cancelUrl: PLAN_PAGE,
            returnUrl: PLAN_PAGE,
            disableRedirect: true,
            metadata: { productId: billing.productId },
          },
        });
        if (session.url) {
          return c.json({ url: session.url, timing: change.timing, effectiveAt: change.timing === "period_end" ? (live.periodEnd?.toISOString() ?? null) : null }, 200);
        }
      } catch (error) {
        console.error("Changing the Plan failed:", error);
      }
      return c.json(apiError("BILLING_UNAVAILABLE"), 502);
    });
}
