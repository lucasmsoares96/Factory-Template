import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world } from "./helpers.ts";

const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", RESEND_API_KEY: "re-full" };

const ADMIN = "Admin@Example.com";
const PASSWORD = "admin password 123";

function productWorld(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = ENV) {
  const w = world({ "resend-domain-action": "skip", "default-account-email": ADMIN, "default-account-password": PASSWORD, "default-account-password-confirm": PASSWORD, ...answers }, env);
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
  return w;
}

const counts = (w: ReturnType<typeof productWorld>) => [w.github.writes, w.cloudflare.writes, w.resend.writes, w.neon.writes, w.accounts.writes];
const everythingShown = (w: ReturnType<typeof productWorld>) => JSON.stringify([w.lines, w.prompter.notes, w.prompter.printed]);

describe("pnpm bootstrap product: Production module", () => {
  it("creates the Neon project, the environment, the <ID>_ secrets, the ruleset and the DEPLOY_PRODUCTS entry", async () => {
    const w = productWorld();

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.neon.projects.map((p) => p.name)).toEqual(["example"]);
    expect(w.github.environments.get("example-production")).toBe("main");
    const env = w.github.environmentSecrets.get("example-production")!;
    expect([...env.keys()].sort()).toEqual(["EXAMPLE_BETTER_AUTH_SECRET", "EXAMPLE_DATABASE_URL", "EXAMPLE_DATABASE_URL_POOLED", "EXAMPLE_SMOKE_PASSWORD"]);
    expect(env.get("EXAMPLE_DATABASE_URL")).toContain("neon.tech");
    expect(env.get("EXAMPLE_DATABASE_URL_POOLED")).toContain("-pooler");
    expect(w.github.rulesets.map((r) => r.name)).toEqual(["main"]);
    expect(w.github.variables.get("DEPLOY_PRODUCTS")).toBe("example");
  });

  it("prefixes every Product secret with <ID>_ (dashes become underscores)", async () => {
    const w = productWorld();
    w.products.set("my-app", { id: "my-app", title: "My App", emailFrom: "x <x@my.app>", domain: "my.app" });

    await w.run("product", "my-app");

    const names = [...(w.github.environmentSecrets.get("my-app-production")?.keys() ?? []), ...w.github.secrets.keys()].filter((n) => n.includes("MY_APP"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.startsWith("MY_APP_"))).toBe(true);
  });

  it("creates nothing on the second run, and finds the Neon project by name", async () => {
    const w = productWorld();
    await w.run("product", "example");
    const before = counts(w);

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(counts(w)).toEqual(before);
    expect(output).toContain("Neon project example: already done");
    expect(w.neon.projects).toHaveLength(1);
  });

  it("does not create a second Neon project when one with the name exists", async () => {
    const w = productWorld();
    w.neon.projects.push({ id: "proj-existing", name: "example", orgId: "org-1", password: "pw" });

    await w.run("product", "example");

    expect(w.neon.projects).toHaveLength(1);
    expect(w.github.environmentSecrets.get("example-production")?.get("EXAMPLE_DATABASE_URL")).toContain("proj-existing");
  });

  it("--redo refreshes one step and leaves the others alone", async () => {
    const w = productWorld();
    await w.run("product", "example");
    const secret = w.github.environmentSecrets.get("example-production")!.get("EXAMPLE_BETTER_AUTH_SECRET");
    const projects = w.neon.writes;

    const { output } = await w.run("product", "example", "--redo", "auth-secret");

    expect(output).toContain("Better Auth secret (EXAMPLE_BETTER_AUTH_SECRET): redoing");
    expect(w.github.environmentSecrets.get("example-production")!.get("EXAMPLE_BETTER_AUTH_SECRET")).not.toBe(secret);
    expect(w.neon.writes).toBe(projects);
    const unknown = await w.run("product", "example", "--redo", "nope").catch((e: Error) => e.message);
    expect(String(unknown)).toContain("Unknown step");
  });

  it("falls back to repo-level secrets and FACTORY_USE_ENVIRONMENTS=false when the API refuses environments", async () => {
    const w = productWorld();
    w.github.refuseEnvironments = true;

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.github.environments.size).toBe(0);
    expect(w.github.variables.get("FACTORY_USE_ENVIRONMENTS")).toBe("false");
    expect(w.github.secrets.has("EXAMPLE_DATABASE_URL")).toBe(true);
    expect(w.github.secrets.has("EXAMPLE_DATABASE_URL_POOLED")).toBe(true);
    expect(w.github.secrets.has("EXAMPLE_BETTER_AUTH_SECRET")).toBe(true);
    expect(w.github.environmentSecrets.size).toBe(0);
  });

  it("a rerun after the plan allows environments flips FACTORY_USE_ENVIRONMENTS back", async () => {
    const w = productWorld();
    w.github.refuseEnvironments = true;
    await w.run("product", "example");
    w.github.refuseEnvironments = false;

    await w.run("product", "example", "--redo", "github-environment");

    expect(w.github.variables.get("FACTORY_USE_ENVIRONMENTS")).toBe("true");
    expect(w.github.environments.has("example-production")).toBe(true);
  });

  it("does not duplicate an equivalent ruleset made by hand (other name and id)", async () => {
    const w = productWorld();
    w.github.rulesets.push({
      id: 25500591,
      name: "protect main",
      target: "branch",
      enforcement: "active",
      include: ["~DEFAULT_BRANCH"],
      rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"],
      requiredChecks: ["verify"],
    });

    const { output } = await w.run("product", "example");

    expect(w.github.rulesets).toHaveLength(1);
    expect(output).toContain("already done (protect main #25500591)");
  });

  it("creates the ruleset when the existing one lacks the verify check", async () => {
    const w = productWorld();
    w.github.rulesets.push({ id: 1, name: "weak", target: "branch", enforcement: "active", include: ["~DEFAULT_BRANCH"], rules: ["deletion"], requiredChecks: [] });

    await w.run("product", "example");

    expect(w.github.rulesets.map((r) => r.name)).toEqual(["weak", "main"]);
  });

  it("skips the ruleset with a message when the API refuses it", async () => {
    const w = productWorld();
    w.github.refuseRulesets = true;

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(output).toContain("GitHub refused the ruleset");
    expect(w.github.rulesets).toEqual([]);
  });

  it("adds to DEPLOY_PRODUCTS without dropping the others", async () => {
    const w = productWorld();
    w.github.variables.set("DEPLOY_PRODUCTS", "other");

    await w.run("product", "example");

    expect(w.github.variables.get("DEPLOY_PRODUCTS")).toBe("other,example");
  });

  it("turns DEPLOY_ENABLED on only after the doctor passes", async () => {
    const w = productWorld();
    const seen: string[] = [];
    const original = w.github.setVariable.bind(w.github);
    w.github.setVariable = async (name, value) => {
      seen.push(name);
      await original(name, value);
    };

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.github.variables.get("DEPLOY_ENABLED")).toBe("true");
    expect(seen.at(-1)).toBe("DEPLOY_ENABLED");
  });

  it("leaves DEPLOY_ENABLED off when the doctor fails", async () => {
    const w = productWorld();
    const set = w.github.setSecret.bind(w.github);
    w.github.setSecret = async (name, value, options) => {
      if (!name.endsWith("BETTER_AUTH_SECRET")) await set(name, value, options);
    };

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(1);
    expect(w.github.variables.has("DEPLOY_ENABLED")).toBe(false);
    expect(output).toContain("DEPLOY_ENABLED stays off");
  });

  it("signs in to Neon through the browser by itself, with no key asked or stored, and logs out at the end", async () => {
    const w = productWorld();

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked).not.toContain("neon-key");
    expect(w.neon.sessions).toEqual([{ loggedIn: true, closed: 1 }]);
  });

  it("closes the Neon session even when the login or a later step fails", async () => {
    const w = productWorld();
    w.neon.failLogin = true;
    await expect(w.run("product", "example")).rejects.toThrow(/neonctl auth failed/);
    expect(w.neon.sessions.map((s) => s.closed)).toEqual([1]);

    const later = productWorld();
    later.github.upsertEnvironment = async () => {
      throw new Error("boom");
    };
    await expect(later.run("product", "example")).rejects.toThrow("boom");
    expect(later.neon.sessions.map((s) => s.closed)).toEqual([1]);
  });

  it("uses NEON_API_KEY from the environment without a login, and never stores or prints it", async () => {
    const w = productWorld({}, { ...ENV, NEON_API_KEY: "neon-full" });

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.neon.sessions).toEqual([{ apiKey: "neon-full", loggedIn: false, closed: 1 }]);
    const everything = JSON.stringify([everythingShown(w), [...w.github.secrets], [...w.github.environmentSecrets.values()].map((m) => [...m.keys()]), [...w.github.variables]]);
    expect(everything).not.toContain("neon-full");
  });

  it("never prints a connection string or its password, and sends them only to the forge", async () => {
    const w = productWorld();

    await w.run("product", "example");

    expect(everythingShown(w)).not.toMatch(/postgresql:|pw-1/);
    const stored = [...w.github.environmentSecrets.get("example-production")!.values()].filter((v) => v.startsWith("postgresql://"));
    expect(stored).toHaveLength(2);
  });

  it("asks which Neon organization when there are several, and passes it on every call", async () => {
    const w = productWorld({ "neon-org": "org-2" });
    w.neon.orgs.push({ id: "org-2", name: "Team" });

    await w.run("product", "example");

    expect(w.prompter.asked.filter((id) => id === "neon-org")).toHaveLength(1);
    expect(w.neon.projects[0]?.orgId).toBe("org-2");
    expect(w.neon.orgIdsSeen.every((id) => id === "org-2")).toBe(true);
  });

  it("asks which project to use when several are named like the Product, and creates none", async () => {
    const w = productWorld({ "neon-project-pick": "proj-b" });
    w.neon.projects.push({ id: "proj-a", name: "example", orgId: "org-1", password: "pa" }, { id: "proj-b", name: "example", orgId: "org-1", password: "pb" });

    await w.run("product", "example");

    expect(w.neon.projects).toHaveLength(2);
    expect(w.github.environmentSecrets.get("example-production")?.get("EXAMPLE_DATABASE_URL")).toContain("proj-b");
  });

  it("makes no project-scoped Neon key for production", async () => {
    const w = productWorld();
    await w.run("product", "example");
    expect([...w.github.secrets.keys(), ...(w.github.environmentSecrets.get("example-production")?.keys() ?? [])].filter((n) => /NEON/.test(n))).toEqual([]);
  });

  it("offers the Resend domain steps and can defer them", async () => {
    const w = productWorld();

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(output).toContain("Resend domain deferred");
    expect(w.resend.domains).toEqual([]);
    expect(w.github.environmentSecrets.get("example-production")?.has("EXAMPLE_RESEND_API_KEY")).toBe(false);
  });

  it("stores the restricted Resend key in the environment when the domain is created", async () => {
    const w = productWorld({ "resend-domain-action": "create" });
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });

    await w.run("product", "example");

    expect(w.github.environmentSecrets.get("example-production")?.get("EXAMPLE_RESEND_API_KEY")).toMatch(/^re_restricted_/);
    expect(w.github.secrets.has("EXAMPLE_RESEND_API_KEY")).toBe(false);
  });
});

describe("pnpm bootstrap doctor <id>: Production section", () => {
  it("fails and names the missing secrets before the module ran", async () => {
    const w = productWorld();

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+EXAMPLE_DATABASE_URL/);
    expect(output).toMatch(/missing\s+example in DEPLOY_PRODUCTS/);
  });

  it("is read-only and passes after the module ran", async () => {
    const w = productWorld();
    await w.run("product", "example");
    const before = counts(w);

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+EXAMPLE_DATABASE_URL/);
    expect(output).toMatch(/ok\s+Ruleset on the default branch/);
    expect(counts(w)).toEqual(before);
  });

  it("shows the environment as off, not missing, after the fallback", async () => {
    const w = productWorld();
    w.github.refuseEnvironments = true;
    await w.run("product", "example");

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(0);
    expect(output).toMatch(/off\s+Environment example-production/);
  });
});

describe("pnpm bootstrap product: accounts in the production database", () => {
  const SMOKE = "smoke@example.com";
  const url = (w: ReturnType<typeof productWorld>) => [...w.accounts.databases.keys()][0]!;
  const users = (w: ReturnType<typeof productWorld>) => w.accounts.databases.get(url(w))!.users;
  /** Everything outside the database itself: logs, prompts, the forge (names and values), the variables. */
  const outsideTheDatabase = (w: ReturnType<typeof productWorld>) =>
    JSON.stringify([
      everythingShown(w),
      [...w.github.secrets],
      [...w.github.environmentSecrets].map(([name, m]) => [name, [...m].filter(([secret]) => secret !== "EXAMPLE_SMOKE_PASSWORD")]),
      [...w.github.variables],
    ]);

  it("creates the default account (email lower-cased, verified) and a smoke account, migrations first", async () => {
    const w = productWorld();

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.accounts.events).toEqual(["migrate example", "upsert admin@example.com", "migrate example", `upsert ${SMOKE}`]);
    expect(users(w).get("admin@example.com")).toEqual({ password: PASSWORD, verified: true });
    expect(users(w).get(SMOKE)?.verified).toBe(true);
    expect(url(w)).toBe(w.github.environmentSecrets.get("example-production")!.get("EXAMPLE_DATABASE_URL"));
  });

  it("stores only EXAMPLE_SMOKE_PASSWORD and the EXAMPLE_SMOKE_EMAIL variable; no password appears anywhere but the database", async () => {
    const w = productWorld();
    await w.run("product", "example");

    const stored = w.github.environmentSecrets.get("example-production")!;
    expect([...stored.keys()].filter((n) => n.includes("PASSWORD"))).toEqual(["EXAMPLE_SMOKE_PASSWORD"]);
    expect(stored.get("EXAMPLE_SMOKE_PASSWORD")).toBe(users(w).get(SMOKE)!.password);
    expect(stored.get("EXAMPLE_SMOKE_PASSWORD")!.length).toBeGreaterThanOrEqual(24);
    expect(w.github.variables.get("EXAMPLE_SMOKE_EMAIL")).toBe(SMOKE);
    const shown = JSON.stringify([everythingShown(w), [...w.github.variables], [...w.github.secrets]]);
    expect(shown).not.toContain(PASSWORD);
    expect(shown).not.toContain(stored.get("EXAMPLE_SMOKE_PASSWORD"));
    expect(JSON.stringify([...stored])).not.toContain(PASSWORD);
    expect(w.github.secretWrites.map((s) => s.name)).not.toContain("EXAMPLE_DEFAULT_PASSWORD");
  });

  it("falls back to smoke@<id>.invalid when the Product has no domain", async () => {
    const w = productWorld({ "product-domain": "" });
    w.products.set("example", { ...w.products.get("example")!, domain: "" });

    await w.run("product", "example");

    expect(w.github.variables.get("EXAMPLE_SMOKE_EMAIL")).toBe("smoke@example.invalid");
  });

  it("does not ask for the default account again on the second run, and writes nothing", async () => {
    const w = productWorld();
    await w.run("product", "example");
    const before = counts(w);
    const asked = w.prompter.asked.length;

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(counts(w)).toEqual(before);
    expect(w.prompter.asked.slice(asked)).not.toContain("default-account-password");
  });

  it("leaves an existing user with the chosen email alone: no password is asked", async () => {
    const w = productWorld();
    await w.run("product", "example");
    // Only the smoke account can enter now (the default one is gone) and "boss" exists but was never verified.
    users(w).delete("admin@example.com");
    users(w).set("boss@example.com", { password: "old password 1", verified: false });
    w.prompter["answers"]["default-account-email"] = "boss@example.com";
    const before = w.accounts.writes;

    const { output } = await w.run("product", "example");

    expect(output).toContain("boss@example.com already exists: left alone");
    expect(w.accounts.writes).toBe(before);
    expect(users(w).get("boss@example.com")!.password).toBe("old password 1");
  });

  it("--redo default-account asks again and resets that user's password", async () => {
    const w = productWorld();
    await w.run("product", "example");
    w.prompter["answers"]["default-account-password"] = "brand new password 9";
    w.prompter["answers"]["default-account-password-confirm"] = "brand new password 9";
    const smokeBefore = users(w).get(SMOKE)!.password;

    const { output } = await w.run("product", "example", "--redo", "default-account");

    expect(output).toContain("reset the password of admin@example.com");
    expect(users(w).get("admin@example.com")!.password).toBe("brand new password 9");
    expect(users(w).get(SMOKE)!.password).toBe(smokeBefore);
    expect(w.accounts.events.slice(-2)).toEqual(["migrate example", "upsert admin@example.com"]);
    expect(outsideTheDatabase(w)).not.toContain("brand new password 9");
  });

  it("--redo smoke-account rotates the password in the database and in the secret", async () => {
    const w = productWorld();
    await w.run("product", "example");
    const old = users(w).get(SMOKE)!.password;

    const { output } = await w.run("product", "example", "--redo", "smoke-account");

    const fresh = w.github.environmentSecrets.get("example-production")!.get("EXAMPLE_SMOKE_PASSWORD");
    expect(output).toContain(`rotated the password of ${SMOKE}`);
    expect(fresh).not.toBe(old);
    expect(users(w).get(SMOKE)!.password).toBe(fresh);
    expect(outsideTheDatabase(w)).not.toContain(fresh!);
  });

  it("rotates a smoke account whose secret was lost (the old password cannot be recovered)", async () => {
    const w = productWorld();
    await w.run("product", "example");
    w.github.environmentSecrets.get("example-production")!.delete("EXAMPLE_SMOKE_PASSWORD");

    await w.run("product", "example");

    expect(users(w).get(SMOKE)!.password).toBe(w.github.environmentSecrets.get("example-production")!.get("EXAMPLE_SMOKE_PASSWORD"));
  });

  it("applies the sign-up's password rules and asks again; a mismatch is asked again too", async () => {
    const w = productWorld({
      "default-account-password": ["short", "long enough pass", "long enough pass"],
      "default-account-password-confirm": ["different one 99", "long enough pass"],
    });

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(output).toContain("at least 8 characters");
    expect(output).toContain("The two passwords differ");
    expect(users(w).get("admin@example.com")!.password).toBe("long enough pass");
  });

  it("gives up after three invalid passwords and writes no user", async () => {
    const w = productWorld({ "default-account-password": "short" });

    await expect(w.run("product", "example")).rejects.toThrow("No valid password");

    expect([...(w.accounts.databases.values())].flatMap((d) => [...d.users.keys()])).toEqual([]);
  });

  it("doctor <id> shows both accounts, and reports one that is gone", async () => {
    const w = productWorld({}, { ...ENV, NEON_API_KEY: "neon-full" });
    await w.run("product", "example");

    const ok = await w.run("doctor", "example");
    expect(ok.output).toMatch(/ok\s+Default account/);
    expect(ok.output).toMatch(/ok\s+Smoke account\s+smoke@example\.com/);
    expect(ok.output).toMatch(/ok\s+EXAMPLE_SMOKE_PASSWORD/);

    users(w).delete(SMOKE);
    const gone = await w.run("doctor", "example");
    expect(gone.code).toBe(1);
    expect(gone.output).toMatch(/missing\s+Smoke account/);
  });

  it("doctor <id> skips the account check, with the reason, when the run cannot reach the database", async () => {
    const w = productWorld();
    await w.run("product", "example");

    const { output } = await w.run("doctor", "example");
    // This run signs in to Neon only when asked; the doctor alone has no session and no NEON_API_KEY.
    expect(output).toMatch(/skip\s+Default account\s+set NEON_API_KEY/);
    expect(output).toMatch(/skip\s+Smoke account/);
  });
});
