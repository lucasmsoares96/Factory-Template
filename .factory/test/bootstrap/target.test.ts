import { describe, expect, it } from "vitest";
import { GhCli } from "../../src/bootstrap/github.ts";
import { parseRemote } from "../../src/bootstrap/target.ts";
import { world } from "./helpers.ts";

describe("bootstrap target repository", () => {
  it("parses GitHub remotes", () => {
    expect(parseRemote("git@github.com:me/app.git")).toBe("me/app");
    expect(parseRemote("https://github.com/me/app")).toBe("me/app");
    expect(parseRemote("https://example.com/me/app")).toBeUndefined();
  });

  it("sends every gh call to the target repo", async () => {
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const gh = new GhCli(async (args, { env }) => (calls.push({ args, env }), args[0] === "repo" ? '{"nameWithOwner":"me/app","visibility":"PUBLIC"}' : "[]"));
    gh.target("me/app");
    await gh.repo();
    await gh.listSecrets();
    await gh.autoMergeAllowed();
    expect(calls.map((c) => c.args)).toEqual([
      ["repo", "view", "me/app", "--json", "nameWithOwner,visibility,viewerPermission,defaultBranchRef"],
      ["secret", "list", "--json", "name", "--repo", "me/app"],
      ["api", "repos/me/app", "--jq", ".allow_auto_merge"],
    ]);
    expect(calls.every((c) => c.env.GH_REPO === "me/app")).toBe(true);
  });

  it("--repo replaces origin and the repo is confirmed, with its visibility", async () => {
    const w = world();
    w.deps.interactive = true;
    expect((await w.run("doctor", "--repo", "me/other")).code).toBeDefined();
    expect(w.github.targeted).toBe("me/other");
    expect(w.prompter.repoConfirmed).toBe(true);
  });

  it("writes nothing when the confirmation is denied", async () => {
    const w = world({ "repo-confirm": false });
    w.deps.interactive = true;
    const { code } = await w.run();
    expect(code).toBe(1);
    expect(w.github.writes).toBe(0);
    expect(w.github.labels.size).toBe(0);
    expect(w.prompter.repoConfirmed).toBe(false);
    expect(w.prompter.asked).toEqual([]);
  });

  it("without a terminal needs --repo equal to origin, before any step", async () => {
    const w = world();
    const { runBootstrap } = await import("../../src/bootstrap/cli.ts");
    expect(await runBootstrap([], w.deps)).toBe(1);
    expect(await runBootstrap(["--repo", "me/other"], w.deps)).toBe(1);
    expect(await runBootstrap(["--repo", "owner/repo"], w.deps)).toBe(0);
    expect(w.github.targeted).toBe("owner/repo");
  });

  it("names what to configure when there is no origin", async () => {
    const w = world();
    w.deps.origin = async () => undefined;
    w.deps.interactive = true;
    const { runBootstrap } = await import("../../src/bootstrap/cli.ts");
    expect(await runBootstrap([], w.deps)).toBe(1);
    expect(w.lines.join("\n")).toContain("git remote add origin");
    expect(w.github.writes).toBe(0);
  });
});

describe("unknown Product", () => {
  it("fails before any API call", async () => {
    const w = world();
    expect((await w.run("domain", "ghost")).output).toContain("No Product at apps/ghost");
  });
});
