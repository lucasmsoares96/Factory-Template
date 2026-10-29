import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { members, subscriptions } from "../../db/schema.ts";
import type { SkeletonEnv } from "../../platform/env.ts";
import { billingFor } from "./context.ts";
import type { Plan, PlanCatalog } from "./plans.ts";

export const LIVE_STATUSES = ["active", "trialing", "past_due"] as const;

/** The Plan a person is on: their live Subscription's, else the free Plan, else `null`. */
export async function planOf(db: SkeletonEnv["Variables"]["db"], catalog: PlanCatalog, userId: string) {
  const owned = await db.select().from(subscriptions).where(eq(subscriptions.referenceId, userId));
  const live = owned
    .filter((row) => (LIVE_STATUSES as readonly string[]).includes(row.status))
    .sort((a, b) => (b.periodStart?.getTime() ?? 0) - (a.periodStart?.getTime() ?? 0))[0];
  // The Subscription keeps the Plan's id lower-cased (the plugin lower-cases names).
  const subscribed = live && catalog.plans.find((plan) => plan.id.toLowerCase() === live.plan);
  const plan: Plan | null = subscribed ?? catalog.plans.find((candidate) => candidate.kind === "free") ?? null;
  return { plan, live };
}

/**
 * The value of an Entitlement for a Company: its value in the Plan of the
 * Company's Owner. A name no Plan sets is off in production and on in a Preview,
 * so that the Factory can show a new screen as Evidence.
 */
export async function entitlementFor(c: Context<SkeletonEnv>, entitlements: readonly string[], name: string): Promise<boolean | number> {
  const unset = c.env.PREVIEW_OUTBOX === "true";
  const billing = billingFor(c, entitlements);
  if (!billing) return unset;
  const catalog = await billing.plans();
  if (!catalog.granted.has(name)) return unset;
  const [owner] = await c.var.db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.companyId, c.var.member.companyId), eq(members.role, "owner")));
  if (!owner) return false;
  const { plan } = await planOf(c.var.db, catalog, owner.userId);
  return plan?.entitlements[name] ?? false;
}
