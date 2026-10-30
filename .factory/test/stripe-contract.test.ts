import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { main, runContract, type ContractApi } from "../src/ci/stripe-contract.ts";

const repo = join(import.meta.dirname, "../..");
const WORKFLOWS = join(repo, ".github/workflows");
const workflow = parse(readFileSync(join(WORKFLOWS, "stripe-contract.yml"), "utf8")) as {
  on: { schedule?: { cron: string }[]; push?: { branches: string[] } };
  permissions: unknown;
  jobs: Record<string, { needs?: string; if?: string; permissions?: Record<string, string>; steps: { env?: Record<string, string>; run?: string }[] }>;
};

describe("the Stripe contract workflow, read as data", () => {
  it("runs once a week and on the push to main", () => {
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on.schedule![0]!.cron.split(" ").slice(2)).toEqual(["*", "*", "1"]);
    expect(workflow.on.push?.branches).toEqual(["main"]);
  });

  it("is the only workflow that names the CI sandbox key", () => {
    const users = readdirSync(WORKFLOWS).filter((file) => readFileSync(join(WORKFLOWS, file), "utf8").includes("STRIPE_CI_KEY")).sort();
    expect(users).toEqual(["stripe-contract.yml"]);
    const steps = Object.entries(workflow.jobs).flatMap(([job, { steps }]) => steps.filter((step) => JSON.stringify(step.env ?? {}).includes("secrets.STRIPE_CI_KEY")).map(() => job));
    expect(steps).toEqual(["contract"]);
  });

  it("holds the key in a job that can only read the repo, and opens the issue from a job with no secret", () => {
    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.contract!.permissions).toEqual({ contents: "read" });
    const report = workflow.jobs.report!;
    expect(report.needs).toBe("contract");
    expect(report.if).toContain("failure()");
    expect(report.permissions).toEqual({ issues: "write" });
    expect(JSON.stringify(report.steps)).not.toContain("secrets.");
    expect(report.steps.some((step) => step.run?.includes("gh issue create"))).toBe(true);
  });

  it("runs the contract script", () => {
    expect(workflow.jobs.contract!.steps.some((step) => step.run === "node .factory/src/ci/stripe-contract.ts")).toBe(true);
  });
});

const GOOD_SUBSCRIPTION = {
  id: "sub_1",
  object: "subscription",
  customer: "cus_1",
  status: "active",
  metadata: {},
  created: 1,
  cancel_at_period_end: false,
  trial_end: null,
  items: { data: [{ id: "si_1", quantity: 1, current_period_start: 1, current_period_end: 2, price: { id: "price_1", lookup_key: null, product: "prod_1" } }] },
};
const event = (type: string, object: unknown = GOOD_SUBSCRIPTION) => ({ id: "evt_1", object: "event", type, created: 1, livemode: false, pending_webhooks: 0, data: { object } });

/** A Stripe that records the calls in order; `events` is what the API lists. */
function fakeApi(events: unknown[], failOn?: keyof ContractApi) {
  const calls: string[] = [];
  const step = <T>(name: keyof ContractApi, value: T) => async () => {
    calls.push(name);
    if (failOn === name) throw new Error(`${name} refused`);
    return value;
  };
  const api: ContractApi = {
    deleteLeftovers: step("deleteLeftovers", ["clock_old", "prod_old"]),
    createPrice: step("createPrice", { productId: "prod_1", priceId: "price_1" }),
    createClock: step("createClock", "clock_1"),
    createCustomer: step("createCustomer", "cus_1"),
    subscribe: step("subscribe", "sub_1"),
    advance: step("advance", undefined),
    events: step("events", events),
    deleteClock: step("deleteClock", undefined),
    archive: step("archive", undefined),
  };
  return { api, calls };
}

describe("the contract test", () => {
  const good = [event("customer.subscription.created"), event("customer.subscription.updated")];

  it("deletes the leftovers first and the test clock last, and passes when the events have the fake's shape", async () => {
    const { api, calls } = fakeApi(good);

    const result = await runContract(api);

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["deleteLeftovers", "createPrice", "createClock", "createCustomer", "subscribe", "advance", "events", "deleteClock", "archive"]);
    expect(result.log[0]).toContain("clock_old");
  });

  it("names the field when a subscription event differs from the fake's shape", async () => {
    const renewal = event("customer.subscription.updated", { ...GOOD_SUBSCRIPTION, items: { data: [{ ...GOOD_SUBSCRIPTION.items.data[0], current_period_end: "2026-11-01" }] }, cancel_at_period_end: undefined });

    const result = await runContract(fakeApi([good[0], renewal]).api);

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("customer.subscription.updated data.object.items.data.0.current_period_end: expected number, got string");
    expect(result.problems).toContain("customer.subscription.updated data.object.cancel_at_period_end: expected boolean, got undefined");
  });

  it("fails when the renewal event never arrives", async () => {
    const result = await runContract(fakeApi([good[0]]).api);

    expect(result.problems).toEqual(["no customer.subscription.updated event for the test customer"]);
  });

  it("still deletes the test clock when a step fails", async () => {
    const { api, calls } = fakeApi(good, "advance");

    const result = await runContract(api);

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(["the run failed: advance refused"]);
    expect(calls.slice(-2)).toEqual(["deleteClock", "archive"]);
  });

  it("reports a clock it could not delete", async () => {
    const result = await runContract(fakeApi(good, "deleteClock").api);

    expect(result.problems).toEqual(["could not delete the test clock: deleteClock refused"]);
  });

  it("exits 1 on a mismatch, 0 on a match, and 0 with a notice when there is no key", async () => {
    const lines: string[] = [];
    expect(await main({ STRIPE_CI_KEY: "rk_test_ci" }, (line) => lines.push(line), () => fakeApi(good).api)).toBe(0);
    expect(await main({ STRIPE_CI_KEY: "rk_test_ci" }, (line) => lines.push(line), () => fakeApi([]).api)).toBe(1);
    expect(await main({}, (line) => lines.push(line))).toBe(0);
    expect(lines.join("\n")).toContain("No STRIPE_CI_KEY");
    expect(lines.join("\n")).not.toContain("rk_test_ci");
  });
});
