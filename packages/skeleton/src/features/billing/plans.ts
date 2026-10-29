import type Stripe from "stripe";

/**
 * A Plan as Stripe holds it: one product per Plan, its metadata saying what kind
 * it is (`kind`: `free`, `fixed` or `per_seat`), how many Seats a fixed or free
 * one gives (`seats`), the Product it belongs to (`productId`), the free trial of a
 * fixed one (`trial_days`) and what it unlocks (`entitlement_<name>`: `true`, `false` or a number). A paid Plan has
 * an active monthly price, found by its lookup key.
 */
export type Plan = {
  /** The Stripe product's id: what `subscribe` takes. */
  id: string;
  name: string;
  description: string | null;
  kind: "free" | "fixed" | "per_seat";
  /** The Seats a `free` or `fixed` Plan gives; `null` when each Seat is paid for. */
  seats: number | null;
  /** The monthly price, in the currency's smallest unit; `null` for the free Plan. */
  price: { amount: number; currency: string; interval: "month" } | null;
  entitlements: Record<string, boolean | number>;
  /** The days of free trial a first Subscription gets; 0 for no trial. Only a `fixed` Plan has one. */
  trialDays: number;
};

/** A Plan with the Stripe price that Checkout charges. */
export type StripePlan = Plan & { priceId: string; lookupKey: string | null };

/** `granted`: the Entitlement names some Plan's metadata sets; one in no Plan is unset (see `entitlementFor`). */
export type PlanCatalog = { plans: Plan[]; priced: StripePlan[]; granted: ReadonlySet<string> };

const KINDS = ["free", "fixed", "per_seat"] as const;

function entitlementValue(raw: string | undefined): boolean | number {
  if (raw === undefined || raw === "false") return false;
  if (raw === "true") return true;
  const count = Number(raw);
  return Number.isFinite(count) ? count : false;
}

function trialDaysOf(kind: Plan["kind"], raw: string | undefined): number {
  const days = Number(raw);
  return kind === "fixed" && Number.isInteger(days) && days > 0 ? days : 0;
}

/**
 * Reads the Product's Plans from Stripe: the active products tagged with its id
 * and a known `kind`, each with its monthly price. A product that is not a Plan
 * of this Product, or a paid one without a monthly price, is left out.
 */
export async function readPlans(
  stripe: Stripe,
  { productId, entitlements }: { productId: string; entitlements: readonly string[] },
): Promise<PlanCatalog> {
  const [products, prices] = await Promise.all([
    stripe.products.list({ active: true, limit: 100 }),
    stripe.prices.list({ active: true, limit: 100 }),
  ]);
  const plans: Plan[] = [];
  const priced: StripePlan[] = [];
  const granted = new Set<string>();
  for (const product of products.data) {
    const { productId: owner, kind, seats } = product.metadata;
    const known = KINDS.find((candidate) => candidate === kind);
    if (owner !== productId || !known) continue;
    const price = prices.data.find((candidate) => {
      const target = typeof candidate.product === "string" ? candidate.product : candidate.product.id;
      return target === product.id && candidate.recurring?.interval === "month" && candidate.unit_amount !== null;
    });
    if (known !== "free" && !price) continue;
    const plan: Plan = {
      id: product.id,
      name: product.name,
      description: product.description,
      kind: known,
      seats: known === "per_seat" || seats === undefined || !Number.isFinite(Number(seats)) ? null : Number(seats),
      price: price && known !== "free" ? { amount: price.unit_amount!, currency: price.currency, interval: "month" } : null,
      trialDays: trialDaysOf(known, product.metadata.trial_days),
      entitlements: Object.fromEntries(entitlements.map((name) => [name, entitlementValue(product.metadata[`entitlement_${name}`])])),
    };
    for (const name of entitlements) if (`entitlement_${name}` in product.metadata) granted.add(name);
    plans.push(plan);
    if (price && known !== "free") priced.push({ ...plan, priceId: price.id, lookupKey: price.lookup_key });
  }
  return { plans, priced, granted };
}

/** How long a reading of Stripe's Plans is kept. */
export const PLANS_TTL_MS = 5 * 60 * 1000;

const readings = new Map<string, { at: number; catalog: PlanCatalog }>();

/**
 * The Plans, read from Stripe at most once every 5 minutes per Worker isolate.
 * Only the finished reading is kept: a promise made in one request cannot be
 * awaited from another on Workers. A failed read is not kept.
 */
export async function cachedPlans(key: string, read: () => Promise<PlanCatalog>, now = Date.now()): Promise<PlanCatalog> {
  const kept = readings.get(key);
  if (kept && now - kept.at < PLANS_TTL_MS) return kept.catalog;
  const catalog = await read();
  readings.set(key, { at: now, catalog });
  return catalog;
}

/** Forgets every reading: the next call reads Stripe again. */
export function forgetPlans() {
  readings.clear();
}
