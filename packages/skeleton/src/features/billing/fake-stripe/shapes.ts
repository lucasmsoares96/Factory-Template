/**
 * The contract between the fake Stripe and the real one: the fields of a subscription event that billing reads, and their
 * types. Plain data with no import, so both sides read it: `test/billing.test.ts` holds the fake's events to it, and the
 * weekly contract test (`.factory/src/ci/stripe-contract.ts`) holds Stripe's own events to it. When Stripe changes a shape,
 * that test fails, and the fake is fixed together with these lines.
 */

/** A type name; `|null` also accepts null. `object` is any plain object (not an array). */
export type FieldType = "string" | "number" | "boolean" | "object" | "array" | "string|null" | "number|null" | "object|null";

export type Shape = Record<string, FieldType>;

/** Fields of the event itself. */
export const EVENT_SHAPE: Shape = { id: "string", object: "string", type: "string", created: "number", livemode: "boolean", pending_webhooks: "number", "data.object": "object" };

/** Fields of the Subscription inside `customer.subscription.created` and `customer.subscription.updated`. */
export const SUBSCRIPTION_SHAPE: Shape = {
  id: "string",
  object: "string",
  customer: "string",
  status: "string",
  metadata: "object",
  created: "number",
  cancel_at_period_end: "boolean",
  trial_end: "number|null",
  "items.data": "array",
  "items.data.0.id": "string",
  "items.data.0.quantity": "number",
  "items.data.0.current_period_start": "number",
  "items.data.0.current_period_end": "number",
  "items.data.0.price.id": "string",
  "items.data.0.price.lookup_key": "string|null",
  "items.data.0.price.product": "string",
};

/** The event types of a subscription's life that the contract covers: signing up, and renewing (an update). */
export const CONTRACT_EVENT_TYPES = ["customer.subscription.created", "customer.subscription.updated"] as const;

function read(value: unknown, path: string): unknown {
  let at = value as Record<string, unknown> | undefined;
  for (const part of path.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[part] as Record<string, unknown> | undefined;
  }
  return at;
}

function typeOf(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/** What differs from the shape, one line per field: `path: expected X, got Y`. Empty when the value conforms. */
export function shapeProblems(value: unknown, shape: Shape, prefix = ""): string[] {
  const problems: string[] = [];
  for (const [path, type] of Object.entries(shape)) {
    const found = read(value, path);
    const [base, nullable] = type.split("|") as [string, string | undefined];
    const got = typeOf(found);
    if (got === base || (nullable && got === "null")) continue;
    problems.push(`${prefix}${path}: expected ${type}, got ${got}`);
  }
  return problems;
}

/** An event of the contract against the envelope and the Subscription shapes. */
export function eventProblems(event: unknown): string[] {
  const type = (event as { type?: string } | undefined)?.type ?? "event";
  return [...shapeProblems(event, EVENT_SHAPE, `${type} `), ...shapeProblems((event as { data?: { object?: unknown } } | undefined)?.data?.object, SUBSCRIPTION_SHAPE, `${type} data.object.`)];
}
