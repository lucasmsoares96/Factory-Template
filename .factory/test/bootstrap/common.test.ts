import { describe, expect, it } from "vitest";
import { cloudflareTokenUrl, TOKEN_PERMISSIONS } from "../../src/bootstrap/common.ts";
import { TOKEN, WRANGLER_TOKEN, staticLabelNames, world, seedCloudflare } from "./helpers.ts";

const stored = (w: ReturnType<typeof world>, environment: string, name: string) => w.github.environmentSecrets.get(environment)?.get(name);
const STAGES = ["production", "preview"];

describe("pnpm bootstrap (common part)", () => {
  it("sets up Cloudflare and the labels on a fresh repo", async () => {
    const w = world();

    const { code } = await w.run();

    expect(code).toBe(0);
    // No deploy secret at repo level: the token and the account are in the two stage environments, without a prefix.
    expect([...w.github.secrets.keys()]).toEqual([]);
    for (const environment of STAGES) {
      expect(w.github.environments.get(environment)).toBe("main");
      expect(stored(w, environment, "CLOUDFLARE_API_TOKEN")).toBe(TOKEN);
      expect(stored(w, environment, "CLOUDFLARE_ACCOUNT_ID")).toBe("acc-1");
    }
    expect(w.github.secretWrites.map((write) => write.environment).sort()).toEqual(["preview", "preview", "production", "production"]);
    expect(w.cloudflare.subdomains.get("acc-1")).toBe("my-team");
    expect([...w.github.labels.keys()].sort()).toEqual([...staticLabelNames].sort());
    for (const label of w.github.labels.values()) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
    }
  });

  it("does not duplicate an equivalent ruleset made by hand (other name and id)", async () => {
    const w = world();
    w.github.rulesets.push({
      id: 25500591,
      name: "protect main",
      target: "branch",
      enforcement: "active",
      include: ["~DEFAULT_BRANCH"],
      rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"],
      requiredChecks: ["verify"],
      strict: true,
    });

    const { output } = await w.run();

    expect(w.github.rulesets).toHaveLength(1);
    expect(output).toContain("already done (protect main #25500591)");
  });

  it("creates the ruleset once and requires branches to be up to date before merging", async () => {
    const w = world();

    await w.run();
    await w.run();

    expect(w.github.rulesets.map((r) => r.name)).toEqual(["main"]);
    expect(w.github.rulesets.map((r) => r.strict)).toEqual([true]);
  });

  it("turns on up-to-date branches in an existing ruleset instead of only reusing it", async () => {
    const w = world();
    w.github.rulesets.push({
      id: 25500591,
      name: "protect main",
      target: "branch",
      enforcement: "active",
      include: ["~DEFAULT_BRANCH"],
      rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"],
      requiredChecks: ["verify"],
      strict: false,
    });

    const { code } = await w.run();

    expect(code).toBe(0);
    expect(w.github.rulesets).toEqual([expect.objectContaining({ id: 25500591, name: "protect main", strict: true })]);
  });

  it("creates the ruleset when the existing one lacks the verify check", async () => {
    const w = world();
    w.github.rulesets.push({ id: 1, name: "weak", target: "branch", enforcement: "active", include: ["~DEFAULT_BRANCH"], rules: ["deletion"], requiredChecks: [], strict: false });

    await w.run();

    expect(w.github.rulesets.map((r) => r.name)).toEqual(["weak", "main"]);
  });

  it("says so when GitHub refuses to turn on up-to-date branches in an existing ruleset", async () => {
    const w = world();
    w.github.rulesets.push({ id: 7, name: "protect main", target: "branch", enforcement: "active", include: ["~DEFAULT_BRANCH"], rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"], requiredChecks: ["verify"], strict: false });
    w.github.refuseRulesets = true;

    const { output } = await w.run();

    expect(output).toContain("GitHub refused to update ruleset protect main #7");
    expect(w.github.rulesets).toHaveLength(1);
  });

  it("skips the ruleset with a message when the API refuses it", async () => {
    const w = world();
    w.github.refuseRulesets = true;

    const { code, output } = await w.run();

    expect(code).toBe(0);
    expect(output).toContain("GitHub refused the ruleset");
    expect(w.github.rulesets).toEqual([]);
  });

  it("the token template asks for Workers and KV, and no R2 (out of scope)", () => {
    const keys = decodeURIComponent(cloudflareTokenUrl());
    expect(keys).toContain("workers_scripts");
    expect(keys).toContain("workers_kv_storage");
    expect(keys).not.toContain("workers_r2");
  });

  it("the token template is exactly these five permissions, encoded like the version the dashboard pre-selected", () => {
    const encoded = encodeURIComponent(
      JSON.stringify([
        { key: "workers_scripts", type: "edit" },
        { key: "workers_kv_storage", type: "edit" },
        { key: "account_settings", type: "read" },
        { key: "dns", type: "edit" },
        { key: "zone", type: "read" },
      ]),
    );
    expect(cloudflareTokenUrl()).toBe(
      `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${encoded}&name=Factory%20Template%20(Edit%20Cloudflare%20Workers)`,
    );
    expect(TOKEN_PERMISSIONS).toHaveLength(5);
    expect(decodeURIComponent(cloudflareTokenUrl())).not.toContain("workers_routes");
  });

  it("prints the token URL on one unwrapped, undecorated line, even in a 60-column terminal", async () => {
    const w = world({}, { CLOUDFLARE_ACCOUNT_ID: "d812538a70457573532f056032500cdb" });
    w.prompter.columns = 60;

    await w.run();

    const holders = w.prompter.printed.filter((l) => l.includes("https://dash.cloudflare.com/"));
    expect(holders).toHaveLength(1);
    const url = holders[0] as string;
    expect(url).toMatch(/^https:\/\/dash\.cloudflare\.com\/\S+$/);
    expect(w.prompter.notes.join("\n")).not.toContain("https://");
    expect(url).not.toMatch(/%25/); // encoded once
    const u = new URL(url);
    expect(u.pathname).toBe("/d812538a70457573532f056032500cdb/api-tokens/create");
    expect(JSON.parse(u.searchParams.get("permissionGroupKeys") as string)).toEqual([
      { key: "workers_scripts", type: "edit" },
      { key: "workers_kv_storage", type: "edit" },
      { key: "account_settings", type: "read" },
      { key: "dns", type: "edit" },
      { key: "zone", type: "read" },
    ]);
    expect(u.searchParams.get("name")).toBe("Factory Template (Edit Cloudflare Workers)");
    expect(JSON.stringify([w.lines, w.prompter.printed, w.prompter.notes])).not.toContain(TOKEN);
  });

  it("falls back to the documented account picker form when the account is unknown", async () => {
    const w = world();

    await w.run();

    const url = w.prompter.printed.find((l) => l.startsWith("https://dash.cloudflare.com/")) as string;
    expect(url).toContain("https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B");
  });

  it("builds the token URL with and without an account id", () => {
    const direct = cloudflareTokenUrl("acc123");
    const picker = cloudflareTokenUrl();
    expect(direct.startsWith("https://dash.cloudflare.com/acc123/api-tokens/create?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22")).toBe(true);
    expect(direct.endsWith("&name=Factory%20Template%20(Edit%20Cloudflare%20Workers)")).toBe(true);
    expect(picker.startsWith("https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B")).toBe(true);
    expect(new URL(picker).searchParams.get("name")).toBe("Factory Template (Edit Cloudflare Workers)");
    expect(direct).not.toContain("%25");
    expect(picker).not.toContain("%25");
  });

  it("creates nothing on the second run and asks nothing", async () => {
    const w = world();
    await w.run();
    const writes = w.github.writes + w.cloudflare.writes;
    w.prompter.asked.length = 0;

    const { code, output } = await w.run();

    expect(code).toBe(0);
    expect(w.github.writes + w.cloudflare.writes).toBe(writes);
    expect(w.prompter.asked).toEqual([]);
    expect(output).toContain("already done");
  });

  it("registers workers.dev only when the account has none", async () => {
    const w = world();
    w.cloudflare.subdomains.set("acc-1", "existing");

    await w.run();

    expect(w.cloudflare.subdomains.get("acc-1")).toBe("existing");
    expect(w.prompter.asked).not.toContain("workers-dev-subdomain");
  });

  it("rejects an invalid Cloudflare token without storing it", async () => {
    const w = world({ "cloudflare-token": "bad" });

    await expect(w.run()).rejects.toThrow(/Cloudflare rejected the token/);
    expect(w.github.secrets.size).toBe(0);
  });

  describe("checks the token before storing it", () => {
    function narrow(denied: string[], zone = false) {
      const w = world({ "cloudflare-token": ["narrow-token", TOKEN] });
      w.cloudflare.validTokens.add("narrow-token");
      w.cloudflare.deny("narrow-token", ...denied);
      if (zone) w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });
      return w;
    }

    it.each([
      ["kv", "Workers KV Storage"],
      ["workers", "Workers Scripts"],
      ["account", "Account Settings"],
      ["zone", "Zone"],
    ])("names %s (%s) when the token lacks it, asks again and stores only the good token", async (denied, name) => {
      const w = narrow([denied]);

      const { code, output } = await w.run();

      expect(code).toBe(0);
      expect(output).toContain(`The token is missing: ${name}`);
      expect(output).toContain("Nothing was stored");
      expect(w.prompter.asked.filter((id) => id === "cloudflare-token")).toHaveLength(2);
      expect(STAGES.map((environment) => stored(w, environment, "CLOUDFLARE_API_TOKEN"))).toEqual([TOKEN, TOKEN]);
      expect(JSON.stringify([w.lines, w.prompter.printed, [...w.github.environmentSecrets.values()].map((m) => [...m.values()])])).not.toContain("narrow-token");
    });

    it("names DNS when the account has a zone but the token cannot read its records", async () => {
      const w = narrow(["dns"], true);

      const { output } = await w.run();

      expect(output).toContain("The token is missing: DNS");
      expect(stored(w, "production", "CLOUDFLARE_API_TOKEN")).toBe(TOKEN);
    });

    it("names every missing permission at once", async () => {
      const w = narrow(["kv", "zone"]);

      const { output } = await w.run();

      expect(output).toContain("The token is missing: Workers KV Storage, Zone");
    });

    it("gives up after three refused tokens without storing anything", async () => {
      const w = world({ "cloudflare-token": "narrow-token" });
      w.cloudflare.validTokens.add("narrow-token");
      w.cloudflare.deny("narrow-token", "kv");

      await expect(w.run()).rejects.toThrow(/still missing: Workers KV Storage/);
      expect(w.github.secrets.size).toBe(0);
    });

    it("tells the person, right before every link, to check the summary page", async () => {
      const w = narrow(["kv"]);

      const { output } = await w.run();

      expect(output.match(/continue to the summary page and check it there/g)).toHaveLength(2);
      expect(w.prompter.printed.filter((l) => l.startsWith("https://dash.cloudflare.com/"))).toHaveLength(2);
    });

    it("probes read-only: the first refused write is what proves edit vs read", async () => {
      const w = world();

      await w.run();

      expect(w.cloudflare.writes).toBe(1); // only the workers.dev registration, after the check
    });
  });

  it("repairs a label whose colour drifted and leaves other labels alone", async () => {
    const w = world();
    await w.run();
    w.github.labels.set("ready-for-agent", { name: "ready-for-agent", color: "000000", description: "x" });
    w.github.labels.set("bug", { name: "bug", color: "d73a4a", description: "mine" });

    await w.run();

    expect(w.github.labels.get("ready-for-agent")?.color).not.toBe("000000");
    expect(w.github.labels.get("bug")).toEqual({ name: "bug", color: "d73a4a", description: "mine" });
  });

  it("--redo redoes only the named step", async () => {
    const w = world();
    await w.run();
    w.github.labels.clear();
    w.prompter.asked.length = 0;
    const before = w.github.writes;

    await w.run("--redo", "labels");

    expect(w.github.labels.size).toBe(staticLabelNames.length);
    expect(w.github.writes).toBe(before + staticLabelNames.length);
    expect(w.prompter.asked).toEqual([]);
  });

  it("--redo cloudflare-token asks again and replaces the secret", async () => {
    const w = world();
    await w.run();
    w.cloudflare.validTokens.add("new-token");
    const again = world({ "cloudflare-token": "new-token" });
    seedCloudflare(again.github, TOKEN);
    again.cloudflare.validTokens.add("new-token");

    await again.run("--redo", "cloudflare-token");

    expect(STAGES.map((environment) => stored(again, environment, "CLOUDFLARE_API_TOKEN"))).toEqual(["new-token", "new-token"]);
  });

  it("asks the language of the Factory's public text once, sets FACTORY_LANGUAGE, and changes it only with --redo language", async () => {
    const w = world({ "factory-language": ["pt-BR", "en"] });

    await w.run();
    expect(w.prompter.asked.filter((id) => id === "factory-language")).toHaveLength(1);
    expect(w.github.variables.get("FACTORY_LANGUAGE")).toBe("pt-BR");

    w.prompter.asked.length = 0;
    const { output } = await w.run();
    expect(w.prompter.asked).toEqual([]);
    expect(w.github.variables.get("FACTORY_LANGUAGE")).toBe("pt-BR");
    expect(output).toMatch(/FACTORY_LANGUAGE.*pt-BR/);

    await w.run("--redo", "language");
    expect(w.prompter.asked).toEqual(["factory-language"]);
    expect(w.github.variables.get("FACTORY_LANGUAGE")).toBe("en");
  });

  it("offers English first, so it is the default answer", async () => {
    const w = world();
    const offered: string[][] = [];
    const select = w.prompter.select.bind(w.prompter);
    w.prompter.select = async <T extends string>(input: { id: string; options?: { value: T }[] }) => {
      if (input.id === "factory-language") offered.push((input.options ?? []).map((o) => o.value));
      return select(input);
    };

    await w.run();

    expect(offered).toEqual([["en", "pt-BR"]]);
    expect(w.github.variables.get("FACTORY_LANGUAGE")).toBe("en");
  });

  it("lists the valid steps when --redo names an unknown one", async () => {
    const w = world();

    await expect(w.run("--redo", "nope")).rejects.toThrow(/cloudflare-token.*workers-dev.*labels.*language/s);
  });

  it("the cloudflare-token step prompts only when the CI secret is missing", async () => {
    const missing = world();
    await missing.run();
    expect(missing.prompter.asked.filter((id) => id === "cloudflare-token")).toHaveLength(1);

    // The token exists in both environments (it cannot be read back); only the account is missing: no prompt, wrangler's login is used.
    const present = world({}, {}, WRANGLER_TOKEN);
    seedCloudflare(present.github, TOKEN);
    for (const environment of STAGES) present.github.environmentSecrets.get(environment)!.delete("CLOUDFLARE_ACCOUNT_ID");
    present.cloudflare.subdomains.set("acc-1", "my-team");
    present.github.variables.set("FACTORY_LANGUAGE", "en");
    const { code } = await present.run();

    expect(code).toBe(0);
    expect(present.prompter.asked).toEqual([]);
    for (const environment of STAGES) {
      expect(stored(present, environment, "CLOUDFLARE_API_TOKEN")).toBe(TOKEN);
      expect(stored(present, environment, "CLOUDFLARE_ACCOUNT_ID")).toBe("acc-1");
    }
    expect(JSON.stringify([present.lines, [...present.github.environmentSecrets.values()].map((m) => [...m.values()])])).not.toContain(WRANGLER_TOKEN);
  });

  describe("moving a repo of the old layout (token at repo level) to the stage environments", () => {
    function legacy(env: Record<string, string | undefined> = {}) {
      const w = world({}, env, WRANGLER_TOKEN);
      w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
      w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
      w.cloudflare.subdomains.set("acc-1", "my-team");
      w.github.variables.set("FACTORY_LANGUAGE", "en");
      return w;
    }

    it("copies the token from CLOUDFLARE_API_TOKEN into both environments without asking, and leaves the repo secrets for the explicit step", async () => {
      const w = legacy({ CLOUDFLARE_API_TOKEN: TOKEN });

      const { code } = await w.run();

      expect(code).toBe(0);
      expect(w.prompter.asked).toEqual([]);
      for (const environment of STAGES) expect(stored(w, environment, "CLOUDFLARE_API_TOKEN")).toBe(TOKEN);
      expect(w.github.secrets.has("CLOUDFLARE_API_TOKEN")).toBe(true);
    });

    it("asks the token once, saying why, when the session does not have it, and then a Product asks nothing about it", async () => {
      const w = legacy();

      const { output } = await w.run();

      expect(w.prompter.asked.filter((id) => id === "cloudflare-token")).toHaveLength(1);
      expect(output).toContain("a secret cannot be read back from GitHub");
      for (const environment of STAGES) expect(stored(w, environment, "CLOUDFLARE_API_TOKEN")).toBe(TOKEN);

      w.prompter.asked.length = 0;
      await w.run();
      expect(w.prompter.asked).toEqual([]);
    });

    it("writes a CLOUDFLARE_API_TOKEN missing a permission nowhere", async () => {
      const w = legacy({ CLOUDFLARE_API_TOKEN: "narrow-token" });
      w.cloudflare.validTokens.add("narrow-token");
      w.cloudflare.deny("narrow-token", "kv");

      await expect(w.run()).rejects.toThrow(/Workers KV Storage/);
      expect(w.github.environmentSecrets.get("production")?.has("CLOUDFLARE_API_TOKEN") ?? false).toBe(false);
    });
  });

  it("keeps the token and the account at repo level when GitHub refuses environments", async () => {
    const w = world();
    w.github.refuseEnvironments = true;

    const { code } = await w.run();

    expect(code).toBe(0);
    expect(w.github.secrets.get("CLOUDFLARE_API_TOKEN")).toBe(TOKEN);
    expect(w.github.secrets.get("CLOUDFLARE_ACCOUNT_ID")).toBe("acc-1");
    expect(w.github.variables.get("FACTORY_USE_ENVIRONMENTS")).toBe("false");
  });

  it("with several accounts and no CLOUDFLARE_ACCOUNT_ID, the wrangler login never asks which: it says how to pick", async () => {
    const w = world({}, {}, WRANGLER_TOKEN);
    seedCloudflare(w.github, TOKEN);
    for (const environment of STAGES) w.github.environmentSecrets.get(environment)!.delete("CLOUDFLARE_ACCOUNT_ID");
    w.cloudflare.accounts.push({ id: "acc-2", name: "Other" });

    await expect(w.run()).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(w.prompter.asked).toEqual([]);
  });
});
