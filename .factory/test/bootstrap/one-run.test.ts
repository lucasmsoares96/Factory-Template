import { describe, expect, it } from "vitest";
import { TOKEN, world } from "./helpers.ts";

const everything = (w: ReturnType<typeof world>) => [w.lines.join("\n"), ...w.prompter.notes, ...w.prompter.printed].join("\n");

describe("one run is enough", () => {
  it("a wizard run with the token pasted ends with workers.dev checked and no skip", async () => {
    const w = world();
    w.deps.interactive = true;
    w.cloudflare.subdomains.set("acc-1", "my-team");

    const { code, output } = await w.run();

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+workers\.dev\s+my-team/);
    expect(output).not.toMatch(/\bskip\b/);
    expect(output).not.toContain("Run `pnpm bootstrap doctor`");
    expect(w.prompter.asked.filter((id) => id === "cloudflare-token")).toHaveLength(1);
    expect(output).not.toContain(TOKEN);
  });

  it("registers the subdomain in the wizard and the final doctor sees it", async () => {
    const w = world();

    const { code, output } = await w.run();

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+workers\.dev\s+my-team/);
    expect(output).not.toMatch(/\bskip\b/);
  });

  it("a second run with the token in the environment is ok too", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    await w.run();

    const { code, output } = await w.run();

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+workers\.dev/);
    expect(output).not.toMatch(/\bskip\b/);
  });

  it("a second run without the token in the environment asks once, in a terminal, instead of skipping", async () => {
    const w = world();
    await w.run();
    w.deps.interactive = true;
    w.prompter.asked.length = 0;

    const { code, output } = await w.run();

    expect(code).toBe(0);
    expect(w.prompter.asked).toEqual(["cloudflare-token"]);
    expect(output).toMatch(/ok\s+workers\.dev/);
    expect(output).not.toMatch(/\bskip\b/);
  });

  it("exits non-zero when the final doctor finds something missing", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    w.github.info = { ...w.github.info, viewerPermission: "WRITE" };

    const { code, output } = await w.run();

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+Repo permission/);
  });

  it("`domain <id>` ends with the doctor too, using the Resend key and token it was given", async () => {
    const w = world({ "resend-key": "re-full", "resend-domain-action": "create" });
    w.deps.interactive = true;
    await w.run();
    w.prompter.asked.length = 0;

    const { output } = await w.run("domain", "example");

    expect(output).toContain("Domain (example)");
    expect(output).not.toContain("Run `pnpm bootstrap doctor");
    expect(output).not.toMatch(/skip\s+(Resend domain|Worker Custom Domain|DNS records)\s+export/);
    expect(w.prompter.asked.filter((id) => id === "resend-key")).toHaveLength(1);
    expect(output).not.toContain("re-full");
  });
});

describe("standalone doctor", () => {
  it("in a terminal, asks for the token once, checks it read-only and stores nothing", async () => {
    const w = world();
    await w.run();
    w.deps.interactive = true;
    w.prompter.asked.length = 0;
    const secrets = new Map(w.github.secrets);
    w.github.writes = 0;
    w.cloudflare.writes = 0;

    const { code, output } = await w.run("doctor");

    expect(code).toBe(0);
    expect(w.prompter.asked).toEqual(["cloudflare-token"]);
    expect(output).toMatch(/ok\s+workers\.dev/);
    expect(w.github.writes + w.cloudflare.writes).toBe(0);
    expect(w.github.secrets).toEqual(secrets);
    expect(everything(w)).not.toContain(TOKEN);
  });

  it("a token without a needed permission is refused and named, never used", async () => {
    const w = world({ "cloudflare-token": [TOKEN, "weak"] });
    await w.run();
    w.cloudflare.validTokens.add("weak");
    w.cloudflare.deny("weak", "workers");
    w.deps.interactive = true;

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+workers\.dev/);
    expect(output).toContain("Workers Scripts");
  });

  it("without a terminal keeps skip and asks nothing", async () => {
    const w = world();
    await w.run();
    w.prompter.asked.length = 0;

    const { code, output } = await w.run("doctor");

    expect(code).toBe(0);
    expect(output).toMatch(/skip\s+workers\.dev\s+export CLOUDFLARE_API_TOKEN to check it/);
    expect(w.prompter.asked).toEqual([]);
  });

  it("per Product, in a terminal, asks for the Resend key once and never prints it", async () => {
    const w = world({ "resend-key": "re-full" }, { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "acc-1" });
    await w.run();
    w.deps.interactive = true;
    w.prompter.asked.length = 0;

    const { output } = await w.run("doctor", "example");

    expect(w.prompter.asked).toEqual(["resend-key"]);
    expect(output).not.toMatch(/skip\s+Resend domain/);
    expect(everything(w)).not.toContain("re-full");
  });

  it("per Product, without a terminal, keeps skip for the Resend check", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    await w.run();
    w.prompter.asked.length = 0;

    const { output } = await w.run("doctor", "example");

    expect(output).toMatch(/skip\s+Resend domain\s+export RESEND_API_KEY/);
    expect(w.prompter.asked).toEqual([]);
  });
});
