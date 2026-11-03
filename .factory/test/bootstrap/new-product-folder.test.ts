import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world, seedCloudflare } from "./helpers.ts";

// Seam 1: `pnpm bootstrap product <id>` against the fake clients; the folder is rendered into a temporary directory.
const ACCOUNT = { "resend-setup": "skip", "default-account-email": "a@example.com", "default-account-password": "admin password 123", "default-account-password-confirm": "admin password 123" };
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", NEON_REGION: "aws-sa-east-1", DEFAULT_ACCOUNT_EMAIL: "a@example.com", DEFAULT_ACCOUNT_PASSWORD: "admin password 123" };

function ready(w: ReturnType<typeof world>) {
  seedCloudflare(w.github, TOKEN);
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
}

describe("pnpm bootstrap product <id> with no folder", () => {
  it("creates the folder from the answers and goes on to the Product's steps, warning that it is not in git", async () => {
    const w = world({ ...ACCOUNT, "product-title": "Notes App", "product-domain": "notes.example.com" }, ENV);
    w.deps.interactive = true;
    ready(w);

    const { code, output } = await w.run("product", "notes");

    expect(code).toBe(0);
    expect(w.prompter.asked).toContain("product-title");
    expect(w.created).toHaveLength(1);
    const [made] = w.created;
    expect(made).toMatchObject({ id: "notes", title: "Notes App", domain: "notes.example.com" });
    expect(readFileSync(join(made!.dir, "product.config.ts"), "utf8")).toContain("Notes App");
    expect(w.github.environmentSecrets.get("production")?.get("NOTES_ACCOUNT_PASSWORD")).toBe("admin password 123");
    expect(output).toContain("apps/notes/ is not in git yet");
    expect(output).toContain("pnpm-lock.yaml");
    expect(output).toContain("gh workflow run factory-deploy.yml --ref main");
  });

  it("reads --title and --domain without asking", async () => {
    const w = world({}, ENV);
    w.deps.interactive = false;
    ready(w);

    const { code } = await w.run("product", "notes", "--title", "Notes App", "--domain", "notes.example.com");

    expect(code).toBe(0);
    expect(w.created[0]).toMatchObject({ title: "Notes App", domain: "notes.example.com" });
    expect(w.prompter.asked).toEqual([]);
  });

  it("without a terminal and without the flags, fails before the first step listing what is missing", async () => {
    const w = world({}, ENV);
    w.deps.interactive = false;
    ready(w);

    const { code, output } = await w.run("product", "notes");

    expect(code).toBe(1);
    expect(output).toContain("PRODUCT_TITLE");
    expect(output).toContain("PRODUCT_DOMAIN");
    expect(w.created).toEqual([]);
    expect([...w.github.environmentSecrets.values()].flatMap((secrets) => [...secrets.keys()]).filter((name) => !name.startsWith("CLOUDFLARE_"))).toEqual([]);
    expect(w.prompter.asked).toEqual([]);
  });

  it.each(["Notes", "my notes", "a--b", "a-"])("refuses the id %j before creating anything", async (id) => {
    const w = world({}, ENV);
    w.deps.interactive = true;
    ready(w);

    const { code, output } = await w.run("product", id, "--title", "T", "--domain", "t.com");

    expect(code).toBe(1);
    expect(output).toContain("Invalid Product id");
    expect(w.created).toEqual([]);
    expect(w.prompter.asked).toEqual([]);
  });

  it("leaves an existing folder alone and says nothing about git", async () => {
    const w = world(ACCOUNT, ENV);
    w.deps.interactive = true;
    ready(w);

    const { code, output } = await w.run("product", "example", "--title", "Other");

    expect(code).toBe(0);
    expect(w.created).toEqual([]);
    expect(output).not.toContain("not in git yet");
  });
});
