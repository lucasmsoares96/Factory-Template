// The weekly contract test: `node .factory/src/ci/stripe-contract.ts`, with STRIPE_CI_KEY (the restricted key of the CI sandbox,
// the only place it is read) in the env. It runs against real Stripe, in a sandbox that only CI uses, to tell when the fake
// Stripe of the Skeleton stops imitating the real one:
//   1. deletes what an earlier run left (test clocks and products tagged `factory_contract`)
//   2. makes its own product and monthly price, a customer on a test clock, subscribes with a test card
//   3. advances the clock past the renewal and reads the subscription events through the API (events.list; no endpoint)
//   4. holds those events to the shapes in `fake-stripe/shapes.ts`, the ones the fake is held to in the Skeleton's tests
//   5. deletes the test clock (and with it the customer and the subscription), also when a step failed
// Exit 1 on a mismatch or an error; the workflow opens an issue then. With no key it says so and exits 0.

import Stripe from "stripe";
import { CONTRACT_EVENT_TYPES, eventProblems } from "../../../packages/skeleton/src/features/billing/fake-stripe/shapes.ts";

/** Marks everything this test makes, so the next run can find the leftovers. */
export const TAG = "factory_contract";
export const CLOCK_NAME_PREFIX = "factory-contract";
const DAY = 24 * 60 * 60;

/** The Stripe calls the test needs, so a test of the order of the steps needs no network. */
export interface ContractApi {
  /** Deletes every test clock and archives every product (and its prices) this test tagged before. */
  deleteLeftovers(): Promise<string[]>;
  createPrice(): Promise<{ productId: string; priceId: string }>;
  createClock(frozenTime: number): Promise<string>;
  /** A customer on the clock with a test card as the default payment method. */
  createCustomer(clockId: string): Promise<string>;
  subscribe(customerId: string, priceId: string): Promise<string>;
  /** Moves the clock and waits until Stripe has finished (and so has made the renewal). */
  advance(clockId: string, frozenTime: number): Promise<void>;
  /** The subscription events of the customer, oldest first, read through the API. */
  events(customerId: string, types: readonly string[]): Promise<unknown[]>;
  deleteClock(clockId: string): Promise<void>;
  archive(productId: string, priceId: string): Promise<void>;
}

export interface ContractResult {
  ok: boolean;
  problems: string[];
  /** What the run did, one line each (no secret in them). */
  log: string[];
}

export async function runContract(api: ContractApi, now: () => number = () => Math.floor(Date.now() / 1000)): Promise<ContractResult> {
  const log: string[] = [];
  const problems: string[] = [];
  let clock: string | undefined;
  let made: { productId: string; priceId: string } | undefined;
  try {
    const left = await api.deleteLeftovers();
    log.push(left.length > 0 ? `deleted leftovers: ${left.join(", ")}` : "no leftovers");
    made = await api.createPrice();
    const start = now();
    clock = await api.createClock(start);
    const customer = await api.createCustomer(clock);
    await api.subscribe(customer, made.priceId);
    log.push("subscribed a test customer with a test card");
    await api.advance(clock, start + 35 * DAY);
    log.push("advanced the test clock 35 days, past the first renewal");
    const events = await api.events(customer, CONTRACT_EVENT_TYPES);
    for (const type of CONTRACT_EVENT_TYPES) {
      const ofType = events.filter((event) => (event as { type?: string }).type === type);
      if (ofType.length === 0) problems.push(`no ${type} event for the test customer`);
      for (const event of ofType) problems.push(...eventProblems(event));
    }
    log.push(`checked ${events.length} event(s)`);
  } catch (error) {
    problems.push(`the run failed: ${(error as Error).message}`);
  } finally {
    // The clock goes first: it takes the customer and the subscription with it, which frees the price to be archived.
    for (const [what, undo] of [
      ["test clock", async () => clock && api.deleteClock(clock)],
      ["product and price", async () => made && api.archive(made.productId, made.priceId)],
    ] as const) {
      try {
        await undo();
      } catch (error) {
        problems.push(`could not delete the ${what}: ${(error as Error).message}`);
      }
    }
  }
  return { ok: problems.length === 0, problems, log };
}

/** The real thing: Stripe's Node SDK (v23, the one the harness pins) with the CI sandbox's key. */
export function stripeApi(key: string): ContractApi {
  const stripe = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "factory-contract-test" } });
  return {
    async deleteLeftovers() {
      const deleted: string[] = [];
      for await (const clock of stripe.testHelpers.testClocks.list({ limit: 100 })) {
        if (!clock.name?.startsWith(CLOCK_NAME_PREFIX)) continue;
        await stripe.testHelpers.testClocks.del(clock.id);
        deleted.push(clock.id);
      }
      for await (const product of stripe.products.list({ active: true, limit: 100 })) {
        if (product.metadata[TAG] !== "true") continue;
        for await (const price of stripe.prices.list({ product: product.id, active: true, limit: 100 })) await stripe.prices.update(price.id, { active: false });
        await stripe.products.update(product.id, { active: false });
        deleted.push(product.id);
      }
      return deleted;
    },
    async createPrice() {
      const product = await stripe.products.create({ name: "factory contract plan", metadata: { [TAG]: "true" } });
      const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 1900, recurring: { interval: "month" }, metadata: { [TAG]: "true" } });
      return { productId: product.id, priceId: price.id };
    },
    async createClock(frozenTime) {
      return (await stripe.testHelpers.testClocks.create({ frozen_time: frozenTime, name: `${CLOCK_NAME_PREFIX}-${frozenTime}` })).id;
    },
    async createCustomer(clockId) {
      const customer = await stripe.customers.create({ test_clock: clockId, email: "contract@example.com", metadata: { [TAG]: "true" } });
      const method = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
      await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: method.id } });
      return customer.id;
    },
    async subscribe(customerId, priceId) {
      return (await stripe.subscriptions.create({ customer: customerId, items: [{ price: priceId }], metadata: { [TAG]: "true" } })).id;
    },
    async advance(clockId, frozenTime) {
      await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: frozenTime });
      for (let attempt = 0; attempt < 60; attempt++) {
        const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
        if (clock.status === "ready") return;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("the test clock did not finish advancing in two minutes");
    },
    async events(customerId, types) {
      const found: Stripe.Event[] = [];
      for (const type of types) {
        for await (const event of stripe.events.list({ type, limit: 100 })) {
          if ((event.data.object as { customer?: string }).customer === customerId) found.push(event);
        }
      }
      return found.sort((a, b) => a.created - b.created);
    },
    async deleteClock(clockId) {
      await stripe.testHelpers.testClocks.del(clockId);
    },
    async archive(productId, priceId) {
      await stripe.prices.update(priceId, { active: false });
      await stripe.products.update(productId, { active: false });
    },
  };
}

/** The entry of the workflow. The key is read here and nowhere else; nothing from Stripe's answers but event shapes is printed. */
export async function main(env: Record<string, string | undefined>, log: (line: string) => void, api: (key: string) => ContractApi = stripeApi): Promise<number> {
  const key = env.STRIPE_CI_KEY;
  if (!key) {
    log("No STRIPE_CI_KEY: the contract test has nothing to run against. Run `pnpm bootstrap billing <id>` to set it.");
    return 0;
  }
  const result = await runContract(api(key));
  for (const line of result.log) log(line);
  for (const problem of result.problems) log(`::error::${problem}`);
  log(result.ok ? "The fake Stripe still imitates the real one." : "The fake Stripe no longer matches the real one.");
  return result.ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.env, console.log));
