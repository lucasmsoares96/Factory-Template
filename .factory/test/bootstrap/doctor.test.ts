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

  it("shows the language of the Factory's public text, and that it is unset", async () => {
    const w = world({ "factory-language": "pt-BR" });
    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_LANGUAGE.*not set: the Factory writes in en; `pnpm bootstrap` asks it/);

    await w.run();

    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_LANGUAGE.*pt-BR/);
  });

  it("warns about a language the Factory does not know", async () => {
    const w = world();
    w.github.variables.set("FACTORY_LANGUAGE", "pt");
    expect((await w.run("doctor")).output).toMatch(/warn\s+FACTORY_LANGUAGE.*pt is not one of en, pt-BR: every Factory job fails; run `pnpm bootstrap --redo language`/);
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

  it("does not re-check workers.dev without a saved Cloudflare login, and says the secrets stand in", async () => {
    const w = world();
    await w.run();

    const { output } = await w.run("doctor");

    expect(output).toMatch(/ok\s+workers\.dev\s+not re-checked \(no saved Cloudflare login/);
  });

  it("reports a permission that cannot manage the repo", async () => {
    const w = world();
    await w.run();
    w.github.info = { ...w.github.info, viewerPermission: "WRITE" };

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+Repo permission/);
  });

  it("does not need DNS or zone permission to be ok", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    await w.run();
    w.cloudflare.deny(TOKEN, "dns", "zone");

    const { code, output } = await w.run("doctor");

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+workers\.dev/);
  });
});
