import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world } from "./helpers.ts";

// The database region: asked once per Product before any Neon project, recorded in <ID>_REGION, and `destroy db` to change it.
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", NEON_API_KEY: "neon-full" };
const PASSWORD = "admin password 123";

function regionWorld(answers: Record<string, string | boolean | string[]> = {}) {
  const w = world({ "resend-setup": "skip", "default-account-email": "admin@example.com", "default-account-password": PASSWORD, "default-account-password-confirm": PASSWORD, "preview-account-password": PASSWORD, "preview-account-password-confirm": PASSWORD, ...answers }, ENV);
  w.deps.interactive = true;
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
  return w;
}

type World = ReturnType<typeof regionWorld>;

/** What the region question was offered as its starting answer. */
function spyRegionInitial(w: World): { initial: (string | undefined)[] } {
  const seen: { initial: (string | undefined)[] } = { initial: [] };
  const text = w.prompter.text.bind(w.prompter);
  w.prompter.text = async (input: { id: string; message: string; initial?: string }) => {
    if (input.id === "neon-region") seen.initial.push(input.initial);
    return text(input);
  };
  return seen;
}

describe("pnpm bootstrap product: database region", () => {
  it("asks the region once, before any project, with São Paulo as the start, and makes both projects there", async () => {
    const w = regionWorld({ "neon-region": "aws-eu-central-1" });
    const seen = spyRegionInitial(w);

    expect((await w.run("product", "example")).code).toBe(0);
    expect((await w.run("previews", "example")).code).toBe(0);

    expect(seen.initial).toEqual(["aws-sa-east-1"]);
    expect(w.prompter.asked.filter((id) => id === "neon-region")).toHaveLength(1);
    expect(w.github.variables.get("EXAMPLE_REGION")).toBe("aws-eu-central-1");
    expect(w.neon.projects.map((p) => [p.name, p.region])).toEqual([["example", "aws-eu-central-1"], ["example-preview", "aws-eu-central-1"]]);
    expect(w.github.variables.get("EXAMPLE_NEON_PROJECT_ID")).toBe("proj-1");
    expect(w.github.variables.get("EXAMPLE_PREVIEW_NEON_PROJECT_ID")).toBe("proj-2");
  });

  it("shows Neon's refusal, says how to choose another region and leaves no project or id behind", async () => {
    const w = regionWorld({ "neon-region": "aws-nowhere-1" });
    w.neon.refuseRegions.add("aws-nowhere-1");

    await expect(w.run("product", "example")).rejects.toThrow(/region aws-nowhere-1 is not supported[^]*--redo region/);
    expect(w.neon.projects).toEqual([]);
    expect(w.github.variables.has("EXAMPLE_NEON_PROJECT_ID")).toBe(false);

    w.neon.refuseRegions.clear();
    w.prompter.script("neon-region", "aws-sa-east-1");
    expect((await w.run("product", "example", "--redo", "region")).code).toBe(0);
    expect(w.neon.projects.map((p) => p.region)).toEqual(["aws-sa-east-1"]);
  });

  it("finds the project by its recorded id, so a same-name project elsewhere does not confuse it", async () => {
    const w = regionWorld({ "neon-region": "aws-sa-east-1" });
    await w.run("product", "example");
    w.neon.projects.unshift({ id: "proj-other", name: "example", region: "aws-us-east-2", orgId: "org-1", password: "x" });
    const before = w.neon.writes;
    w.prompter.asked.length = 0;

    const { code, output } = await w.run("product", "example");

    expect(code).toBe(0);
    expect(w.neon.writes).toBe(before);
    expect(w.prompter.asked).not.toContain("neon-project-pick");
    expect(output).toContain("Neon project example: already done (proj-1)");
  });
});

describe("pnpm bootstrap doctor: database region", () => {
  it("warns when the real region differs from the recorded one", async () => {
    const w = regionWorld({ "neon-region": "aws-sa-east-1" });
    await w.run("product", "example");
    w.neon.projects[0]!.region = "aws-us-east-2";

    const { output } = await w.run("doctor", "example");

    expect(output).toContain("database in aws-us-east-2, chosen aws-sa-east-1: the region does not change, recreate with `pnpm bootstrap destroy db example`");
  });

  it("is quiet about the region when it matches", async () => {
    const w = regionWorld({ "neon-region": "aws-sa-east-1" });
    await w.run("product", "example");

    const { output } = await w.run("doctor", "example");

    expect(output).not.toContain("recreate with");
  });
});

describe("pnpm bootstrap --redo region", () => {
  it("refuses while a project exists in another region and points to destroy db", async () => {
    const w = regionWorld({ "neon-region": "aws-sa-east-1" });
    await w.run("product", "example");
    w.prompter.script("neon-region", "aws-eu-central-1");

    await expect(w.run("product", "example", "--redo", "region")).rejects.toThrow("pnpm bootstrap destroy db example");
    expect(w.github.variables.get("EXAMPLE_REGION")).toBe("aws-sa-east-1");
  });
});

describe("pnpm bootstrap destroy db", () => {
  async function built() {
    const w = regionWorld({ "neon-region": "aws-us-east-2" });
    await w.run("product", "example");
    await w.run("previews", "example");
    w.cloudflare.workers.add("example");
    w.deps.env = { ...ENV };
    return w;
  }

  it("lists only the databases and their secrets, never the Worker, the environments, the lists or the main ruleset", async () => {
    const w = await built();
    w.github.rulesets.push({ id: 1, name: "main", target: "branch", enforcement: "active", include: ["~DEFAULT_BRANCH"], rules: [], requiredChecks: [], strict: true });
    w.prompter.script("destroy-confirm", "no");

    const { output } = await w.run("destroy", "db", "example");

    expect(output).toContain("Neon project example (proj-1)");
    expect(output).toContain("Neon project example-preview (proj-2)");
    for (const name of ["EXAMPLE_DATABASE_URL", "EXAMPLE_DATABASE_URL_POOLED", "EXAMPLE_PREVIEW_NEON_API_KEY", "EXAMPLE_ACCOUNT_PASSWORD", "EXAMPLE_ACCOUNT_EMAIL", "EXAMPLE_NEON_PROJECT_ID", "EXAMPLE_PREVIEW_NEON_PROJECT_ID"]) expect(output).toContain(name);
    expect(output).not.toMatch(/Cloudflare:|- environment|DEPLOY_PRODUCTS|PREVIEW_PRODUCTS|ruleset|KV namespace/i);
    expect(w.neon.projects).toHaveLength(2);
  });

  it("deletes the databases and their secrets, keeps the rest, and the next product run asks the account again in the new region", async () => {
    const w = await built();
    w.prompter.script("destroy-confirm", "example");

    const { code } = await w.run("destroy", "db", "example");

    expect(code).toBe(0);
    expect(w.neon.projects).toEqual([]);
    const env = w.github.environmentSecrets.get("example-production")!;
    expect([...env.keys()]).toEqual(["EXAMPLE_BETTER_AUTH_SECRET"]);
    expect(w.github.environments.has("example-production")).toBe(true);
    expect(w.github.environments.has("example-preview")).toBe(true);
    expect(w.github.variables.get("DEPLOY_PRODUCTS")).toBe("example");
    expect(w.cloudflare.workers.has("example")).toBe(true);
    for (const name of ["EXAMPLE_ACCOUNT_EMAIL", "EXAMPLE_NEON_PROJECT_ID", "EXAMPLE_PREVIEW_NEON_PROJECT_ID"]) expect(w.github.variables.has(name)).toBe(false);

    // Another region this time: the region step is redone, then the account is asked again.
    w.prompter.script("neon-region", "aws-sa-east-1");
    w.prompter.asked.length = 0;
    expect((await w.run("product", "example", "--redo", "region")).code).toBe(0);
    expect((await w.run("previews", "example")).code).toBe(0);

    expect(w.neon.projects.map((p) => [p.name, p.region])).toEqual([["example", "aws-sa-east-1"], ["example-preview", "aws-sa-east-1"]]);
    expect(w.prompter.asked).toEqual(expect.arrayContaining(["default-account-email", "default-account-password"]));
    expect(w.github.variables.get("EXAMPLE_ACCOUNT_EMAIL")).toBe("admin@example.com");
    expect(env.get("EXAMPLE_ACCOUNT_PASSWORD")).toBe(PASSWORD);
    const url = env.get("EXAMPLE_DATABASE_URL")!;
    expect(w.accounts.databases.get(url)?.migrated).toBe(true);
    expect(w.accounts.databases.get(url)?.users.has("admin@example.com")).toBe(true);
  });
});
