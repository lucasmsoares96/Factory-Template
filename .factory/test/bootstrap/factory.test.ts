import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import { world } from "./helpers.ts";
import { FakeGitHubServer } from "../github/fake-github.ts";

// Seam 8 for the Factory module: `pnpm bootstrap factory` against the fake GitHub and the fake token of the owner.
const PAT = "github_pat_owner_token";

function factoryWorld(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = {}) {
  const w = world({ "factory-token": PAT, "merge-mode": "human", ...answers }, env);
  w.deps.interactive = true;
  w.tokens.add(PAT, { push: true });
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", "x");
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  return w;
}

/** The credential prompts; the optional example question (answered No by the helper) and the Merge Mode are not ones. */
const credentialPrompts = (w: { prompter: { asked: string[] } }) => w.prompter.asked.filter((id) => id !== "example-issue" && id !== "merge-mode");

const shown = (w: ReturnType<typeof factoryWorld>) => JSON.stringify([w.lines, w.prompter.notes, w.prompter.printed]);

describe("pnpm bootstrap factory: Factory module", () => {
  it("stores the token as FACTORY_TOKEN, checks Claude's auth and turns FACTORY_ENABLED on", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-x" });

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe(PAT);
    expect(w.github.variables.has("FACTORY_MACHINE_USER")).toBe(false);
    expect(w.github.secrets.get("CLAUDE_CODE_OAUTH_TOKEN")).toBe("sk-ant-oat-x");
    expect(w.github.variables.get("FACTORY_ENABLED")).toBe("true");
    expect(output).toMatch(/ok\s+FACTORY_ENABLED/);
    expect(credentialPrompts(w)).toEqual(["factory-token"]);
    expect(w.tokens.asked).toEqual(["owner/repo"]);
    expect(shown(w)).not.toContain(PAT);
    expect(shown(w)).not.toContain("sk-ant-oat-x");
  });

  it("prints one pre-filled link, with workflows, after saying the one manual step", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });

    const { output } = await w.run("factory");

    expect(w.prompter.printed.filter((line) => line.startsWith("https://"))).toEqual([
      "https://github.com/settings/personal-access-tokens/new?name=Factory+repo&description=Factory+for+owner%2Frepo%3A+opens+pull+requests+and+comments+on+issues.&target_name=owner&expires_in=none&contents=write&pull_requests=write&issues=write&workflows=write",
    ]);
    expect(w.prompter.printed.filter((line) => line.startsWith("https://"))).toHaveLength(1);
    expect(output + w.prompter.notes.join()).toMatch(/Only select repositories/);
    expect(output).toMatch(/cannot tell whether the token has the Workflows permission/);
  });

  it("allows auto-merge on the repo, which the skills update needs, and leaves it on a rerun", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });

    await w.run("factory");

    expect(w.github.autoMerge).toBe(true);
  });

  it("asks the Merge Mode once, offering human first, and sets FACTORY_MERGE_MODE", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    const offered: string[][] = [];
    const select = w.prompter.select.bind(w.prompter);
    w.prompter.select = async <T extends string>(input: { id: string; options?: { value: T }[] }) => {
      if (input.id === "merge-mode") offered.push((input.options ?? []).map((o) => o.value));
      return select(input);
    };

    await w.run("factory");

    expect(offered).toEqual([["human", "safe"]]);
    expect(w.github.variables.get("FACTORY_MERGE_MODE")).toBe("human");
  });

  it("does not ask the Merge Mode on a rerun, and changes it only with --redo merge-mode", async () => {
    const w = factoryWorld({ "merge-mode": ["human", "safe"] }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    await w.run("factory");
    w.prompter.asked.length = 0;

    const { output } = await w.run("factory");
    expect(credentialPrompts(w)).toEqual([]);
    expect(w.prompter.asked).not.toContain("merge-mode");
    expect(output).toMatch(/FACTORY_MERGE_MODE.*human/);

    await w.run("factory", "--redo", "merge-mode");
    expect(w.prompter.asked.filter((id) => id === "merge-mode")).toEqual(["merge-mode"]);
    expect(w.github.variables.get("FACTORY_MERGE_MODE")).toBe("safe");
  });

  it("without a terminal, the Merge Mode is human, asked of nobody", async () => {
    const w = factoryWorld({ "merge-mode": undefined as never }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    w.deps.interactive = false;

    const { code } = await w.run("factory");

    expect(code).toBe(0);
    expect(w.prompter.asked).not.toContain("merge-mode");
    expect(w.github.variables.get("FACTORY_MERGE_MODE")).toBe("human");
  });

  it("makes the labels the Factory uses", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });

    await w.run("factory");

    for (const label of labelSpecs(w.deps.config)) expect(w.github.labels.has(label.name), label.name).toBe(true);
  });

  it("refuses a classic token (ghp_) and asks again, storing nothing from the refused one", async () => {
    const w = factoryWorld({ "factory-token": ["ghp_classic", PAT] }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    w.tokens.add("ghp_classic", { push: true });

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(output).toMatch(/classic token/);
    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe(PAT);
    expect(credentialPrompts(w)).toEqual(["factory-token", "factory-token"]);
    expect(w.tokens.asked).toEqual(["owner/repo"]);
  });

  it("refuses anything that is not github_pat_", async () => {
    const w = factoryWorld({ "factory-token": "gho_oauth" }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });

    await expect(w.run("factory")).rejects.toThrow(/github_pat_/);
  });

  it("refuses a token without push access, three tries at most, storing nothing", async () => {
    const w = factoryWorld({ "factory-token": "github_pat_readonly" }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    w.tokens.add("github_pat_readonly", { push: false });

    await expect(w.run("factory")).rejects.toThrow(/cannot write/);

    expect(credentialPrompts(w)).toEqual(["factory-token", "factory-token", "factory-token"]);
    expect(w.github.secretWrites.map((s) => s.name)).not.toContain("FACTORY_TOKEN");
  });

  it("refuses a token GitHub does not know", async () => {
    const w = factoryWorld({ "factory-token": "github_pat_nope" }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });

    await expect(w.run("factory")).rejects.toThrow(/rejected/);
  });

  it("FACTORY_TOKEN in the environment skips the prompt and the link, and is checked all the same", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x", FACTORY_TOKEN: PAT });
    const { code } = await w.run("factory");
    expect(code).toBe(0);
    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe(PAT);
    expect(credentialPrompts(w)).toEqual([]);
    expect(w.prompter.printed).toEqual([]);

    const bad = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x", FACTORY_TOKEN: "ghp_classic" });
    await expect(bad.run("factory")).rejects.toThrow(/classic/);
    expect(credentialPrompts(bad)).toEqual([]);
  });

  it("a rerun after a complete run asks nothing and writes nothing", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    await w.run("factory");
    w.prompter.asked.length = 0;
    const writes = w.github.writes;

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(credentialPrompts(w)).toEqual([]);
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
    const w = factoryWorld({ "factory-token": undefined as never });
    w.github.secrets.set("FACTORY_TOKEN", "stored");
    w.github.secrets.set("ANTHROPIC_API_KEY", "k");

    const { code } = await w.run("factory");

    expect(code).toBe(0);
    expect(credentialPrompts(w)).toEqual([]);
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
    expect(credentialPrompts(w)).toEqual(["factory-token"]);
  });

  it("--redo factory-token replaces the token", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    await w.run("factory");
    w.tokens.add("github_pat_second", { push: true });
    w.prompter.asked.length = 0;
    (w.prompter as unknown as { answers: Record<string, string> }).answers["factory-token"] = "github_pat_second";

    await w.run("factory", "--redo", "factory-token");

    expect(w.github.secrets.get("FACTORY_TOKEN")).toBe("github_pat_second");
    expect(credentialPrompts(w)).toEqual(["factory-token"]);
  });

  it("the doctor shows the Factory section", async () => {
    const w = factoryWorld({}, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
    await w.run("factory");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/ok\s+FACTORY_TOKEN/);
    expect(output).toMatch(/ok\s+FACTORY_ENABLED/);
    expect(output).toMatch(/ok\s+FACTORY_MERGE_MODE\s+human/);
  });

  it("the doctor shows the Merge Mode, unset as human, and warns about one it does not know", async () => {
    const w = factoryWorld();
    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_MERGE_MODE\s+not set: human, every Factory pull request waits for a person; `pnpm bootstrap factory` asks it/);

    w.github.variables.set("FACTORY_MERGE_MODE", "safe");
    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_MERGE_MODE\s+safe/);

    w.github.variables.set("FACTORY_MERGE_MODE", "yolo");
    expect((await w.run("doctor")).output).toMatch(/warn\s+FACTORY_MERGE_MODE\s+yolo is not one of human, safe: every Factory job fails; run `pnpm bootstrap factory --redo merge-mode`/);
  });
});

describe("the real adapters of the Factory module", () => {
  it("GitHubTokenApi reads permissions.push of the repo with the token as the bearer", async () => {
    const { GitHubTokenApi } = await import("../../src/bootstrap/token.ts");
    const calls: string[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github_pat_x");
      return new Response(JSON.stringify({ permissions: { push: url.pathname === "/repos/o/r" } }));
    };
    const api = new GitHubTokenApi("github_pat_x", { fetch: fake });

    expect(await api.repoAccess("o/r")).toEqual({ push: true });
    expect(await api.repoAccess("o/other")).toEqual({ push: false });
    expect(calls).toEqual(["GET /repos/o/r", "GET /repos/o/other"]);
  });

  it("a repository the token was not granted (404) and a rejected token say so without printing the token", async () => {
    const { GitHubTokenApi } = await import("../../src/bootstrap/token.ts");
    const status = (code: number): typeof fetch => async () => new Response("{}", { status: code });

    const hidden = await new GitHubTokenApi("secret-pat", { fetch: status(404) }).repoAccess("o/r").catch((e: Error) => e);
    expect((hidden as Error).message).toContain("Only select repositories");
    const unauthorized = await new GitHubTokenApi("secret-pat", { fetch: status(401) }).repoAccess("o/r").catch((e: Error) => e);
    expect((unauthorized as Error).message).toContain("rejected");
    expect((unauthorized as Error).message).not.toContain("secret-pat");
  });

  it("GitHubTokenApi talks to GitHub as GitHubApi does, and any other failure keeps the token out of its message", async () => {
    const { GitHubTokenApi } = await import("../../src/bootstrap/token.ts");
    const s = new FakeGitHubServer();
    s.on("GET", "/repos/o/r", () => ({ json: { permissions: { push: true } } }));
    s.on("GET", "/repos/o/read-only", () => ({ json: { permissions: { push: false } } }));
    s.on("GET", "/repos/o/broken", () => ({ status: 500, json: { message: "boom" } }));
    s.on("GET", "/repos/o/revoked", () => ({ status: 401, json: { message: "Bad credentials" } }));
    const api = new GitHubTokenApi("secret-pat", { fetch: s.fetch });

    expect(await api.repoAccess("o/r")).toEqual({ push: true });
    expect(await api.repoAccess("o/read-only")).toEqual({ push: false });
    const broken = await api.repoAccess("o/broken").catch((e: Error) => e);
    expect((broken as Error).message).toContain("(500)");
    expect((broken as Error).message).not.toContain("secret-pat");
    const revoked = await api.repoAccess("o/revoked").catch((e: Error) => e);
    expect((revoked as Error).message).toContain("rejected the token");
    const missing = await api.repoAccess("o/gone").catch((e: Error) => e);
    expect((missing as Error).message).toContain("cannot see o/gone");
    expect(s.calls[0]!.headers.get("authorization")).toBe("Bearer secret-pat");
    expect(s.calls[0]!.headers.get("x-github-api-version")).toBe("2022-11-28");
  });
});
