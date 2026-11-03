import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { TOKEN, world, seedCloudflare } from "./helpers.ts";

// Seam 1: every question for a service key is preceded by a link that opens its creation. Account passwords are not keys.
const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1" };
const ACCOUNT_PASSWORDS = new Set(["default-account-password", "default-account-password-confirm", "preview-account-password", "preview-account-password-confirm"]);

/** The key questions of a run that have no `link` since the previous question (or the start). */
function unlinkedKeyQuestions(sequence: string[]): string[] {
  const missing: string[] = [];
  let linked = false;
  for (const entry of sequence) {
    if (entry.startsWith("link:")) linked = true;
    else if (entry.startsWith("password:")) {
      const id = entry.slice("password:".length);
      if (!ACCOUNT_PASSWORDS.has(id) && !linked) missing.push(id);
      linked = false;
    }
  }
  return missing;
}

function keyWorld(answers: Record<string, string | boolean | string[]>, env: Record<string, string | undefined> = ENV) {
  const w = world({ "resend-setup": "skip", "default-account-email": "admin@example.com", "default-account-password": "admin password 123", "default-account-password-confirm": "admin password 123", "preview-account-password": "preview password 1", "preview-account-password-confirm": "preview password 1", ...answers }, env);
  w.deps.interactive = true;
  w.github.variables.set("EXAMPLE_ACCOUNT_EMAIL", "admin@example.com");
  seedCloudflare(w.github, TOKEN);
  w.cloudflare.subdomains.set("acc-1", "my-team");
  for (const label of labelSpecs(w.deps.config)) w.github.labels.set(label.name, label);
  w.github.environments.set("production", "main");
  w.github.environments.set("preview", "main");
  return w;
}

describe("key questions come with a creation link", () => {
  it("catches a key question without a link", () => {
    expect(unlinkedKeyQuestions(["password:resend-key", "link:https://x", "password:other-key", "password:default-account-password"])).toEqual(["resend-key"]);
  });

  it("bootstrap domain: the Resend key", async () => {
    const w = keyWorld({ "resend-setup": "now", "resend-key": "re-full" }, { ...ENV, RESEND_API_KEY: undefined });
    await w.run("domain", "example");
    expect(w.prompter.sequence).toContain("password:resend-key");
    expect(unlinkedKeyQuestions(w.prompter.sequence)).toEqual([]);
    expect(w.prompter.printed.join("\n")).toContain("example-bootstrap");
  });

  it("bootstrap previews: the pasted Neon key, with the organization's keys page and the project", async () => {
    const w = keyWorld({ "preview-neon-key": "napi_pasted_value_123" });
    w.neon.refuseApiKeys = true;
    await w.run("previews", "example");
    expect(w.prompter.sequence).toContain("password:preview-neon-key");
    expect(unlinkedKeyQuestions(w.prompter.sequence)).toEqual([]);
    const shown = w.prompter.printed.join("\n");
    expect(shown).toContain("/settings/api-keys");
    expect(shown).toContain("example-preview");
  });

  it("doctor: the Resend and Stripe keys", async () => {
    const w = keyWorld({ "stripe-sandbox-key-check": "", "stripe-live-key-check": "", "resend-key": "" });
    w.github.variables.set("EXAMPLE_BILLING_PLANS", "[]");
    await w.run("doctor", "example");
    expect(w.prompter.sequence).toEqual(expect.arrayContaining(["password:resend-key", "password:stripe-sandbox-key-check"]));
    expect(unlinkedKeyQuestions(w.prompter.sequence)).toEqual([]);
  });
});

describe("every key question in the source has a link just above it", () => {
  const dir = new URL("../../src/bootstrap/", import.meta.url);
  const WINDOW = 8; // lines above the question where the link call must be
  it("finds no `password({ id: ... })` for a service key without `link(` or `showResendKeyLink(` before it", () => {
    const missing: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const lines = readFileSync(new URL(file, dir), "utf8").split("\n");
      lines.forEach((line, i) => {
        const id = /\.password\(\{ id: [`"]([^`"]+)[`"]/.exec(line)?.[1];
        if (!id || /account-password|-confirm$/.test(id)) return;
        const above = lines.slice(Math.max(0, i - WINDOW), i).join("\n");
        if (!/\.link\(|showResendKeyLink\(/.test(above)) missing.push(`${file}:${i + 1} ${id}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
