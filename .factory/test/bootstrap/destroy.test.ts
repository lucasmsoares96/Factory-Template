import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, WRANGLER_TOKEN, world } from "./helpers.ts";

// Seam 8 for `destroy`: everything runs against the fake clients. A world is built by the real wizard commands, so the
// names `destroy` removes are the names the wizard made, not names this file invented.
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x", RESEND_API_KEY: "re-full", NEON_API_KEY: "neon-full" };
const PAT = "github_pat_owner_token";
const PASSWORD = "admin password 123";

async function built(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = ENV) {
  const w = world({ "resend-setup": "skip", "default-account-email": "admin@example.com", "default-account-password": PASSWORD, "default-account-password-confirm": PASSWORD, "preview-account-password": PASSWORD, "preview-account-password-confirm": PASSWORD, "factory-token": PAT, ...answers }, env);
  w.deps.interactive = true;
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
  w.tokens.add(PAT, { push: true });
  w.products.set("shop", { id: "shop", title: "Shop", emailFrom: "Shop <no-reply@shop.test>", domain: "shop.test" });
  for (const id of ["example", "shop"]) {
    await w.run("product", id);
    await w.run("previews", id);
    // What a deploy leaves behind (the Resend domain and its key came from the wizard run above).
    w.cloudflare.workers.add(id);
    w.cloudflare.kvNamespaces.push({ id: `kv-prod-${id}`, title: `${id}-oauth-kv` });
    w.cloudflare.workerDomains.push({ hostname: `${id}.test`, service: id, zoneId: "z" });
  }
  await w.run("factory");
  expect(w.github.secrets.get("FACTORY_TOKEN")).toBe(PAT);
  w.deps.env = { ...env };
  return w;
}

type World = Awaited<ReturnType<typeof built>>;

const writes = (w: World) => [w.github.writes, w.cloudflare.writes, w.neon.writes, w.resend.writes];
const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
const left = (w: World) => ({
  projects: names(w.neon.projects),
  workers: [...w.cloudflare.workers].sort(),
  kvs: w.cloudflare.kvNamespaces.map((k) => k.title).sort(),
  domains: w.resend.domains.map((d) => d.name).sort(),
});
const everywhere = (w: World) => [...w.github.secrets.keys(), ...w.github.variables.keys(), ...w.github.environments.keys(), ...[...w.github.environmentSecrets.values()].flatMap((m) => [...m.keys()])];
const mentions = (w: World, id: string) => everywhere(w).filter((n) => n.toUpperCase().startsWith(id.toUpperCase()));

describe("pnpm bootstrap destroy: refusals", () => {
  it("refuses without a terminal before any listing or API call", async () => {
    const w = await built();
    w.deps.interactive = false;
    const before = writes(w);
    const calls: string[] = [];
    const spy = new Proxy(w.deps.github, { get: (target, key) => (...args: unknown[]) => (calls.push(String(key)), (target as unknown as Record<string, (...a: unknown[]) => unknown>)[String(key)]!(...args)) });
    w.deps.github = spy;
    w.deps.cloudflare = () => (calls.push("cloudflare"), undefined as never);
    w.deps.neon = () => (calls.push("neon"), undefined as never);
    w.deps.resend = () => (calls.push("resend"), undefined as never);
    w.deps.product = async () => (calls.push("product"), undefined as never);

    const { code, output } = await w.run("destroy", "product", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/terminal/);
    expect(calls).toEqual([]);
    expect(w.wrangler.tokenChecks).toBe(0);
    expect(writes(w)).toEqual(before);
    expect(w.prompter.asked.includes("destroy-confirm")).toBe(false);
  });

  it("refuses when CI is set, even with a terminal and the right confirmation", async () => {
    const w = await built({ "destroy-confirm": "all" });
    w.deps.env = { ...ENV, CI: "true" };
    const before = writes(w);
    const state = left(w);

    const { code, output } = await w.run("destroy");

    expect(code).toBe(1);
    expect(output).toMatch(/CI/);
    expect(w.prompter.asked.includes("destroy-confirm")).toBe(false);
    expect(writes(w)).toEqual(before);
    expect(left(w)).toEqual(state);
  });

  it("refuses when CI is defined at all, even empty", async () => {
    const w = await built();
    w.deps.env = { ...ENV, CI: "" };
    const { code, output } = await w.run("destroy", "product", "example");
    expect(code).not.toBe(0);
    expect(output).toMatch(/CI/);
    expect(w.prompter.asked.includes("destroy-confirm")).toBe(false);
  });

  it("rejects an unknown scope or a missing id", async () => {
    const w = await built();
    expect((await w.run("destroy", "product")).code).toBe(1);
    expect((await w.run("destroy", "nothing")).code).toBe(1);
    expect((await w.run("destroy", "previews")).code).toBe(1);
  });
});

describe("pnpm bootstrap destroy product <id>", () => {
  it("lists everything first, highlights the production database, and asks to type the id", async () => {
    const w = await built({ "destroy-confirm": "example" });
    let atPrompt = "";
    const ask = w.prompter.text.bind(w.prompter);
    w.prompter.text = async (input) => {
      atPrompt = w.lines.join("\n");
      return ask(input);
    };

    await w.run("destroy", "product", "example");

    expect(w.prompter.asked.filter((id) => id === "destroy-confirm")).toHaveLength(1);
    const production = atPrompt.split("\n").find((l) => /PRODUCTION DATABASE/.test(l))!;
    expect(production).toContain("example");
    for (const wanted of ["Worker example", "example-oauth-kv", "example-preview-oauth", "example-preview", "example-production", "EXAMPLE_DATABASE_URL", "example.com"]) {
      expect(atPrompt).toContain(wanted);
    }
    expect(atPrompt).not.toMatch(/shop-production|SHOP_DATABASE_URL/);
  });

  it("removes that Product everywhere and keeps the other Product, the common part, the Factory, the repo, labels and accounts", async () => {
    const w = await built({ "destroy-confirm": "example" });
    const labels = [...w.github.labels.keys()];

    const { code } = await w.run("destroy", "product", "example");

    expect(code).toBe(0);
    expect(left(w)).toEqual({
      projects: ["shop", "shop-preview"],
      workers: ["shop"],
      kvs: ["shop-oauth-kv", "shop-preview-oauth"],
      domains: ["shop.test"],
    });
    expect(w.cloudflare.workerDomains.map((d) => d.service)).toEqual(["shop"]);
    expect(mentions(w, "example")).toEqual([]);
    expect(mentions(w, "shop").length).toBeGreaterThan(0);
    expect(w.github.variables.get("DEPLOY_PRODUCTS")).toBe("shop");
    expect(w.github.variables.get("PREVIEW_PRODUCTS")).toBe("shop");
    expect(w.github.variables.get("DEPLOY_ENABLED")).toBe("true");
    expect(w.github.rulesets.map((r) => r.name)).toEqual(["main"]);
    expect(w.github.secrets.has("CLOUDFLARE_API_TOKEN")).toBe(true);
    expect(w.github.secrets.has("FACTORY_TOKEN")).toBe(true);
    expect([...w.github.labels.keys()]).toEqual(labels);
  });

  it("with the last Product, it also removes the main ruleset and the module switches", async () => {
    const w = await built({ "destroy-confirm": ["shop", "example"] });
    await w.run("destroy", "product", "shop");
    expect(w.github.rulesets).toHaveLength(1);

    const { code } = await w.run("destroy", "product", "example");

    expect(code).toBe(0);
    expect(w.github.rulesets).toEqual([]);
    for (const name of ["DEPLOY_PRODUCTS", "PREVIEW_PRODUCTS", "DEPLOY_ENABLED", "PREVIEWS_ENABLED"]) expect(w.github.variables.has(name)).toBe(false);
    expect(left(w)).toEqual({ projects: [], workers: [], kvs: [], domains: [] });
  });

  it("falls back to repo-level secrets when the Product has no environment", async () => {
    const w = await built({ "destroy-confirm": "example" });
    w.github.environments.delete("example-production");
    w.github.environments.delete("example-preview");
    w.github.environmentSecrets.clear();
    for (const name of ["EXAMPLE_DATABASE_URL", "EXAMPLE_DATABASE_URL_POOLED", "EXAMPLE_BETTER_AUTH_SECRET", "EXAMPLE_ACCOUNT_PASSWORD", "EXAMPLE_RESEND_API_KEY", "EXAMPLE_PREVIEW_NEON_API_KEY", "EXAMPLE_PREVIEW_ACCOUNT_PASSWORD"]) w.github.secrets.set(name, "x");

    await w.run("destroy", "product", "example");

    expect(mentions(w, "example")).toEqual([]);
  });

  it("does not take a Product whose id is the prefix of another for the other one", async () => {
    const w = await built({ "destroy-confirm": "shop" });
    w.github.secrets.set("SHOP_2_DATABASE_URL", "x");
    w.github.variables.set("SHOP_2_ACCOUNT_EMAIL", "x");

    await w.run("destroy", "product", "shop");

    expect(w.github.secrets.has("SHOP_2_DATABASE_URL")).toBe(true);
    expect(w.github.variables.has("SHOP_2_ACCOUNT_EMAIL")).toBe(true);
  });
});

describe("pnpm bootstrap destroy: wrong confirmation", () => {
  it.each(["", "exampl", "Example", "all", "yes"])("aborts with nothing deleted when %j is typed", async (typed) => {
    const w = await built({ "destroy-confirm": typed });
    const before = writes(w);
    const state = left(w);
    const secrets = everywhere(w);

    const { code, output } = await w.run("destroy", "product", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/Nothing was deleted/);
    expect(writes(w)).toEqual(before);
    expect(left(w)).toEqual(state);
    expect(everywhere(w)).toEqual(secrets);
  });
});

describe("pnpm bootstrap destroy: no login before the confirmation", () => {
  it.each(["", "nope"])("opens no login and asks nothing but the confirmation (typed %j), and says what it could not list", async (typed) => {
    const w = await built({ "destroy-confirm": typed });
    // Nothing known on this machine: no Cloudflare, Neon or Resend credential in the environment, no saved wrangler login.
    w.deps.env = {};
    w.wrangler.saved = undefined;
    w.wrangler.logins = 0;
    const neonSessions = w.neon.sessions.length;
    const askedBefore = w.prompter.asked.length;

    const { code, output } = await w.run("destroy", "product", "example");

    expect(code).toBe(1);
    expect(w.wrangler.logins).toBe(0);
    expect(w.neon.sessions.slice(neonSessions).filter((s) => s.loggedIn)).toEqual([]);
    expect(w.prompter.asked.slice(askedBefore)).toEqual(["destroy-confirm"]);
    expect(output).toMatch(/Not listed: no Cloudflare login/);
    expect(output).toMatch(/Not listed: .*Neon/);
    expect(output).toMatch(/Nothing was deleted/);
  });
});

describe("pnpm bootstrap destroy previews <id>", () => {
  it("removes only the previews of the Product and keeps production", async () => {
    const w = await built({ "destroy-confirm": "example" });

    const { code } = await w.run("destroy", "previews", "example");

    expect(code).toBe(0);
    expect(left(w)).toEqual({
      projects: ["example", "shop", "shop-preview"],
      workers: ["example", "shop"],
      kvs: ["example-oauth-kv", "shop-oauth-kv", "shop-preview-oauth"],
      domains: ["example.com", "shop.test"],
    });
    expect(w.github.environments.has("example-preview")).toBe(false);
    expect(w.github.environments.has("example-production")).toBe(true);
    expect(w.github.variables.get("PREVIEW_PRODUCTS")).toBe("shop");
    expect(w.github.variables.has("EXAMPLE_PREVIEW_NEON_PROJECT_ID")).toBe(false);
    expect(w.github.variables.has("EXAMPLE_PREVIEW_OAUTH_KV_ID")).toBe(false);
    expect(w.github.secrets.has("EXAMPLE_DATABASE_URL") || w.github.environmentSecrets.get("example-production")!.has("EXAMPLE_DATABASE_URL")).toBe(true);
    expect(w.github.variables.get("DEPLOY_PRODUCTS")).toBe("example,shop");
  });
});

describe("pnpm bootstrap destroy factory", () => {
  it("removes the Factory's secrets and variables, and nothing else", async () => {
    const w = await built({ "destroy-confirm": "factory" });

    const { code } = await w.run("destroy", "factory");

    expect(code).toBe(0);
    for (const name of ["FACTORY_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]) expect(w.github.secrets.has(name)).toBe(false);
    for (const name of ["FACTORY_ENABLED"]) expect(w.github.variables.has(name)).toBe(false);
    expect(w.github.secrets.has("CLOUDFLARE_API_TOKEN")).toBe(true);
    expect(w.github.variables.get("DEPLOY_PRODUCTS")).toBe("example,shop");
    expect([...w.github.labels.keys()].length).toBeGreaterThan(0);
    expect(left(w).projects).toHaveLength(4);
  });

});

describe("pnpm bootstrap destroy (everything)", () => {
  it("needs `all`, then removes every Product, the Factory and the common part, and keeps the repo, labels and accounts", async () => {
    const w = await built({ "destroy-confirm": "all" });
    const labels = [...w.github.labels.keys()];

    const { code, output } = await w.run("destroy");

    expect(code).toBe(0);
    expect(left(w)).toEqual({ projects: [], workers: [], kvs: [], domains: [] });
    expect(everywhere(w)).toEqual([]);
    expect(w.github.rulesets).toEqual([]);
    expect(w.github.secrets.has("FACTORY_TOKEN")).toBe(false);
    expect([...w.github.labels.keys()]).toEqual(labels);
    expect(output).toMatch(/kept: .*repository.*issues.*labels.*accounts/i);
  });

  it("is not confirmed by a Product id", async () => {
    const w = await built({ "destroy-confirm": "example" });
    const before = writes(w);

    const { code } = await w.run("destroy");

    expect(code).toBe(1);
    expect(writes(w)).toEqual(before);
  });
});

describe("pnpm bootstrap destroy: credentials and partial failures", () => {
  it("asks for nothing but the confirmation: wrangler's saved login, the Neon key and the Resend key from the environment", async () => {
    const w = await built({ "destroy-confirm": "example" }, { RESEND_API_KEY: "re-full", NEON_API_KEY: "neon-full" });
    w.wrangler.saved = WRANGLER_TOKEN;
    w.cloudflare.validTokens.add(WRANGLER_TOKEN);
    const sessions = w.neon.sessions.length;
    const logins = w.wrangler.logins;
    const asked = w.prompter.asked.length;

    const { code } = await w.run("destroy", "product", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked.slice(asked)).toEqual(["destroy-confirm"]);
    expect(w.wrangler.logins).toBe(logins);
    expect(w.neon.sessions.length - sessions).toBe(1);
    expect(w.neon.sessions.at(-1)!.closed).toBe(1);
  });

  it("never asks for a Resend key: with a Resend secret and no key at hand it says how to delete the domain too", async () => {
    const w = await built({ "destroy-confirm": "example" }, { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", NEON_API_KEY: "neon-full" });
    // Resend was deferred when this world was built; a domain made by hand and its key secret exist anyway.
    w.resend.domains.push({ id: "dom-x", name: "example.com", status: "verified", records: [] });
    w.github.environmentSecrets.get("example-production")!.set("EXAMPLE_RESEND_API_KEY", "re_restricted");
    const asked = w.prompter.asked.length;

    const { code, output } = await w.run("destroy", "product", "example");

    expect(w.prompter.asked.slice(asked)).toEqual(["destroy-confirm"]);
    expect(code).toBe(0);
    expect(output).toMatch(/Note: .*Resend.*export RESEND_API_KEY/);
    expect(left(w).domains).toEqual(["example.com"]);
  });

  it("reports what failed, continues with the rest, and exits 1", async () => {
    const w = await built({ "destroy-confirm": "example" });
    const production = w.neon.projects.find((p) => p.name === "example")!;
    w.neon.failDeletes.add(production.id);
    w.cloudflare.failDeletes.add("worker:example");
    w.github.failDeletes.add("environment:example-production");

    const { code, output } = await w.run("destroy", "product", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/failed/i);
    expect(output).toContain(production.id);
    expect(output).toMatch(/worker example/i);
    expect(output).toContain("example-production");
    expect(left(w).projects).toEqual(["example", "shop", "shop-preview"]);
    expect(left(w).workers).toEqual(["example", "shop"]);
    // Everything else still went.
    expect(left(w).kvs).toEqual(["shop-oauth-kv", "shop-preview-oauth"]);
    expect(left(w).domains).toEqual(["shop.test"]);
    expect(w.github.environments.has("example-preview")).toBe(false);
    expect(w.github.variables.get("DEPLOY_PRODUCTS")).toBe("shop");
  });

  it("does not delete a Neon project when several share the name, and says so", async () => {
    const w = await built({ "destroy-confirm": "example" });
    w.neon.projects.push({ id: "proj-dup", name: "example", orgId: "org-1", password: "pw" });

    const { code, output } = await w.run("destroy", "product", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/2 Neon projects are named example/);
    expect(w.neon.projects.filter((p) => p.name === "example")).toHaveLength(2);
    expect(w.neon.projects.some((p) => p.name === "example-preview")).toBe(false);
  });

  it("never deletes a DNS record", async () => {
    const w = await built({ "destroy-confirm": "all" });
    w.cloudflare.zones.push({ id: "z", name: "shop.test" });
    w.cloudflare.dnsRecords.set("z", [{ type: "TXT", name: "send.shop.test", content: "v=spf1" }]);

    await w.run("destroy");

    expect(w.cloudflare.dnsRecords.get("z")).toHaveLength(1);
  });
});
