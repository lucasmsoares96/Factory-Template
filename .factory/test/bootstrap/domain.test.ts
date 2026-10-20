import { describe, expect, it } from "vitest";
import { TOKEN, world } from "./helpers.ts";

const ENV = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1", RESEND_API_KEY: "re-full" };

function domainWorld(answers: Record<string, string | boolean> = {}, env: Record<string, string | undefined> = ENV) {
  return world({ "resend-domain-action": "create", ...answers }, env);
}

describe("pnpm bootstrap domain: resend-domain", () => {
  it("creates the sending domain in Resend when it is missing", async () => {
    const w = domainWorld();

    const { code } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(w.resend.domains.map((d) => d.name)).toEqual(["example.com"]);
  });

  it("creates nothing on the second run", async () => {
    const w = domainWorld();
    await w.run("domain", "example");
    const before = { resend: w.resend.writes, cloudflare: w.cloudflare.writes, github: w.github.writes };

    const { code, output } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(output).toContain("Resend sending domain: already done");
    expect({ resend: w.resend.writes, cloudflare: w.cloudflare.writes, github: w.github.writes }).toEqual(before);
  });

  it("asks for the Resend key when it is not in the environment, and does not keep it", async () => {
    const w = domainWorld({ "resend-key": "re-full" }, { ...ENV, RESEND_API_KEY: undefined });

    await w.run("domain", "example");

    expect(w.prompter.asked).toContain("resend-key");
    expect(w.resend.domains).toHaveLength(1);
    expect(JSON.stringify([w.lines, w.prompter.notes, [...w.github.secrets.values()]])).not.toContain("re-full");
  });

  it("can be deferred: the Product stays on the outbox and nothing is recorded", async () => {
    const w = domainWorld({ "resend-domain-action": "skip" });

    const { code, output } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(output).toContain("Resend domain deferred");
    expect(w.resend.domains).toEqual([]);
    expect(w.resend.writes + w.cloudflare.writes + w.github.writes).toBe(0);
  });

  it("redoes a step by name and refuses unknown ones", async () => {
    const w = domainWorld();
    await w.run("domain", "example");

    const redo = await w.run("domain", "example", "--redo", "resend-domain");
    expect(redo.output).toContain("Resend sending domain: redoing");
    expect(w.resend.domains).toHaveLength(1);

    await expect(w.run("domain", "example", "--redo", "nope")).rejects.toThrow(/Unknown step: nope/);
  });

  it("asks for the domain when product.config.ts leaves it empty, and says where to set it", async () => {
    const w = domainWorld({ "product-domain": "acme.dev" });
    w.products.set("example", { ...w.products.get("example")!, domain: "" });

    await w.run("domain", "example");

    expect(w.prompter.notes.join("\n")).toContain("apps/example/product.config.ts");
    expect(w.resend.domains.map((d) => d.name)).toEqual(["acme.dev"]);
  });

  it("refuses an unknown Product", async () => {
    const w = domainWorld();

    const { code, output } = await w.run("domain", "ghost");

    expect(code).toBe(1);
    expect(output).toContain("No Product at apps/ghost");
  });
});

describe("pnpm bootstrap domain: dns-records", () => {
  function withZone(w: ReturnType<typeof domainWorld>) {
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });
    return w;
  }

  it("creates the DKIM, SPF and MX records Resend asks for, unproxied, then verifies", async () => {
    const w = withZone(domainWorld());

    const { code, output } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(w.cloudflare.created.map((r) => [r.type, r.name, r.proxied])).toEqual([
      ["TXT", "resend._domainkey.example.com", false],
      ["MX", "send.example.com", false],
      ["TXT", "send.example.com", false],
    ]);
    expect(w.cloudflare.created.find((r) => r.type === "MX")?.priority).toBe(10);
    expect(w.resend.verifyCalls).toBe(1);
    expect(output).toContain("Resend verification: verified");
  });

  it("creates nothing on the second run", async () => {
    const w = withZone(domainWorld());
    await w.run("domain", "example");
    const before = [w.resend.writes, w.cloudflare.writes, w.resend.verifyCalls];

    const { output } = await w.run("domain", "example");

    expect(output).toContain("DNS records in Cloudflare: already done");
    expect([w.resend.writes, w.cloudflare.writes, w.resend.verifyCalls]).toEqual(before);
  });

  it("never overwrites or deletes an existing record, only adds the missing ones", async () => {
    const w = withZone(domainWorld());
    w.cloudflare.dnsRecords.set("zone-1", [
      { type: "TXT", name: "send.example.com", content: "v=spf1 include:other.example ~all" },
      { type: "A", name: "example.com", content: "192.0.2.1" },
    ]);

    const { output } = await w.run("domain", "example");

    expect(w.cloudflare.created.map((r) => `${r.type} ${r.name}`)).toEqual(["TXT resend._domainkey.example.com", "MX send.example.com"]);
    expect(w.cloudflare.dnsRecords.get("zone-1")).toContainEqual({ type: "TXT", name: "send.example.com", content: "v=spf1 include:other.example ~all" });
    expect(output).toContain("left alone");
  });

  it("polls a bounded number of times while Resend is still pending, and says what to do next", async () => {
    const w = withZone(domainWorld());
    w.resend.verifyResult = "pending";

    const { code, output } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(output.match(/Resend verification: pending/g)).toHaveLength(6);
    expect(output).toContain("--redo dns-records");
  });

  it("falls back to printing the records, one unwrapped line each, when the zone is not in the account", async () => {
    const w = domainWorld();

    const { code, output } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(w.cloudflare.writes).toBe(0);
    expect(w.resend.verifyCalls).toBe(0);
    expect(output).toContain("TXT  resend._domainkey  p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC-fake");
    expect(output).toContain("MX  send  feedback-smtp.us-east-1.amazonses.com  priority 10");
    expect(w.prompter.notes.join("\n")).not.toContain("MIGfMA0");
  });

  it("finds the parent zone of a subdomain", async () => {
    const w = domainWorld();
    w.products.set("example", { ...w.products.get("example")!, domain: "app.acme.dev" });
    w.cloudflare.zones.push({ id: "zone-2", name: "acme.dev" });

    await w.run("domain", "example");

    expect(w.cloudflare.created.map((r) => r.name)).toContain("send.acme.dev");
  });

  it("does nothing here when the Resend domain was deferred", async () => {
    const w = withZone(domainWorld({ "resend-domain-action": "skip" }));

    const { output } = await w.run("domain", "example");

    expect(output).toContain("DNS records in Cloudflare: already done");
    expect(w.cloudflare.writes).toBe(0);
  });
});

describe("pnpm bootstrap domain: restricted-resend-key", () => {
  it("stores a sending-only key for the domain as <ID>_RESEND_API_KEY and never prints it", async () => {
    const w = domainWorld();

    const { output } = await w.run("domain", "example");

    expect(w.resend.keys).toEqual([{ name: "example", domainId: "dom-1", token: "re_restricted_1" }]);
    expect(w.github.secrets.get("EXAMPLE_RESEND_API_KEY")).toBe("re_restricted_1");
    expect(JSON.stringify([output, w.prompter.notes])).not.toContain("re_restricted_1");
  });

  it("prefixes the secret with the upper-cased id, dashes as underscores", async () => {
    const w = domainWorld();
    w.products.set("my-app", { id: "my-app", title: "My app", emailFrom: "My <a@my-app.dev>", domain: "my-app.dev" });

    await w.run("domain", "my-app");

    expect([...w.github.secrets.keys()]).toEqual(["MY_APP_RESEND_API_KEY"]);
  });

  it("creates no second key when the secret exists", async () => {
    const w = domainWorld();
    await w.run("domain", "example");

    await w.run("domain", "example");

    expect(w.resend.keys).toHaveLength(1);
  });

  it("makes a new key with --redo and replaces the secret", async () => {
    const w = domainWorld();
    await w.run("domain", "example");

    await w.run("domain", "example", "--redo", "restricted-resend-key");

    expect(w.resend.keys).toHaveLength(2);
    expect(w.github.secrets.get("EXAMPLE_RESEND_API_KEY")).toBe("re_restricted_2");
  });

  it("makes no key while the Resend domain is deferred", async () => {
    const w = domainWorld({ "resend-domain-action": "skip" });

    await w.run("domain", "example");

    expect(w.resend.keys).toEqual([]);
    expect(w.github.secrets.size).toBe(0);
  });
});

describe("pnpm bootstrap domain: worker-domain", () => {
  function deployed(w: ReturnType<typeof domainWorld>) {
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });
    w.cloudflare.workers.add("example");
    return w;
  }

  it("attaches the Product's domain as a Custom Domain of the Worker named after its id", async () => {
    const w = deployed(domainWorld());

    const { code } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(w.cloudflare.workerDomains).toEqual([{ hostname: "example.com", service: "example", zoneId: "zone-1" }]);
  });

  it("attaches nothing on the second run", async () => {
    const w = deployed(domainWorld());
    await w.run("domain", "example");
    const writes = w.cloudflare.writes;

    const { output } = await w.run("domain", "example");

    expect(output).toContain("Worker Custom Domain: already done");
    expect(w.cloudflare.writes).toBe(writes);
    expect(w.cloudflare.workerDomains).toHaveLength(1);
  });

  it("says to deploy first, instead of failing, when the Worker does not exist", async () => {
    const w = domainWorld();
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });

    const { code, output } = await w.run("domain", "example");

    expect(code).toBe(0);
    expect(output).toContain("deploy the Product first, then run `pnpm bootstrap domain example --redo worker-domain`");
    expect(w.cloudflare.workerDomains).toEqual([]);
  });

  it("attaches after the Worker appears, with --redo worker-domain", async () => {
    const w = domainWorld();
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });
    await w.run("domain", "example");
    w.cloudflare.workers.add("example");

    await w.run("domain", "example", "--redo", "worker-domain");

    expect(w.cloudflare.workerDomains).toHaveLength(1);
  });

  it("explains when the zone is not in the account", async () => {
    const w = domainWorld();
    w.cloudflare.workers.add("example");

    const { output } = await w.run("domain", "example");

    expect(output).toContain("not in this Cloudflare account");
    expect(w.cloudflare.workerDomains).toEqual([]);
  });
});

describe("pnpm bootstrap doctor <id>: domain section", () => {
  function ready() {
    const w = domainWorld();
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });
    w.cloudflare.workers.add("example");
    return w;
  }

  it("shows everything ok after the domain command, reading only", async () => {
    const w = ready();
    await w.run("domain", "example");
    await w.run();
    const writes = [w.github.writes, w.cloudflare.writes, w.resend.writes];
    w.prompter.asked.length = 0;

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(0);
    expect(output).toContain("Domain (example)");
    expect(output).toMatch(/ok\s+Resend domain\s+example\.com: verified/);
    expect(output).toMatch(/ok\s+DNS records/);
    expect(output).toMatch(/ok\s+Worker Custom Domain/);
    expect(output).toMatch(/ok\s+EXAMPLE_RESEND_API_KEY/);
    expect([w.github.writes, w.cloudflare.writes, w.resend.writes]).toEqual(writes);
    expect(w.prompter.asked).toEqual([]);
  });

  it("shows what is off before anything ran, without failing the doctor", async () => {
    const w = ready();
    await w.run();

    const { code, output } = await w.run("doctor", "example");

    expect(code).toBe(0);
    expect(output).toMatch(/off\s+Resend domain/);
    expect(output).toMatch(/skip\s+DNS records/);
    expect(output).toMatch(/warn\s+Worker Custom Domain\s+not attached/);
    expect(output).toMatch(/off\s+EXAMPLE_RESEND_API_KEY/);
  });

  it("flags missing DNS records and a Resend domain that is not verified", async () => {
    const w = ready();
    w.resend.verifyResult = "pending";
    await w.run("domain", "example");
    w.cloudflare.dnsRecords.set("zone-1", []);

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/warn\s+Resend domain\s+example\.com: pending/);
    expect(output).toMatch(/warn\s+DNS records\s+3 missing/);
  });

  it("says to deploy first when the Worker is not there", async () => {
    const w = domainWorld();
    w.cloudflare.zones.push({ id: "zone-1", name: "example.com" });

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/off\s+Worker Custom Domain\s+.*deploy the Product first.*--redo worker-domain/);
  });

  it("says to set the domain in product.config.ts when it is empty", async () => {
    const w = domainWorld();
    w.products.set("example", { ...w.products.get("example")!, domain: "" });

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/off\s+Domain\s+.*apps\/example\/product\.config\.ts/);
  });

  it("fails on an unknown Product", async () => {
    const w = domainWorld();

    const { code, output } = await w.run("doctor", "ghost");

    expect(code).toBe(1);
    expect(output).toContain("No Product at apps/ghost");
  });
});
