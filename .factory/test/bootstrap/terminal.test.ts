import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { QUESTIONS } from "../../src/bootstrap/questions.ts";
import { TOKEN, world } from "./helpers.ts";

// Seam 8 for the run without a terminal: the CLI against the fake clients, the environment standing in for the person.
const COMMON_ENV = { CLOUDFLARE_API_TOKEN: TOKEN, WORKERS_DEV_SUBDOMAIN: "my-team", FACTORY_LANGUAGE: "en" };

describe("pnpm bootstrap without a terminal", () => {
  it("fails before the first step and lists every missing variable, not only the first", async () => {
    const w = world();
    w.deps.interactive = false;

    const { code, output } = await w.run();

    expect(code).toBe(1);
    for (const name of ["CLOUDFLARE_API_TOKEN", "WORKERS_DEV_SUBDOMAIN", "FACTORY_LANGUAGE"]) expect(output).toContain(name);
    expect(w.github.secrets.size).toBe(0);
    expect(w.github.labels.size).toBe(0);
    expect(w.prompter.asked).toEqual([]);
  });

  it("lists only what the steps with work still need", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    w.deps.interactive = false;
    w.github.variables.set("FACTORY_LANGUAGE", "en");

    const { code, output } = await w.run();

    expect(code).toBe(1);
    expect(output).toContain("WORKERS_DEV_SUBDOMAIN");
    expect(output).not.toContain("FACTORY_LANGUAGE ");
  });

  it("runs to the end with every variable set, asking nobody", async () => {
    const w = world({}, COMMON_ENV);
    w.deps.interactive = false;

    const { code } = await w.run();

    expect(code).toBe(0);
    expect(w.github.secrets.get("CLOUDFLARE_API_TOKEN")).toBe(TOKEN);
    expect(w.github.variables.get("FACTORY_LANGUAGE")).toBe("en");
    expect(w.prompter.asked).toEqual([]);
  });

  it("lists the Product's account variables, and runs the Production module once they are set", async () => {
    const bare = world();
    bare.deps.interactive = false;
    const refused = await bare.run("product", "example");
    expect(refused.code).toBe(1);
    expect(refused.output).toContain("DEFAULT_ACCOUNT_EMAIL");
    expect(refused.output).toContain("DEFAULT_ACCOUNT_PASSWORD");
    expect(bare.prompter.asked).toEqual([]);

    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", DEFAULT_ACCOUNT_EMAIL: "a@example.com", DEFAULT_ACCOUNT_PASSWORD: "admin password 123" });
    w.deps.interactive = false;
    w.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
    w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
    w.cloudflare.subdomains.set("acc-1", "my-team");
    for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
    const { code } = await w.run("product", "example");
    expect(code).toBe(0);
    expect(w.github.environmentSecrets.get("example-production")?.get("EXAMPLE_ACCOUNT_PASSWORD")).toBe("admin password 123");
    expect(w.prompter.asked).toEqual([]);
  });
});

describe("pnpm bootstrap env", () => {
  it("lists the variables of the common part", async () => {
    const w = world();

    const { code, output } = await w.run("env");

    expect(code).toBe(0);
    for (const name of ["CLOUDFLARE_API_TOKEN", "WORKERS_DEV_SUBDOMAIN", "FACTORY_LANGUAGE", "FACTORY_TOKEN"]) expect(output).toContain(name);
    expect(output).not.toContain("DEFAULT_ACCOUNT_EMAIL");
    expect(output).not.toContain("STRIPE_LIVE_KEY");
  });

  it("lists the modules of the Product with its id", async () => {
    const w = world();

    const { code, output } = await w.run("env", "example");

    expect(code).toBe(0);
    for (const name of ["CLOUDFLARE_API_TOKEN", "DEFAULT_ACCOUNT_EMAIL", "DEFAULT_ACCOUNT_PASSWORD", "PREVIEW_ACCOUNT_PASSWORD", "STRIPE_LIVE_KEY", "BILLING_CURRENCY"]) expect(output).toContain(name);
  });

  it("names an unknown Product", async () => {
    const { code, output } = await world().run("env", "nope");

    expect(code).toBe(1);
    expect(output).toContain("No Product at apps/nope");
  });
});

describe("the declaration of the questions", () => {
  it("ties every question to a variable, unless only a person can answer it", () => {
    for (const [id, question] of Object.entries(QUESTIONS)) {
      expect(question.purpose, id).not.toBe("");
      if (question.kind === "terminal") expect(question.env, id).toBeNull();
      else expect(question.env, id).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it("declares every id the wizard's code asks", () => {
    const dir = resolve(import.meta.dirname, "../../src/bootstrap");
    const code = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "questions.ts")
      .map((f) => readFileSync(resolve(dir, f), "utf8"))
      .join("\n");
    const asked = [...code.matchAll(/prompter\.(?:text|password|select|confirm|choose)(?:<[^>]*>)?\(\{\s*id: "([^"]+)"/g)].map((m) => m[1]!);
    expect(asked.length).toBeGreaterThan(20);
    for (const id of asked) expect(Object.keys(QUESTIONS), `question "${id}" has no declaration`).toContain(id);
  });
});
