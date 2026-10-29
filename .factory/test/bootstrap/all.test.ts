import { describe, expect, it } from "vitest";
import { world } from "./helpers.ts";

const PAT = "github_pat_owner_token";
const ANSWERS = {
  "resend-setup": "skip",
  "default-account-email": "a@example.com",
  "default-account-password": "admin password 123",
  "default-account-password-confirm": "admin password 123",
  "preview-account-password": "preview password 123",
  "preview-account-password-confirm": "preview password 123",
  "factory-token": PAT,
  "domain-setup": false,
  "billing-setup": false,
};
const ENV = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" };

function allWorld(answers: Record<string, string | boolean | string[]> = {}) {
  const w = world({ ...ANSWERS, ...answers }, ENV);
  w.tokens.add(PAT, { push: true });
  return w;
}

const state = (w: ReturnType<typeof allWorld>) => ({
  secrets: [...w.github.secrets.keys()].sort(),
  variables: Object.fromEntries([...w.github.variables.entries()].sort()),
});

describe("pnpm bootstrap all <id>", () => {
  it("leaves the state of the four commands run in order", async () => {
    const single = allWorld();
    single.deps.interactive = true;
    for (const argv of [[], ["product", "example"], ["previews", "example"], ["factory"]]) {
      expect((await single.run(...argv)).code).toBe(0);
    }

    const all = allWorld();
    all.deps.interactive = true;
    const { code, output } = await all.run("all", "example");

    expect(code).toBe(0);
    expect(state(all)).toEqual(state(single));
    expect(all.github.variables.get("FACTORY_ENABLED")).toBe("true");
    expect(output).not.toMatch(/^next:/m);
  });

  it("skips only the domain when it is refused", async () => {
    const w = allWorld({ "domain-setup": false });
    w.deps.interactive = true;

    const { code, output } = await w.run("all", "example");

    expect(code).toBe(0);
    expect(w.prompter.asked).toContain("domain-setup");
    expect(output).toContain("Domain skipped");
    expect(w.github.variables.get("FACTORY_ENABLED")).toBe("true");
    expect(w.github.variables.get("PREVIEWS_ENABLED")).toBe("true");
  });

  it("stops at the first module whose doctor fails", async () => {
    const w = allWorld();
    w.deps.interactive = true;
    w.github.info = { ...w.github.info, viewerPermission: "WRITE" };

    const { code, output } = await w.run("all", "example");

    expect(code).toBe(1);
    expect(w.github.variables.has("DEPLOY_ENABLED")).toBe(false);
    expect(w.github.variables.has("FACTORY_ENABLED")).toBe(false);
    expect(output).toContain("next: pnpm bootstrap all example");
  });
});

describe("the next line", () => {
  it("names the module that is still to do, and disappears when all is done", async () => {
    const w = allWorld();
    w.deps.interactive = true;

    expect((await w.run()).output).toContain("next: pnpm bootstrap product <id>");
    expect((await w.run("product", "example")).output).toContain("next: pnpm bootstrap previews example");
    expect((await w.run("previews", "example")).output).toContain("next: pnpm bootstrap factory");
    expect((await w.run("factory")).output).not.toMatch(/^next:/m);
  });

  it("asks to run the same command again when its doctor fails", async () => {
    const w = allWorld();
    w.github.info = { ...w.github.info, viewerPermission: "WRITE" };

    const { code, output } = await w.run();

    expect(code).toBe(1);
    expect(output).toMatch(/^next: pnpm bootstrap$/m);
  });
});

describe("help", () => {
  it("describes all and says the Neon login is kept", async () => {
    const { output } = await allWorld().run("help");

    expect(output).toMatch(/all <id>\s+The whole setup/);
    expect(output).toMatch(/login\s+is kept/);
    expect(output).not.toContain("removed when the command ends");
  });
});
