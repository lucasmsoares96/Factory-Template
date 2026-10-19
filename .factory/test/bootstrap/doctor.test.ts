import { describe, expect, it } from "vitest";
import { TOKEN, world } from "./helpers.ts";

describe("pnpm bootstrap doctor", () => {
  it("fails on an empty repo and lists what is missing, writing nothing", async () => {
    const w = world();

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toContain("CLOUDFLARE_API_TOKEN");
    expect(output).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(output).toContain("ready-for-agent");
    expect(w.github.writes + w.cloudflare.writes).toBe(0);
    expect(w.prompter.asked).toEqual([]);
  });

  it("passes after the wizard and shows what is still switched off", async () => {
    const w = world();
    await w.run();

    const { code, output } = await w.run("doctor");

    expect(code).toBe(0);
    expect(output).toMatch(/off\s+DEPLOY_ENABLED/);
    expect(output).toMatch(/off\s+PREVIEWS_ENABLED/);
    expect(output).toMatch(/off\s+FACTORY_ENABLED/);
  });

  it("shows a module as on when its variable is true", async () => {
    const w = world();
    await w.run();
    w.github.variables.set("DEPLOY_ENABLED", "true");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/ok\s+DEPLOY_ENABLED/);
  });

  it("warns when both Claude auths exist", async () => {
    const w = world();
    await w.run();
    w.github.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "x");
    w.github.secrets.set("ANTHROPIC_API_KEY", "y");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/warn\s+Claude auth/);
    expect(output).toContain("ANTHROPIC_API_KEY wins");
  });

  it("notes that the secrets fall back to the repo when environments are unavailable", async () => {
    const w = world();
    await w.run();
    w.github.variables.set("FACTORY_USE_ENVIRONMENTS", "false");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/off\s+Environments/);
  });

  it("checks workers.dev when the token is in the environment, and flags a missing one", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    await w.run();
    w.cloudflare.subdomains.clear();

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+workers\.dev/);
    expect(w.cloudflare.writes).toBe(1);
  });

  it("does not check workers.dev without a token and says so", async () => {
    const w = world();
    await w.run();

    const { output } = await w.run("doctor");

    expect(output).toMatch(/skip\s+workers\.dev/);
  });

  it("reports a permission that cannot manage the repo", async () => {
    const w = world();
    await w.run();
    w.github.info = { ...w.github.info, viewerPermission: "WRITE" };

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+Repo permission/);
  });
});
