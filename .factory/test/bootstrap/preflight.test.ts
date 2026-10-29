import { describe, expect, it } from "vitest";
import { WranglerNotInstalled } from "../../src/bootstrap/clients.ts";
import { parsePrototools, ToolsCli } from "../../src/bootstrap/tools.ts";
import { WranglerCli, wranglerMissing } from "../../src/bootstrap/wrangler.ts";
import { world } from "./helpers.ts";

describe("bootstrap preflight", () => {
  it("passes silently when every tool is right", async () => {
    const w = world();
    expect((await w.run("doctor")).output).not.toContain("Missing before");
    expect(w.tools.installs + w.tools.logins).toBe(0);
  });

  it("names the pinned Node and how to fix it, before any step", async () => {
    const w = world();
    w.tools.node = "22.1.0";
    const { code, output } = await w.run();
    expect(code).toBe(1);
    expect(output).toContain("Node is 22.1.0, .prototools pins 24.22.0");
    expect(output).toContain("proto install");
    expect(w.github.writes).toBe(0);
    expect(w.github.targeted).toBeUndefined();
  });

  it("names the pinned pnpm, also when it is missing", async () => {
    const w = world();
    w.tools.pnpm = undefined;
    const { code, output } = await w.run();
    expect(code).toBe(1);
    expect(output).toContain("pnpm is not installed, .prototools pins 12.14.0");
    expect(w.github.writes).toBe(0);
  });

  it("offers `proto install gh` with a terminal and stops, running no step, when it is refused", async () => {
    const w = world({ "install-gh": false });
    w.deps.interactive = true;
    w.tools.gh = false;
    const { code, output } = await w.run();
    expect(code).toBe(1);
    expect(w.prompter.asked).toEqual(["install-gh"]);
    expect(w.tools.installs).toBe(0);
    expect(output).toContain("proto install gh");
    expect(w.github.writes).toBe(0);
    expect(w.prompter.repoConfirmed).toBeUndefined();
  });

  it("installs gh when the offer is accepted, then goes on", async () => {
    const w = world({ "install-gh": true });
    w.deps.interactive = true;
    w.tools.gh = false;
    expect((await w.run("doctor")).output).not.toContain("Missing before");
    expect(w.tools.installs).toBe(1);
  });

  it("offers `gh auth login --web` when gh has no login, and goes on after it", async () => {
    const w = world({ "login-gh": true });
    w.deps.interactive = true;
    w.tools.loggedIn = false;
    expect((await w.run("doctor")).output).not.toContain("Missing before");
    expect(w.tools.logins).toBe(1);
  });

  it("stops when the login offer is refused or the login does not take", async () => {
    const refused = world({ "login-gh": false });
    refused.deps.interactive = true;
    refused.tools.loggedIn = false;
    const a = await refused.run();
    expect(a.code).toBe(1);
    expect(refused.tools.logins).toBe(0);
    expect(a.output).toContain("gh auth login --web");

    const failed = world({ "login-gh": true });
    failed.deps.interactive = true;
    failed.tools.loggedIn = false;
    failed.tools.loginWorks = false;
    expect((await failed.run()).code).toBe(1);
  });

  it("stops before the first step when the account is not admin", async () => {
    const w = world();
    w.github.info = { ...w.github.info, viewerPermission: "WRITE" };
    const { code, output } = await w.run();
    expect(code).toBe(1);
    expect(output).toContain("admin");
    expect(output).toContain("write");
    expect(w.github.writes).toBe(0);
  });

  it("without a terminal installs and opens nothing, and lists every gap together", async () => {
    const w = world();
    w.tools.node = "20.0.0";
    w.tools.pnpm = "9.0.0";
    w.tools.gh = false;
    const { code, output } = await w.run();
    expect(code).toBe(1);
    expect(w.tools.installs + w.tools.logins).toBe(0);
    expect(w.prompter.asked).toEqual([]);
    for (const part of ["Node is 20.0.0", "pnpm is 9.0.0", "`gh` is not installed"]) expect(output).toContain(part);

    const signedOut = world();
    signedOut.tools.loggedIn = false;
    const second = await signedOut.run();
    expect(second.code).toBe(1);
    expect(signedOut.tools.logins).toBe(0);
    expect(second.output).toContain("`gh` is not signed in");
  });
});

describe("ToolsCli", () => {
  it("reads the top-level pins of .prototools and ignores the plugin sections", () => {
    expect(parsePrototools('node = "24.22.0"\npnpm = "12.14.0"\ngh = "2.1.0"\n\n[plugins.tools]\ngh = "file://./gh.toml"\n')).toEqual({ node: "24.22.0", pnpm: "12.14.0", gh: "2.1.0" });
  });

  it("runs the installs with the terminal and reports missing tools as false", async () => {
    const calls: { command: string; args: string[]; inherit?: boolean }[] = [];
    const tools = new ToolsCli({
      env: { PATH: "/bin", HOME: "/h", GH_TOKEN: "t", SECRET: "x" },
      readPins: () => 'node = "24.22.0"\n',
      nodeVersion: "v24.22.0",
      run: async (command, args, { inherit, env }) => {
        calls.push({ command, args, inherit });
        if (command === "gh" && args[0] === "--version") throw new Error("ENOENT");
        if (command === "gh") expect(env.SECRET).toBeUndefined();
        return "";
      },
    });
    expect(await tools.pinned()).toEqual({ node: "24.22.0" });
    expect(await tools.nodeVersion()).toBe("24.22.0");
    expect(await tools.ghInstalled()).toBe(false);
    await tools.installGh();
    await tools.loginGh();
    expect(calls.slice(1)).toEqual([
      { command: "proto", args: ["install", "gh"], inherit: true },
      { command: "gh", args: ["auth", "login", "--web"], inherit: true },
    ]);
  });
});

describe("wrangler not installed", () => {
  it("is told apart from 'no saved login'", async () => {
    const missing = new WranglerCli({ env: {}, run: async () => { throw new WranglerNotInstalled(); } });
    await expect(missing.savedToken()).rejects.toThrow("wrangler is not installed");
    const noLogin = new WranglerCli({ env: {}, run: async () => { throw new Error("not logged in"); } });
    expect(await noLogin.savedToken()).toBeUndefined();
  });

  it("reads pnpm's missing-binary output as not installed, but a wrangler that failed as a plain failure", () => {
    expect(wranglerMissing('ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "wrangler" not found')).toBe(true);
    expect(wranglerMissing("No projects matched the filters")).toBe(true);
    expect(wranglerMissing("ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: wrangler auth token")).toBe(false);
  });

  it("the doctor says wrangler is not installed instead of 'no saved login'", async () => {
    const w = world();
    w.wrangler.savedToken = async () => { throw new WranglerNotInstalled(); };
    const { output } = await w.run("doctor");
    expect(output).toContain("wrangler is not installed");
    expect(output).not.toContain("no saved Cloudflare login");
  });
});
