import { describe, expect, it } from "vitest";
import { BILLING_PERMISSIONS } from "../../src/bootstrap/billing-permissions.ts";
import { loadProduct } from "../../src/bootstrap/cli.ts";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world } from "./helpers.ts";

const SANDBOX = "rk_test_sandbox1";
const LIVE = "rk_live_real1";
const CI = "rk_test_ci1";
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", STRIPE_SANDBOX_KEY: SANDBOX, STRIPE_LIVE_KEY: LIVE, STRIPE_CI_KEY: CI };

const answers = (): Record<string, string | boolean | string[]> => ({
  "billing-currency": "usd",
  "billing-fixed-name": ["Pro", "Team", ""],
  "billing-fixed-seats": ["3", "10"],
  "billing-fixed-price": ["19", "49.90"],
  "billing-per-seat-price": "5",
  "billing-free": true,
  "billing-annual": true,
  "billing-annual-discount": "20",
  "billing-trial-days": "14",
  "resend-key": "",
});

function billingWorld(extra: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = ENV) {
  const w = world({ ...answers(), ...extra }, env);
  w.deps.interactive = true;
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
  w.github.environments.set("example-production", "main");
  w.github.environments.set("example-preview", "main");
  w.stripe.keys.add(SANDBOX).add(LIVE).add(CI);
  return w;
}

const production = (w: ReturnType<typeof billingWorld>) => w.github.environmentSecrets.get("example-production")!;
const everythingShown = (w: ReturnType<typeof billingWorld>) => JSON.stringify([w.lines, w.prompter.notes, w.prompter.printed]);
const stripeWrites = (w: ReturnType<typeof billingWorld>) => w.stripe.sandbox.writes + w.stripe.live.writes;

describe("pnpm bootstrap billing", () => {
  it("stops with an explanation when the Product does not list the billing Feature", async () => {
    const w = billingWorld();
    w.products.set("example", { ...w.products.get("example")!, billing: false });

    const { code, output } = await w.run("billing", "example");

    expect(code).toBe(1);
    expect(output).toContain("does not list the billing Feature");
    expect(output).toContain("apps/example/src/features/index.ts");
    expect(w.prompter.asked).toEqual([]);
    expect(stripeWrites(w)).toBe(0);
  });

  it("writes the same plans, prices, portal and payment methods in the sandbox and in the real account", async () => {
    const w = billingWorld();

    const { code } = await w.run("billing", "example");

    expect(code).toBe(0);
    const sandbox = await w.stripe.forKey(SANDBOX).listPlans("example");
    const live = await w.stripe.forKey(LIVE).listPlans("example");
    expect(live).toEqual(sandbox);
    expect(live.map((plan) => [plan.key, plan.kind, plan.seats])).toEqual([
      ["free", "free", 1],
      ["per-seat", "per_seat", null],
      ["pro", "fixed", 3],
      ["team", "fixed", 10],
    ]);
    const prices = Object.fromEntries(live.flatMap((plan) => plan.prices.map((price) => [price.lookupKey, price.amount])));
    expect(prices).toEqual({
      "example_per-seat_monthly": 500,
      "example_per-seat_yearly": 4800,
      example_pro_monthly: 1900,
      example_pro_yearly: 18240,
      example_team_monthly: 4990,
      example_team_yearly: 47904,
    });
    for (const account of [w.stripe.sandbox, w.stripe.live]) {
      expect(account.paymentMethodsOn).toBe(true);
      expect([...account.portals]).toEqual(["example"]);
    }
    // The minimum of the per-Seat plan is one Seat above the biggest fixed plan.
    expect(w.stripe.live.plans.get("example/per-seat")?.minSeats).toBe(11);
  });

  it("creates the events endpoint of the real account only, and keeps its secret in the production environment", async () => {
    const w = billingWorld();

    await w.run("billing", "example");

    expect(w.stripe.sandbox.webhooks).toEqual([]);
    expect(w.stripe.live.webhooks.map((hook) => hook.url)).toEqual(["https://example.com/api/auth/stripe/webhook"]);
    expect(production(w).get("EXAMPLE_STRIPE_WEBHOOK_SECRET")).toBe(w.stripe.live.webhooks[0]!.secret);
  });

  it("stores each key as a secret of the right environment", async () => {
    const w = billingWorld();

    await w.run("billing", "example");

    expect(production(w).get("EXAMPLE_STRIPE_SECRET_KEY")).toBe(LIVE);
    expect(w.github.environmentSecrets.get("example-preview")!.get("EXAMPLE_PREVIEW_STRIPE_SECRET_KEY")).toBe(SANDBOX);
    expect(everythingShown(w)).not.toContain(LIVE);
    expect(everythingShown(w)).not.toContain(SANDBOX);
  });

  it("prints a creation link per key with the name and every permission, and asks for the keys hidden", async () => {
    const w = billingWorld({ "stripe-sandbox-key": SANDBOX, "stripe-live-key": LIVE, "stripe-ci-key": CI }, { ...ENV, STRIPE_SANDBOX_KEY: undefined, STRIPE_LIVE_KEY: undefined, STRIPE_CI_KEY: undefined });

    const { code } = await w.run("billing", "example");

    expect(code).toBe(0);
    const links = w.prompter.printed.filter((line) => line.startsWith("https://dashboard.stripe.com/"));
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toMatch(/\/apikeys\/create\?name=example-billing-(sandbox|live|ci)&/);
      for (const permission of BILLING_PERMISSIONS) expect(link).toContain(`permissions[]=${permission}`);
    }
    expect(links[0]).toContain("/test/apikeys");
    expect(links[1]).not.toContain("/test/");
    expect(links[2]).toContain("/test/apikeys");
    expect(links[2]).toContain("name=example-billing-ci&");
    expect(everythingShown(w)).not.toContain(LIVE);
  });

  it("refuses a key of the other account or one lacking a permission, and asks again", async () => {
    const w = billingWorld(
      { "stripe-sandbox-key": [LIVE, "rk_test_narrow", SANDBOX], "stripe-live-key": LIVE, "stripe-ci-key": [SANDBOX, CI] },
      { ...ENV, STRIPE_SANDBOX_KEY: undefined, STRIPE_LIVE_KEY: undefined, STRIPE_CI_KEY: undefined },
    );
    w.stripe.keys.add("rk_test_narrow");
    w.stripe.lacking.set("rk_test_narrow", ["rak_webhook_write"]);

    const { code, output } = await w.run("billing", "example");

    expect(code).toBe(0);
    expect(output).toContain("That is a live key; this one must be from the sandbox");
    expect(output).toContain("The key lacks rak_webhook_write");
    expect(w.github.environmentSecrets.get("example-preview")!.get("EXAMPLE_PREVIEW_STRIPE_SECRET_KEY")).toBe(SANDBOX);
    expect(output).toContain("the CI sandbox must be another one");
    expect(w.github.secrets.get("STRIPE_CI_KEY")).toBe(CI);
  });

  it("asks nothing and writes nothing on a rerun", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    const before = { stripe: stripeWrites(w), github: w.github.writes };
    w.prompter.asked.length = 0;

    const { code, output } = await w.run("billing", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked).toEqual([]);
    expect(output).toContain("Stripe keys (EXAMPLE_PREVIEW_STRIPE_SECRET_KEY, EXAMPLE_STRIPE_SECRET_KEY): already done");
    expect(output).toContain("already done");
    expect({ stripe: stripeWrites(w), github: w.github.writes }).toEqual(before);
  });

  it("a rerun after a failed write reuses the recorded answers instead of asking", async () => {
    const w = billingWorld();
    w.stripe.lacking.clear();
    await w.run("billing", "example");
    w.github.variables.set("EXAMPLE_BILLING_SYNCED", "false");
    w.prompter.asked.length = 0;

    await w.run("billing", "example");

    expect(w.prompter.asked.filter((id) => id.startsWith("billing-"))).toEqual([]);
    expect(w.github.variables.get("EXAMPLE_BILLING_SYNCED")).toBe("true");
  });

  it("--redo keys makes the keys again and touches no plan", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    const before = stripeWrites(w);
    w.github.secretWrites.length = 0;
    w.prompter.asked.length = 0;

    const { output } = await w.run("billing", "example", "--redo", "keys");

    expect(output).toContain("Stripe keys (EXAMPLE_PREVIEW_STRIPE_SECRET_KEY, EXAMPLE_STRIPE_SECRET_KEY): redoing");
    expect(w.github.secretWrites.map((write) => write.name).sort()).toEqual(["EXAMPLE_PREVIEW_STRIPE_SECRET_KEY", "EXAMPLE_STRIPE_SECRET_KEY"]);
    expect(stripeWrites(w)).toBe(before);
    expect(w.prompter.asked.filter((id) => id.startsWith("billing-"))).toEqual([]);
  });

  it("--redo webhook makes a new endpoint and secret and removes the old one", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    const secret = production(w).get("EXAMPLE_STRIPE_WEBHOOK_SECRET");

    await w.run("billing", "example", "--redo", "webhook");

    expect(w.stripe.live.webhooks).toHaveLength(1);
    expect(production(w).get("EXAMPLE_STRIPE_WEBHOOK_SECRET")).not.toBe(secret);
    expect(production(w).get("EXAMPLE_STRIPE_WEBHOOK_SECRET")).toBe(w.stripe.live.webhooks[0]!.secret);
  });

  it("leaves a price that exists with another amount alone and says so", async () => {
    const w = billingWorld();
    await w.stripe.forKey(LIVE).ensurePlan("example", { key: "pro", name: "Pro", kind: "fixed", seats: 3, trialDays: 0, currency: "usd", prices: [{ lookupKey: "example_pro_monthly", amount: 999, interval: "month" }] });

    const { output } = await w.run("billing", "example");

    expect(output).toContain("example_pro_monthly exist with another amount");
    expect(w.stripe.live.prices.get("example_pro_monthly")?.amount).toBe(999);
  });

  it("ends with the doctor: everything in place passes", async () => {
    const w = billingWorld();

    const { code, output } = await w.run("billing", "example");

    expect(code).toBe(0);
    expect(output).toContain("Billing (example)");
    expect(output).toMatch(/ok\s+Plans\s+4 plan\(s\), the same in both accounts/);
  });
});

describe("pnpm bootstrap doctor: billing", () => {
  it("shows no Billing section for a Product with no trace of billing", async () => {
    const w = billingWorld();

    const { output } = await w.run("doctor", "example");

    expect(output).not.toContain("Billing (example)");
  });

  it("names the permission a key lacks", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    w.stripe.lacking.set(LIVE, ["rak_webhook_write"]);

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+Stripe live key\s+lacks rak_webhook_write/);
  });

  it("points out plans that differ between the sandbox and the real account", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    w.stripe.sandbox.plans.delete("example/team");

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/warn\s+Plans\s+the sandbox and the real account differ in team/);
  });

  it("points out an events endpoint that no longer points to the Product's address", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    w.stripe.live.webhooks[0]!.url = "https://old.example.net/api/auth/stripe/webhook";

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+Events endpoint\s+points to https:\/\/old\.example\.net\/api\/auth\/stripe\/webhook, not to https:\/\/example\.com\/api\/auth\/stripe\/webhook/);
  });

  it("reports a partly set up module as missing, and skips what needs a key it does not have", async () => {
    const w = billingWorld({}, { ...ENV, STRIPE_SANDBOX_KEY: undefined, STRIPE_LIVE_KEY: undefined, STRIPE_CI_KEY: undefined });
    w.deps.interactive = false;
    w.github.environmentSecrets.set("example-production", new Map([["EXAMPLE_STRIPE_SECRET_KEY", LIVE]]));

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+EXAMPLE_STRIPE_WEBHOOK_SECRET/);
    expect(output).toMatch(/skip\s+Stripe live key\s+export STRIPE_LIVE_KEY/);
  });
});

describe("the CI sandbox key (contract test)", () => {
  it("is stored once as a repo secret, not in an environment, and never shown", async () => {
    const w = billingWorld();

    const { code } = await w.run("billing", "example");

    expect(code).toBe(0);
    expect(w.github.secrets.get("STRIPE_CI_KEY")).toBe(CI);
    for (const env of w.github.environmentSecrets.values()) expect(env.has("STRIPE_CI_KEY")).toBe(false);
    expect(everythingShown(w)).not.toContain(CI);
  });

  it("is asked only when the repo secret does not exist: not on a rerun, and not for a second Product", async () => {
    const w = billingWorld({}, { ...ENV, STRIPE_CI_KEY: undefined });
    w.github.secrets.set("STRIPE_CI_KEY", CI);

    const { code } = await w.run("billing", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked).not.toContain("stripe-ci-key");
    expect(w.github.secrets.get("STRIPE_CI_KEY")).toBe(CI);
  });

  it("asks for it when the secret is missing, with a link to a sandbox key, and refuses the key Previews use", async () => {
    const w = billingWorld({ "stripe-ci-key": [SANDBOX, CI] }, { ...ENV, STRIPE_CI_KEY: undefined });

    const { code, output } = await w.run("billing", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked.filter((id) => id === "stripe-ci-key")).toHaveLength(2);
    expect(output).toContain("the CI sandbox must be another one");
    expect(w.github.secrets.get("STRIPE_CI_KEY")).toBe(CI);
  });

  it("is made again by --redo ci-key", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    w.github.secrets.set("STRIPE_CI_KEY", "old");

    const { code } = await w.run("billing", "example", "--redo", "ci-key");

    expect(code).toBe(0);
    expect(w.github.secrets.get("STRIPE_CI_KEY")).toBe(CI);
  });

  it("is a warning in the doctor when missing", async () => {
    const w = billingWorld();
    await w.run("billing", "example");
    w.github.secrets.delete("STRIPE_CI_KEY");

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/warn\s+STRIPE_CI_KEY/);
  });
});

describe("pnpm bootstrap env and all", () => {
  it("env lists the variables of the module", async () => {
    const w = billingWorld();

    const { code, output } = await w.run("env", "example");

    expect(code).toBe(0);
    for (const name of ["STRIPE_SANDBOX_KEY", "STRIPE_LIVE_KEY", "STRIPE_CI_KEY", "EXAMPLE_STRIPE_SECRET_KEY", "EXAMPLE_STRIPE_WEBHOOK_SECRET", "EXAMPLE_PREVIEW_STRIPE_SECRET_KEY", "EXAMPLE_BILLING_PLANS", "EXAMPLE_BILLING_SYNCED"]) {
      expect(output).toContain(name);
    }
  });

  it("all asks whether to set billing up, and skips it on no", async () => {
    const w = billingWorld({ "resend-setup": "skip", "default-account-email": "a@example.com", "default-account-password": "admin password 123", "default-account-password-confirm": "admin password 123", "billing-setup": false });

    const { code, output } = await w.run("all", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked).toContain("billing-setup");
    expect(output).toContain("Billing skipped");
    expect(w.stripe.live.plans.size).toBe(0);
  });

  it("all sets billing up on yes", async () => {
    const w = billingWorld({ "resend-setup": "skip", "default-account-email": "a@example.com", "default-account-password": "admin password 123", "default-account-password-confirm": "admin password 123", "billing-setup": true });

    const { code } = await w.run("all", "example");

    expect(code).toBe(0);
    expect(w.stripe.live.plans.size).toBe(4);
    expect(w.stripe.live.webhooks).toHaveLength(1);
  });
});

describe("loadProduct", () => {
  it("reads whether the Product lists the billing Feature", async () => {
    expect((await loadProduct("example")).billing).toBe(true);
  });
});
