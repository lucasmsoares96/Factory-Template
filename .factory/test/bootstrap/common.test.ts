import { describe, expect, it } from "vitest";
import { TOKEN, staticLabelNames, world } from "./helpers.ts";

describe("pnpm bootstrap (common part)", () => {
  it("sets up Cloudflare and the labels on a fresh repo", async () => {
    const w = world();

    const { code } = await w.run();

    expect(code).toBe(0);
    expect([...w.github.secrets.keys()].sort()).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
    expect(w.github.secrets.get("CLOUDFLARE_API_TOKEN")).toBe(TOKEN);
    expect(w.github.secrets.get("CLOUDFLARE_ACCOUNT_ID")).toBe("acc-1");
    expect(w.cloudflare.subdomains.get("acc-1")).toBe("my-team");
    expect([...w.github.labels.keys()].sort()).toEqual([...staticLabelNames].sort());
    for (const label of w.github.labels.values()) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(0);
    }
  });

  it("points at the token template URL and never prints the token", async () => {
    const w = world();

    await w.run();

    const url = w.prompter.notes.join("\n");
    expect(url).toContain("https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=");
    expect(decodeURIComponent(url)).toContain('"key":"workers_scripts","type":"edit"');
    expect(JSON.stringify([w.lines, w.prompter.notes])).not.toContain(TOKEN);
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
    again.github.secrets.set("CLOUDFLARE_API_TOKEN", TOKEN);
    again.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
    again.cloudflare.validTokens.add("new-token");

    await again.run("--redo", "cloudflare-token");

    expect(again.github.secrets.get("CLOUDFLARE_API_TOKEN")).toBe("new-token");
  });

  it("lists the valid steps when --redo names an unknown one", async () => {
    const w = world();

    await expect(w.run("--redo", "nope")).rejects.toThrow(/cloudflare-token.*workers-dev.*labels/s);
  });
});
