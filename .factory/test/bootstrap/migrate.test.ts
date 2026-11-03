import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world } from "./helpers.ts";

// Seam 1 for the move to the stage environments: a repo of the old layout (token at repo level, an environment per
// Product) is migrated by rerunning the bootstrap, and the old layout goes only after an explicit, confirmed step.
const PASSWORD = "admin password 123";
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1" };

const PRODUCT_SECRETS = ["EXAMPLE_DATABASE_URL", "EXAMPLE_DATABASE_URL_POOLED", "EXAMPLE_BETTER_AUTH_SECRET", "EXAMPLE_ACCOUNT_PASSWORD"];
const PREVIEW_SECRETS = ["EXAMPLE_PREVIEW_NEON_API_KEY", "EXAMPLE_PREVIEW_ACCOUNT_PASSWORD"];

/** What a repo looked like before: CLOUDFLARE_* at repo level, `example-production` and `example-preview` with the Product's secrets. */
function legacyWorld(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = ENV) {
  const w = world({ "resend-setup": "skip", "default-account-email": "admin@example.com", "default-account-password": PASSWORD, "default-account-password-confirm": PASSWORD, "preview-account-password": PASSWORD, "preview-account-password-confirm": PASSWORD, ...answers }, env);
  w.deps.interactive = true;
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  w.github.secrets.set("FACTORY_TOKEN", "factory");
  w.github.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "claude");
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
  w.github.variables.set("FACTORY_LANGUAGE", "en");
  const legacy: [string, string[]][] = [["example-production", PRODUCT_SECRETS], ["example-preview", PREVIEW_SECRETS]];
  for (const [name, secrets] of legacy) {
    w.github.environments.set(name, "main");
    w.github.environmentSecrets.set(name, new Map(secrets.map((secret) => [secret, "old"])));
  }
  return w;
}

const held = (w: ReturnType<typeof legacyWorld>, environment: string) => [...(w.github.environmentSecrets.get(environment)?.keys() ?? [])].sort();

describe("the move to the production and preview environments", () => {
  it("copies what can be made again with a rerun, asks the rest once, and leaves the old layout in place for the deploy", async () => {
    const w = legacyWorld();

    expect((await w.run()).code).toBe(0);
    expect((await w.run("product", "example")).code).toBe(0);
    expect((await w.run("previews", "example")).code).toBe(0);

    // Every secret of the Product is in the environment of its stage, and the token in both, unprefixed.
    expect(held(w, "production")).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", ...PRODUCT_SECRETS].sort());
    expect(held(w, "preview")).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", ...PREVIEW_SECRETS].sort());
    expect(w.github.environments.get("production")).toBe("main");
    expect(w.github.environments.get("preview")).toBe("main");
    // The password of the default account cannot be made again: it is asked, once.
    expect(w.prompter.asked.filter((id) => id === "default-account-password")).toHaveLength(1);
    // Nothing old was touched: the deploy keeps working until the workflows read the new environments.
    expect(held(w, "example-production")).toEqual([...PRODUCT_SECRETS].sort());
    expect(held(w, "example-preview")).toEqual([...PREVIEW_SECRETS].sort());
    expect(w.github.secrets.has("CLOUDFLARE_API_TOKEN")).toBe(true);
  });

  it("a new Product does not ask for the Cloudflare token again, and the token is written once per environment", async () => {
    const w = legacyWorld();
    await w.run();
    w.products.set("shop", { id: "shop", title: "Shop", emailFrom: "Shop <no-reply@shop.test>", domain: "shop.test" });
    w.prompter.asked.length = 0;
    const tokenWrites = w.github.secretWrites.filter((write) => write.name === "CLOUDFLARE_API_TOKEN").length;

    await w.run("product", "shop");
    await w.run();

    expect(w.prompter.asked).not.toContain("cloudflare-token");
    expect(w.github.secretWrites.filter((write) => write.name === "CLOUDFLARE_API_TOKEN")).toHaveLength(tokenWrites);
    expect(held(w, "production")).toContain("SHOP_DATABASE_URL");
  });

  describe("migrate-environments", () => {
    async function migrated(answers: Record<string, string | boolean | string[]> = {}) {
      const w = legacyWorld(answers);
      await w.run();
      await w.run("product", "example");
      await w.run("previews", "example");
      return w;
    }

    it("refuses while a secret has no copy, naming it, and deletes nothing", async () => {
      const w = legacyWorld({ "migrate-environments-confirm": true });
      w.github.environmentSecrets.get("example-production")!.set("EXAMPLE_STRIPE_SECRET_KEY", "old");

      const { code, output } = await w.run("migrate-environments");

      expect(code).toBe(1);
      expect(output).toContain("EXAMPLE_STRIPE_SECRET_KEY");
      expect(output).toContain("Not deleted");
      expect(w.github.environments.has("example-production")).toBe(true);
      expect(w.github.secrets.has("CLOUDFLARE_API_TOKEN")).toBe(true);
      expect(w.prompter.asked).not.toContain("migrate-environments-confirm");
    });

    it("lists what goes, asks, and deletes nothing when the answer is no", async () => {
      const w = await migrated({ "migrate-environments-confirm": false });

      const { code, output } = await w.run("migrate-environments");

      expect(code).toBe(1);
      expect(output).toContain("environment example-production, with its secrets");
      expect(output).toContain("repo secret CLOUDFLARE_API_TOKEN");
      expect(output).not.toContain("FACTORY_TOKEN");
      expect(w.prompter.asked).toContain("migrate-environments-confirm");
      expect(w.github.environments.has("example-production")).toBe(true);
      expect(w.github.secrets.has("CLOUDFLARE_API_TOKEN")).toBe(true);
    });

    it("after the confirmation deletes the old environments and the deploy secrets of the repo, and nothing else", async () => {
      const w = await migrated({ "migrate-environments-confirm": true });

      const { code } = await w.run("migrate-environments");

      expect(code).toBe(0);
      expect([...w.github.environments.keys()].sort()).toEqual(["preview", "production"]);
      expect([...w.github.secrets.keys()].sort()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "FACTORY_TOKEN"]);
      expect(held(w, "production")).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", ...PRODUCT_SECRETS].sort());
      expect((await w.run("migrate-environments")).output).toContain("Nothing to migrate");
    });

    it("asks nothing and deletes nothing without a terminal", async () => {
      const w = await migrated();
      w.deps.interactive = false;

      const { code } = await w.run("migrate-environments");

      expect(code).toBe(1);
      expect(w.github.environments.has("example-production")).toBe(true);
    });
  });

  describe("doctor", () => {
    it("points at a deploy secret still at repo level and at an environment per Product, and says how to migrate", async () => {
      const w = legacyWorld();

      const { output } = await w.run("doctor");

      expect(output).toMatch(/warn\s+CLOUDFLARE_API_TOKEN\s+deploy secret at repo level.*pnpm bootstrap migrate-environments/);
      expect(output).toMatch(/warn\s+Environment example-production\s+per-Product environment of the old layout/);
      expect(output).toMatch(/warn\s+Environment example-preview/);
      expect(output).not.toMatch(/warn\s+FACTORY_TOKEN/);
      expect(output).not.toMatch(/warn\s+CLAUDE_CODE_OAUTH_TOKEN/);
    });

    it("is quiet with FACTORY_USE_ENVIRONMENTS=false, where the secrets are meant to be at repo level", async () => {
      const w = legacyWorld();
      w.github.variables.set("FACTORY_USE_ENVIRONMENTS", "false");

      const { output } = await w.run("doctor");

      expect(output).not.toContain("old layout");
      expect(output).not.toContain("deploy secret at repo level");
    });
  });
});
