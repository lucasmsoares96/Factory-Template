import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { world } from "./helpers.ts";

// Seam 8 for the Factory module: `pnpm bootstrap factory` against the fake GitHub and the machine user's fake account.
const PAT = "ghp_machine_user_pat";

function factoryWorld(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = {}) {
  const w = world({ "factory-pat": PAT, ...answers }, env);
  w.deps.interactive = true;
  w.machines.add(PAT, { login: "factory-bot", scopes: ["repo"] });
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", "x");
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  return w;
}

const shown = (w: ReturnType<typeof factoryWorld>) => JSON.stringify([w.lines, w.prompter.notes, w.prompter.printed]);

describe("pnpm bootstrap factory: Factory module", () => {
  it("stores the PAT as FACTORY_TOKEN, invites and accepts the machine user, checks Claude's auth and turns FACTORY_ENABLED on", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" });

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe(PAT);
    expect(w.github.variables.get("FACTORY_MACHINE_USER")).toBe("factory-bot");
    expect(w.github.collaborators.get("factory-bot")).toBe("write");
    expect(w.github.secrets.get("CLAUDE_CODE_OAUTH_TOKEN")).toBe("sk-ant-oat-x");
    expect(w.github.variables.get("FACTORY_ENABLED")).toBe("true");
    expect(output).toMatch(/ok\s+FACTORY_ENABLED/);
    expect(w.prompter.asked).toEqual(["factory-pat"]);
    expect(shown(w)).not.toContain(PAT);
    expect(shown(w)).not.toContain("sk-ant-oat-x");
    expect(w.prompter.printed.join("\n")).toContain("https://github.com/settings/tokens/new?scopes=repo");
  });

  it("makes the labels the Factory uses", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });

    await w.run("factory");

    for (const label of labelSpecs(w.deps.config)) expect(w.github.labels.has(label.name), label.name).toBe(true);
  });

  it("refuses the PAT of the repo owner's login and asks again, storing nothing from the refused one", async () => {
    const w = factoryWorld({ "factory-pat": ["owner-pat", PAT] }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    w.machines.add("owner-pat", { login: "owner", scopes: ["repo"] });

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(output).toContain("owner");
    expect(output).toMatch(/same login|its owner/i);
    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe(PAT);
    expect(w.github.collaborators.has("owner")).toBe(false);
    expect(w.prompter.asked).toEqual(["factory-pat", "factory-pat"]);
  });

  it("refuses the login `gh` is signed in as, even when it is not the owner", async () => {
    const w = factoryWorld({ "factory-pat": ["me-pat"] }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    w.github.login = "maintainer";
    w.machines.add("me-pat", { login: "maintainer", scopes: ["repo"] });

    await expect(w.run("factory")).rejects.toThrow(/PAT/);
    expect(w.github.secrets.has("FACTORY_TOKEN")).toBe(false);
  });

  it.each([
    ["a PAT with the workflow scope", { login: "factory-bot", scopes: ["repo", "workflow"] }, /workflow/],
    ["a PAT without the repo scope", { login: "factory-bot", scopes: ["read:user"] }, /repo/],
    ["a fine-grained token (no X-OAuth-Scopes)", { login: "factory-bot", scopes: null }, /classic/i],
  ])("refuses %s, three tries at most, storing nothing", async (_name, account, reason) => {
    const w = factoryWorld({ "factory-pat": "bad" }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    w.machines.add("bad", account);

    await expect(w.run("factory")).rejects.toThrow(reason);

    expect(w.prompter.asked).toEqual(["factory-pat", "factory-pat", "factory-pat"]);
    expect(w.github.secretWrites.map((s) => s.name)).not.toContain("FACTORY_TOKEN");
    expect(w.github.collaborators.size).toBe(0);
  });

  it("refuses a token GitHub does not know", async () => {
    const w = factoryWorld({ "factory-pat": "nope" }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });

    await expect(w.run("factory")).rejects.toThrow(/rejected/);
  });

  it("a rerun after a complete run asks nothing and writes nothing", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    await w.run("factory");
    w.prompter.asked.length = 0;
    const writes = w.github.writes;

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(w.prompter.asked).toEqual([]);
    expect(w.github.writes).toBe(writes);
    expect(output).toContain("already done");
  });

  it("an existing CLAUDE_CODE_OAUTH_TOKEN secret counts as present: nothing from the environment is needed", async () => {
    const w = factoryWorld();
    w.github.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "old");

    const { code } = await w.run("factory");

    expect(code).toBe(0);
    expect(w.github.secrets.get("CLAUDE_CODE_OAUTH_TOKEN")).toBe("old");
    expect(w.github.variables.get("FACTORY_ENABLED")).toBe("true");
  });

  it("an existing FACTORY_TOKEN secret is never asked for again", async () => {
    const w = factoryWorld({ "factory-pat": undefined as never });
    w.github.secrets.set("FACTORY_TOKEN", "stored");
    w.github.variables.set("FACTORY_MACHINE_USER", "factory-bot");
    w.github.collaborators.set("factory-bot", "write");
    w.github.secrets.set("ANTHROPIC_API_KEY", "k");

    const { code } = await w.run("factory");

    expect(code).toBe(0);
    expect(w.prompter.asked).toEqual([]);
  });

  it("warns when both Claude auths exist and says which wins", async () => {
    const w = factoryWorld();
    w.github.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "a");
    w.github.secrets.set("ANTHROPIC_API_KEY", "b");

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(output).toMatch(/both exist: ANTHROPIC_API_KEY wins/);
    expect(output).toMatch(/warn\s+Claude auth/);
  });

  it("with both in the environment it stores only the recommended OAuth token and says so", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_API_KEY: "key" });

    const { output } = await w.run("factory");

    expect(w.github.secrets.has("CLAUDE_CODE_OAUTH_TOKEN")).toBe(true);
    expect(w.github.secrets.has("ANTHROPIC_API_KEY")).toBe(false);
    expect(output).toMatch(/ANTHROPIC_API_KEY.*not stored/s);
  });

  it("without any Claude auth it says how to get one, asks nothing more, and leaves FACTORY_ENABLED off", async () => {
    const w = factoryWorld();

    const { code, output } = await w.run("factory");

    expect(code).toBe(1);
    expect(output).toContain("claude setup-token");
    expect(output).toMatch(/missing\s+Claude auth/);
    expect(w.github.variables.has("FACTORY_ENABLED")).toBe(false);
    expect(output).toContain("FACTORY_ENABLED stays off");
    expect(w.prompter.asked).toEqual(["factory-pat"]);
  });

  it("when the machine user cannot accept the invitation yet, the PAT stays stored and FACTORY_ENABLED off", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    w.machines.acceptFails = true;

    await expect(w.run("factory")).rejects.toThrow(/invitation/);
    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe(PAT);
    expect(w.github.variables.has("FACTORY_ENABLED")).toBe(false);

    // The rerun does not ask for the PAT again; the invitation is still pending and the message says where to accept it.
    w.prompter.asked.length = 0;
    await expect(w.run("factory")).rejects.toThrow(/https:\/\/github\.com\/owner\/repo\/invitations/);
    expect(w.prompter.asked).toEqual([]);
  });

  it("--redo machine-user replaces the token", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    await w.run("factory");
    w.machines.add("pat2", { login: "factory-bot", scopes: ["repo"] });
    w.prompter.asked.length = 0;
    (w.prompter as unknown as { answers: Record<string, string> }).answers["factory-pat"] = "pat2";

    await w.run("factory", "--redo", "machine-user");

    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe("pat2");
    expect(w.prompter.asked).toEqual(["factory-pat"]);
  });

  it("the doctor shows the Factory section", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    await w.run("factory");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/ok\s+FACTORY_TOKEN/);
    expect(output).toMatch(/ok\s+FACTORY_ENABLED/);
  });
});

describe("the real adapters of the Factory module", () => {
  it("GitHubUserApi reads the login and the scopes from X-OAuth-Scopes, and accepts only the invitation of this repo", async () => {
    const { GitHubUserApi } = await import("../../src/bootstrap/machine.ts");
    const calls: string[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghp_x");
      if (url.pathname === "/user") return new Response(JSON.stringify({ login: "bot" }), { headers: { "X-OAuth-Scopes": "repo, read:user" } });
      if (url.pathname === "/user/repository_invitations" && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify([{ id: 1, repository: { full_name: "o/other" } }, { id: 2, repository: { full_name: "O/R" } }]));
      }
      return new Response(null, { status: 204 });
    };
    const api = new GitHubUserApi("ghp_x", { fetch: fake });

    expect(await api.viewer()).toEqual({ login: "bot", scopes: ["repo", "read:user"] });
    expect(await api.acceptInvitation("o/r")).toBe(true);
    expect(calls).toEqual(["GET /user", "GET /user/repository_invitations", "PATCH /user/repository_invitations/2"]);
  });

  it("a fine-grained token has no scopes header, and a rejected token says so without printing itself", async () => {
    const { GitHubUserApi } = await import("../../src/bootstrap/machine.ts");
    const ok: typeof fetch = async () => new Response(JSON.stringify({ login: "bot" }));
    const unauthorized: typeof fetch = async () => new Response("{}", { status: 401 });

    expect(await new GitHubUserApi("t", { fetch: ok }).viewer()).toEqual({ login: "bot", scopes: null });
    const error = await new GitHubUserApi("secret-pat", { fetch: unauthorized }).viewer().catch((e: Error) => e);
    expect((error as Error).message).toContain("rejected");
    expect((error as Error).message).not.toContain("secret-pat");
  });

  it("GhCli invites with the push permission and reads the role of a collaborator", async () => {
    const { GhCli } = await import("../../src/bootstrap/github.ts");
    const seen: { args: string[]; input?: string }[] = [];
    const gh = new GhCli(async (args, input) => {
      seen.push({ args, input });
      if (args.includes("--jq")) {
        if (args.some((a) => a.includes("/ghost/"))) throw new Error("gh api failed: HTTP 404");
        return "maintain\n";
      }
      return "";
    });

    await gh.inviteCollaborator("bot");
    expect(seen[0]).toMatchObject({ args: ["api", "-X", "PUT", "repos/{owner}/{repo}/collaborators/bot", "--input", "-"], input: JSON.stringify({ permission: "push" }) });
    expect(await gh.collaboratorPermission("bot")).toBe("maintain");
    expect(await gh.collaboratorPermission("ghost")).toBe("none");
  });
});
