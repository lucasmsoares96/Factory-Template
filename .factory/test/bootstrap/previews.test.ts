import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world } from "./helpers.ts";

// Seam 8 for the Previews module: every step against the fake GitHub, Cloudflare and Neon.
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1" };

function previewsWorld(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = ENV) {
  const w = world({ "resend-setup": "skip", "default-account-email": "admin@example.com", "default-account-password": "admin password 123", "default-account-password-confirm": "admin password 123", ...answers }, env);
  w.deps.interactive = true;
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
  return w;
}

const counts = (w: ReturnType<typeof previewsWorld>) => [w.github.writes, w.cloudflare.writes, w.neon.writes];
const everythingShown = (w: ReturnType<typeof previewsWorld>) => JSON.stringify([w.lines, w.prompter.notes, w.prompter.printed]);
const previewSecrets = (w: ReturnType<typeof previewsWorld>, environment = "example-preview") => w.github.environmentSecrets.get(environment);

describe("pnpm bootstrap previews: Previews module", () => {
  it("makes the preview project with default branch base, a key limited to it, the KV, the environment and the PREVIEW_PRODUCTS entry", async () => {
    const w = previewsWorld();

    const { code, output } = await w.run("previews", "example");

    expect(code).toBe(0);
    expect(w.neon.projects.map((p) => [p.name, p.defaultBranch])).toEqual([["example-preview", "base"]]);
    expect(w.github.environments.get("example-preview")).toBe("main");
    expect([...previewSecrets(w)!.keys()]).toEqual(["EXAMPLE_PREVIEW_NEON_API_KEY"]);
    expect(w.neon.apiKeys).toHaveLength(1);
    expect(w.neon.apiKeys[0]).toMatchObject({ projectId: w.neon.projects[0]!.id, name: "example-preview-ci" });
    expect(previewSecrets(w)!.get("EXAMPLE_PREVIEW_NEON_API_KEY")).toBe(w.neon.apiKeys[0]!.key);
    expect(w.github.variables.get("EXAMPLE_PREVIEW_NEON_PROJECT_ID")).toBe(w.neon.projects[0]!.id);
    expect(w.cloudflare.kvNamespaces.map((k) => k.title)).toEqual(["example-preview-oauth"]);
    expect(w.github.variables.get("EXAMPLE_PREVIEW_OAUTH_KV_ID")).toBe(w.cloudflare.kvNamespaces[0]!.id);
    expect(w.github.variables.get("PREVIEW_PRODUCTS")).toBe("example");
    expect(w.github.variables.get("PREVIEWS_ENABLED")).toBe("true");
    expect(output).toMatch(/ok\s+PREVIEWS_ENABLED/);
    expect(output).toMatch(/Previews \(example\)/);
  });

  it("keeps the production secrets and the project of production out of it", async () => {
    const w = previewsWorld();
    w.neon.projects.push({ id: "proj-prod", name: "example", orgId: "org-1", password: "pw" });

    await w.run("previews", "example");

    expect(w.neon.projects.map((p) => p.name)).toEqual(["example", "example-preview"]);
    expect(w.neon.apiKeys.every((k) => k.projectId !== "proj-prod")).toBe(true);
    expect(w.github.environmentSecrets.has("example-production")).toBe(false);
  });

  it("opens one Neon login for the project and the key together", async () => {
    const w = previewsWorld();

    await w.run("previews", "example");

    expect(w.neon.sessions).toHaveLength(1);
    expect(w.neon.sessions[0]).toMatchObject({ loggedIn: true, closed: 1 });
  });

  it("a second run creates nothing, asks nothing and opens no Neon login", async () => {
    const w = previewsWorld();
    await w.run("previews", "example");
    const before = counts(w);
    const sessions = w.neon.sessions.length;
    w.prompter.asked.length = 0;

    const { code, output } = await w.run("previews", "example");

    expect(code).toBe(0);
    expect(counts(w)).toEqual(before);
    expect(w.neon.sessions).toHaveLength(sessions);
    expect(w.prompter.asked).toEqual([]);
    expect(output).toContain("Neon project example-preview (default branch base): already done");
    expect(output).not.toMatch(/\bskip\b/);
  });

  it("a rerun without the Cloudflare token in the environment does not ask for it: the recorded KV id stands in", async () => {
    const w = previewsWorld();
    await w.run("previews", "example");
    const rerun = previewsWorld({}, {});
    // The same repo, a fresh process with no token.
    Object.assign(rerun, { github: w.github });
    rerun.deps.github = w.github;
    rerun.neon.projects.push(...w.neon.projects);

    const { code } = await rerun.run("previews", "example");

    expect(code).toBe(0);
    expect(rerun.prompter.asked).toEqual([]);
    expect(rerun.neon.sessions).toHaveLength(0);
  });

  it("reuses a preview project of that name and renames its default branch only when it is not base", async () => {
    const w = previewsWorld();
    w.neon.projects.push({ id: "proj-old", name: "example-preview", orgId: "org-1", password: "pw", defaultBranch: "base" });

    await w.run("previews", "example");

    expect(w.neon.projects).toHaveLength(1);
    expect(w.github.variables.get("EXAMPLE_PREVIEW_NEON_PROJECT_ID")).toBe("proj-old");
    expect(w.lines.join("\n")).not.toContain("renamed the default branch");
  });

  it("does not create a second project when several share the name: the person picks", async () => {
    const w = previewsWorld({ "neon-project-pick": "proj-b" });
    w.neon.projects.push({ id: "proj-a", name: "example-preview", orgId: "org-1", password: "a" }, { id: "proj-b", name: "example-preview", orgId: "org-1", password: "b" });

    await w.run("previews", "example");

    expect(w.neon.projects).toHaveLength(2);
    expect(w.github.variables.get("EXAMPLE_PREVIEW_NEON_PROJECT_ID")).toBe("proj-b");
  });

  it("uses NEON_API_KEY from the environment with no login", async () => {
    const w = previewsWorld({}, { ...ENV, NEON_API_KEY: "neon-full" });

    const { code } = await w.run("previews", "example");

    expect(code).toBe(0);
    expect(w.neon.sessions.every((s) => s.apiKey === "neon-full" && !s.loggedIn)).toBe(true);
  });

  describe("when Neon refuses to mint the key with the login", () => {
    it("asks for one pasted key, stores it only as the secret and never prints it", async () => {
      const w = previewsWorld({ "preview-neon-key": "napi_pasted_value_123" });
      w.neon.refuseApiKeys = true;

      const { code } = await w.run("previews", "example");

      expect(code).toBe(0);
      expect(previewSecrets(w)!.get("EXAMPLE_PREVIEW_NEON_API_KEY")).toBe("napi_pasted_value_123");
      expect(w.prompter.asked.filter((id) => id === "preview-neon-key")).toHaveLength(1);
      expect(everythingShown(w)).not.toContain("napi_pasted_value_123");
      expect(w.github.secretWrites.filter((s) => s.name === "EXAMPLE_PREVIEW_NEON_API_KEY")).toHaveLength(1);
    });

    it("a blank answer skips the key, is not asked again in the run, and PREVIEWS_ENABLED stays off", async () => {
      const w = previewsWorld({ "preview-neon-key": "" });
      w.neon.refuseApiKeys = true;

      const { code, output } = await w.run("previews", "example");

      expect(code).toBe(1);
      expect(w.prompter.asked.filter((id) => id === "preview-neon-key")).toHaveLength(1);
      expect(w.github.variables.has("PREVIEWS_ENABLED")).toBe(false);
      expect(output).toMatch(/missing\s+EXAMPLE_PREVIEW_NEON_API_KEY/);
      expect(output).toContain("PREVIEWS_ENABLED stays off");
    });

    it("without a terminal it does not ask", async () => {
      const w = previewsWorld({}, { ...ENV, NEON_API_KEY: "neon-full" });
      w.deps.interactive = false;
      w.neon.refuseApiKeys = true;

      const { code } = await w.run("previews", "example");

      expect(code).toBe(1);
      expect(w.prompter.asked).toEqual([]);
    });

    it("the next run asks again, once, and finishes the job", async () => {
      const w = previewsWorld({ "preview-neon-key": ["", "napi_second_try"] });
      w.neon.refuseApiKeys = true;
      await w.run("previews", "example");

      const { code } = await w.run("previews", "example");

      expect(code).toBe(0);
      expect(w.github.variables.get("PREVIEWS_ENABLED")).toBe("true");
    });
  });

  it("without a Cloudflare token the KV waits: a blank answer skips and is remembered, previews stay off", async () => {
    const w = previewsWorld({ "cloudflare-token": "" }, {});

    const { code, output } = await w.run("previews", "example");

    expect(code).toBe(1);
    expect(w.cloudflare.kvNamespaces).toEqual([]);
    expect(w.prompter.asked.filter((id) => id === "cloudflare-token")).toHaveLength(1);
    expect(output).toMatch(/missing\s+EXAMPLE_PREVIEW_OAUTH_KV_ID/);
    expect(w.github.variables.has("PREVIEWS_ENABLED")).toBe(false);
  });

  it("reuses a KV namespace of that title instead of creating a second one", async () => {
    const w = previewsWorld();
    w.cloudflare.kvNamespaces.push({ id: "kv-existing", title: "example-preview-oauth" });

    await w.run("previews", "example");

    expect(w.cloudflare.kvNamespaces).toHaveLength(1);
    expect(w.github.variables.get("EXAMPLE_PREVIEW_OAUTH_KV_ID")).toBe("kv-existing");
  });

  it("falls back to repo-level secrets and FACTORY_USE_ENVIRONMENTS=false when the API refuses environments", async () => {
    const w = previewsWorld();
    w.github.refuseEnvironments = true;

    const { code } = await w.run("previews", "example");

    expect(code).toBe(0);
    expect(w.github.environments.size).toBe(0);
    expect(w.github.variables.get("FACTORY_USE_ENVIRONMENTS")).toBe("false");
    expect(w.github.secrets.has("EXAMPLE_PREVIEW_NEON_API_KEY")).toBe(true);
    expect(w.github.environmentSecrets.size).toBe(0);
  });

  it("adds to PREVIEW_PRODUCTS without dropping the other Products", async () => {
    const w = previewsWorld();
    w.github.variables.set("PREVIEW_PRODUCTS", "shop");

    await w.run("previews", "example");

    expect(w.github.variables.get("PREVIEW_PRODUCTS")).toBe("shop,example");
  });

  it("prefixes every name with <ID>_ (dashes become underscores)", async () => {
    const w = previewsWorld();
    w.products.set("my-app", { id: "my-app", title: "My App", emailFrom: "x <x@my.app>", domain: "my.app" });

    await w.run("previews", "my-app");

    expect([...w.github.environmentSecrets.get("my-app-preview")!.keys()]).toEqual(["MY_APP_PREVIEW_NEON_API_KEY"]);
    expect([...w.github.variables.keys()].filter((n) => n.includes("MY_APP"))).toEqual(["MY_APP_PREVIEW_NEON_PROJECT_ID", "MY_APP_PREVIEW_OAUTH_KV_ID"]);
    expect(w.neon.projects.map((p) => p.name)).toEqual(["my-app-preview"]);
  });

  it("--redo refreshes one step and leaves the others alone; an unknown step is named", async () => {
    const w = previewsWorld();
    await w.run("previews", "example");
    const key = previewSecrets(w)!.get("EXAMPLE_PREVIEW_NEON_API_KEY");
    const projects = w.neon.projects.length;

    const { output } = await w.run("previews", "example", "--redo", "preview-neon-key");

    expect(output).toContain("Neon API key limited to example-preview (EXAMPLE_PREVIEW_NEON_API_KEY): redoing");
    expect(previewSecrets(w)!.get("EXAMPLE_PREVIEW_NEON_API_KEY")).not.toBe(key);
    expect(w.neon.projects).toHaveLength(projects);
    expect(String(await w.run("previews", "example", "--redo", "nope").catch((e: Error) => e.message))).toContain("Unknown step");
  });

  it("is refused for a Product that does not exist, and without an id", async () => {
    const w = previewsWorld();
    expect((await w.run("previews", "ghost")).code).toBe(1);
    expect((await w.run("previews")).output).toContain("Usage: pnpm bootstrap previews <id>");
  });

  it("never prints the Neon key, the Cloudflare token or a connection string", async () => {
    const w = previewsWorld();

    await w.run("previews", "example");

    const shown = everythingShown(w);
    expect(shown).not.toContain(w.neon.apiKeys[0]!.key);
    expect(shown).not.toContain(TOKEN);
    expect(shown).not.toContain("postgresql://");
  });
});

describe("doctor: the Previews section is by presence", () => {
  it("is absent for a Product with no trace of previews, and does not fail it", async () => {
    const w = previewsWorld();
    await w.run("product", "example");

    const { output } = await w.run("doctor", "example");

    expect(output).not.toContain("Previews (example)");
  });

  it("appears once previews were set up, all ok", async () => {
    const w = previewsWorld({ "resend-key": "" });
    await w.run("product", "example");
    await w.run("previews", "example");

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(0);
    for (const name of ["EXAMPLE_PREVIEW_NEON_API_KEY", "EXAMPLE_PREVIEW_NEON_PROJECT_ID", "EXAMPLE_PREVIEW_OAUTH_KV_ID", "example in PREVIEW_PRODUCTS", "Environment example-preview"]) {
      expect(output).toMatch(new RegExp(`ok\\s+${name}`));
    }
  });

  it("flags what is missing as required once any part exists, and writes nothing", async () => {
    const w = previewsWorld();
    await w.run("previews", "example");
    w.github.variables.delete("EXAMPLE_PREVIEW_OAUTH_KV_ID");
    const before = counts(w);

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+EXAMPLE_PREVIEW_OAUTH_KV_ID\s+run `pnpm bootstrap previews example`/);
    expect(counts(w)).toEqual(before);
  });

  it("looks the Neon project up only with a session already in the run, and warns when its default branch is not base", async () => {
    const w = previewsWorld({}, { ...ENV, NEON_API_KEY: "neon-full" });
    await w.run("previews", "example");
    w.neon.projects[0]!.defaultBranch = "main";

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/warn\s+Neon preview project\s+proj-1: default branch is main, not base/);
  });

  it("the production module does not fail on half-set previews", async () => {
    const w = previewsWorld();
    w.github.variables.set("EXAMPLE_PREVIEW_OAUTH_KV_ID", "kv-x");

    const { code } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.github.variables.get("DEPLOY_ENABLED")).toBe("true");
  });
});
