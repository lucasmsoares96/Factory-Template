import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world } from "./helpers.ts";

const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1" };

const ADMIN = "Admin@Example.com";
const PASSWORD = "admin password 123";

function productWorld(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = ENV) {
  const w = world({ "resend-setup": "skip", "default-account-email": ADMIN, "default-account-password": PASSWORD, "default-account-password-confirm": PASSWORD, ...answers }, env);
  w.deps.interactive = true;
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
    expect([...env.keys()].sort()).toEqual(["EXAMPLE_ACCOUNT_PASSWORD", "EXAMPLE_BETTER_AUTH_SECRET", "EXAMPLE_DATABASE_URL", "EXAMPLE_DATABASE_URL_POOLED"]);
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
      strict: true,
    });

    const { output } = await w.run("product", "example");

    expect(w.github.rulesets).toHaveLength(1);
    expect(output).toContain("already done (protect main #25500591)");
  });

  it("creates the ruleset requiring branches to be up to date before merging", async () => {
    const w = productWorld();

    await w.run("product", "example");

    expect(w.github.rulesets.map((r) => r.strict)).toEqual([true]);
  });

  it("turns on up-to-date branches in an existing ruleset instead of only reusing it", async () => {
    const w = productWorld();
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

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.github.rulesets).toEqual([expect.objectContaining({ id: 25500591, name: "protect main", strict: true })]);
  });

  it("creates the ruleset when the existing one lacks the verify check", async () => {
    const w = productWorld();
    w.github.rulesets.push({ id: 1, name: "weak", target: "branch", enforcement: "active", include: ["~DEFAULT_BRANCH"], rules: ["deletion"], requiredChecks: [], strict: false });

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

  it("the report it prints shows DEPLOY_ENABLED as it ends, and tells to dispatch the first deploy by hand", async () => {
    const w = productWorld();

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+DEPLOY_ENABLED/);
    expect(output).not.toMatch(/off\s+DEPLOY_ENABLED/);
    // A push deploys only the Products it affects: the first deploy of a new Product is dispatched by hand.
    expect(output).toContain("gh workflow run factory-deploy.yml --ref main");
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
    expect(w.prompter.asked).toContain("resend-setup");
    expect(w.prompter.asked).not.toContain("resend-key");
    expect(w.github.environmentSecrets.get("example-production")?.has("EXAMPLE_RESEND_API_KEY")).toBe(false);
  });

  it("with every optional answer skipped: one Resend decision, no Resend key, no Cloudflare token, no worker-domain, doctor green", async () => {
    const w = productWorld({ "resend-setup": "skip" }, {});
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked.filter((id) => id === "resend-setup")).toHaveLength(1);
    expect(w.prompter.asked).not.toContain("resend-key");
    expect(w.prompter.asked).not.toContain("cloudflare-token"); // the final doctor never asks
    expect(output).not.toContain("Worker Custom Domain: running");
    expect(output.trimEnd().split("\n").pop()).toBe("After the first deploy, attach the domain with: pnpm bootstrap domain example --redo worker-domain");
  });

  it("stores the restricted Resend key in the environment when the domain is created", async () => {
    const w = productWorld({ "resend-setup": "now", "resend-key": "re-full" });
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
    w.deps.interactive = false;
    const before = counts(w);

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+EXAMPLE_DATABASE_URL/);
    expect(output).toMatch(/ok\s+Ruleset on the default branch/);
    expect(counts(w)).toEqual(before);
  });

  it("reports a ruleset on the default branch that does not require up-to-date branches", async () => {
    const w = productWorld();
    await w.run("product", "example");
    w.deps.interactive = false;
    w.github.rulesets[0]!.strict = false;

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/off\s+Ruleset on the default branch.*up to date/);
  });

  it("shows the environment as off, not missing, after the fallback", async () => {
    const w = productWorld();
    w.github.refuseEnvironments = true;
    await w.run("product", "example");
    w.deps.interactive = false;

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(0);
    expect(output).toMatch(/off\s+Environment example-production/);
  });
});

describe("pnpm bootstrap product: the account in the production database", () => {
  const EMAIL = "admin@example.com";
  const SECRET = "EXAMPLE_ACCOUNT_PASSWORD";
  const url = (w: ReturnType<typeof productWorld>) => [...w.accounts.databases.keys()][0]!;
  const users = (w: ReturnType<typeof productWorld>) => w.accounts.databases.get(url(w))!.users;
  const secrets = (w: ReturnType<typeof productWorld>) => w.github.environmentSecrets.get("example-production")!;
  /** Everything outside the database itself and the one secret: logs, prompts, the forge, the variables. */
  const outsideTheDatabase = (w: ReturnType<typeof productWorld>) =>
    JSON.stringify([
      everythingShown(w),
      [...w.github.secrets],
      [...w.github.environmentSecrets].map(([name, m]) => [name, [...m].filter(([secret]) => secret !== SECRET)]),
      [...w.github.variables],
    ]);

  it("creates one verified account (email lower-cased), migrations first, and no second one", async () => {
    const w = productWorld();

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.accounts.events).toEqual(["migrate example", `upsert ${EMAIL}`]);
    expect([...users(w).keys()]).toEqual([EMAIL]);
    expect(users(w).get(EMAIL)).toEqual({ password: PASSWORD, verified: true });
    expect(url(w)).toBe(secrets(w).get("EXAMPLE_DATABASE_URL"));
  });

  it("stores the password only as EXAMPLE_ACCOUNT_PASSWORD and the email as a variable; it is never shown or written elsewhere", async () => {
    const w = productWorld();
    await w.run("product", "example");

    expect([...secrets(w).keys()].filter((n) => n.includes("PASSWORD") || n.includes("SMOKE"))).toEqual([SECRET]);
    expect(secrets(w).get(SECRET)).toBe(PASSWORD);
    expect(w.github.variables.get("EXAMPLE_ACCOUNT_EMAIL")).toBe(EMAIL);
    expect([...w.github.variables.keys()].some((n) => n.includes("SMOKE"))).toBe(false);
    expect(outsideTheDatabase(w)).not.toContain(PASSWORD);
  });

  it("creates nothing and asks nothing on the second run", async () => {
    const w = productWorld();
    await w.run("product", "example");
    const before = counts(w);
    const asked = w.prompter.asked.length;

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(counts(w)).toEqual(before);
    expect(w.prompter.asked.slice(asked)).not.toContain("default-account-password");
    expect(w.prompter.asked.slice(asked)).not.toContain("default-account-email");
  });

  it("asks the password once and stores it, without resetting it, when the user exists but the secret is missing", async () => {
    const w = productWorld();
    await w.run("product", "example");
    secrets(w).delete(SECRET);
    users(w).get(EMAIL)!.password = PASSWORD;
    const writes = w.accounts.writes;
    const asked = w.prompter.asked.length;

    const { output } = await w.run("product", "example");

    expect(output).toContain(`${EMAIL} already exists`);
    expect(w.accounts.writes).toBe(writes);
    expect(users(w).get(EMAIL)!.password).toBe(PASSWORD);
    expect(secrets(w).get(SECRET)).toBe(PASSWORD);
    expect(w.prompter.asked.slice(asked).filter((id) => id === "default-account-password")).toHaveLength(1);
    expect(outsideTheDatabase(w)).not.toContain(PASSWORD);
  });

  it("--redo default-account asks again, resets that user's password and updates the secret", async () => {
    const w = productWorld();
    await w.run("product", "example");
    w.prompter["answers"]["default-account-password"] = "brand new password 9";
    w.prompter["answers"]["default-account-password-confirm"] = "brand new password 9";

    const { output } = await w.run("product", "example", "--redo", "default-account");

    expect(output).toContain(`reset the password of ${EMAIL}`);
    expect(users(w).get(EMAIL)!.password).toBe("brand new password 9");
    expect(secrets(w).get(SECRET)).toBe("brand new password 9");
    expect(w.accounts.events.slice(-2)).toEqual(["migrate example", `upsert ${EMAIL}`]);
    expect(outsideTheDatabase(w)).not.toContain("brand new password 9");
    expect(outsideTheDatabase(w)).not.toContain(PASSWORD);
  });

  it("verifies and resets an existing user who never verified", async () => {
    const w = productWorld();
    await w.run("product", "example");
    secrets(w).delete(SECRET);
    users(w).set(EMAIL, { password: "old password 1", verified: false });

    await w.run("product", "example");

    expect(users(w).get(EMAIL)).toEqual({ password: PASSWORD, verified: true });
    expect(secrets(w).get(SECRET)).toBe(PASSWORD);
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
    expect(users(w).get(EMAIL)!.password).toBe("long enough pass");
  });

  it("gives up after three invalid passwords and writes no user and no secret", async () => {
    const w = productWorld({ "default-account-password": "short" });

    await expect(w.run("product", "example")).rejects.toThrow("No valid password");

    expect([...w.accounts.databases.values()].flatMap((d) => [...d.users.keys()])).toEqual([]);
    expect(w.github.secretWrites.map((s) => s.name)).not.toContain(SECRET);
  });

  it("doctor <id> shows one Account line, and reports it gone", async () => {
    const w = productWorld({}, { ...ENV, NEON_API_KEY: "neon-full" });
    await w.run("product", "example");

    const ok = await w.run("doctor", "example");
    expect(ok.output).toMatch(/ok\s+Account\s+admin@example\.com/);
    expect(ok.output).toMatch(/ok\s+EXAMPLE_ACCOUNT_PASSWORD/);
    expect(ok.output).not.toMatch(/Smoke|SMOKE/);

    users(w).delete(EMAIL);
    const gone = await w.run("doctor", "example");
    expect(gone.code).toBe(1);
    expect(gone.output).toMatch(/missing\s+Account/);
  });

  it("doctor <id> reports the account as present (DB not read) when the run has no Neon session", async () => {
    const w = productWorld({ "resend-key": "" });
    await w.run("product", "example");

    const { output } = await w.run("doctor", "example");
    // The doctor never signs in to Neon: presence of the secret and the email stands in.
    expect(output).toMatch(/ok\s+Account\s+ok \(secret and email present; DB not read\)/);
  });
});

describe("pnpm bootstrap product: one Neon login at most, only for Neon work", () => {
  const logins = (w: ReturnType<typeof productWorld>) => w.neon.sessions.filter((s) => s.loggedIn).length;

  it("a first run logs in exactly once", async () => {
    const w = productWorld({ "resend-key": "" });
    await w.run("product", "example");
    expect(logins(w)).toBe(1);
  });

  it("a rerun after a complete first run logs in zero times, asks nothing at all and ends green", async () => {
    const w = productWorld({ "resend-setup": "now", "resend-key": "re-full" });
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });
    await w.run("product", "example");
    const asked = w.prompter.asked.length;
    const sessions = w.neon.sessions.length;

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.neon.sessions).toHaveLength(sessions);
    expect(w.prompter.asked.slice(asked)).toEqual([]);
    expect(output).toContain("secret and email present; DB not read");
    expect(output).not.toMatch(/^\s*(missing|warn)\s/m);
  });

  it("standalone doctor never logs in to Neon", async () => {
    const w = productWorld({ "resend-key": "" });
    await w.run("product", "example");
    const sessions = w.neon.sessions.length;

    const { code } = await w.run("doctor", "example");

    expect(code).toBe(0);
    expect(w.neon.sessions).toHaveLength(sessions);
  });

  it("--redo default-account logs in once", async () => {
    const w = productWorld({ "resend-key": "" });
    await w.run("product", "example");
    const before = logins(w);

    const { code } = await w.run("product", "example", "--redo", "default-account");

    expect(code).toBe(0);
    expect(logins(w) - before).toBe(1);
  });

  it("logs in once when the account variable and secret are missing", async () => {
    const w = productWorld({ "resend-key": "" });
    await w.run("product", "example");
    w.github.variables.delete("EXAMPLE_ACCOUNT_EMAIL");
    w.github.environmentSecrets.get("example-production")!.delete("EXAMPLE_ACCOUNT_PASSWORD");
    const before = logins(w);

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(logins(w) - before).toBe(1);
    expect(w.github.variables.get("EXAMPLE_ACCOUNT_EMAIL")).toBe(ADMIN.toLowerCase());
  });
});
