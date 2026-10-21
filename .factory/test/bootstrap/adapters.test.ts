import { WranglerCli } from "../../src/bootstrap/wrangler.ts";
import { describe, expect, it } from "vitest";
import { NeonCli } from "../../src/bootstrap/neon.ts";
import { GhCli } from "../../src/bootstrap/github.ts";
import { CloudflareRefused } from "../../src/bootstrap/clients.ts";
import { CloudflareApi } from "../../src/bootstrap/cloudflare.ts";
import { ResendApi } from "../../src/bootstrap/resend.ts";

describe("GhCli (command construction, no gh process)", () => {
  function recorder(replies: Record<string, string> = {}) {
    const calls: { args: string[]; input?: string }[] = [];
    const gh = new GhCli(async (args, input) => {
      calls.push({ args, input });
      return replies[args.slice(0, 2).join(" ")] ?? "";
    });
    return { gh, calls };
  }

  it("sends a secret through stdin, never in the arguments", async () => {
    const { gh, calls } = recorder();

    await gh.setSecret("CLOUDFLARE_API_TOKEN", "s3cret");

    expect(calls).toEqual([{ args: ["secret", "set", "CLOUDFLARE_API_TOKEN"], input: "s3cret" }]);
  });

  it("creates labels with --force so a rerun updates instead of failing", async () => {
    const { gh, calls } = recorder();

    await gh.upsertLabel({ name: "wontfix", color: "ffffff", description: "No" });

    expect(calls[0]?.args).toEqual(["label", "create", "wontfix", "--color", "ffffff", "--description", "No", "--force"]);
  });

  it("reads variables and labels as JSON", async () => {
    const { gh } = recorder({
      "variable list": JSON.stringify([{ name: "A", value: "1" }]),
      "label list": JSON.stringify([{ name: "x", color: "aaaaaa", description: "d" }]),
    });

    expect(await gh.listVariables()).toEqual({ A: "1" });
    expect(await gh.listLabels()).toEqual([{ name: "x", color: "aaaaaa", description: "d" }]);
  });
});

describe("GhCli: environments and rulesets (command construction)", () => {
  it("sets an environment secret with --env and the value on stdin", async () => {
    const calls: { args: string[]; input?: string }[] = [];
    const gh = new GhCli(async (args, input) => {
      calls.push({ args, input });
      return "";
    });
    await gh.setSecret("EXAMPLE_DATABASE_URL", "postgresql://x", { environment: "example-production" });
    expect(calls).toEqual([{ args: ["secret", "set", "EXAMPLE_DATABASE_URL", "--env", "example-production"], input: "postgresql://x" }]);
  });

  it("restricts an environment to one branch with a custom branch policy, adding it once", async () => {
    const calls: string[][] = [];
    const gh = new GhCli(async (args) => {
      calls.push(args);
      return args[1]?.endsWith("/deployment-branch-policies") && args.length === 2 ? JSON.stringify({ branch_policies: [] }) : "";
    });
    expect(await gh.upsertEnvironment("example-production", { branch: "main" })).toBe("created");
    expect(calls.map((c) => c.slice(0, 4).join(" "))).toEqual([
      "api -X PUT repos/{owner}/{repo}/environments/example-production",
      "api repos/{owner}/{repo}/environments/example-production/deployment-branch-policies",
      "api -X POST repos/{owner}/{repo}/environments/example-production/deployment-branch-policies",
    ]);
  });

  it("reports a refusal (403, 404 or 422) instead of throwing, and rethrows anything else", async () => {
    const refusing = new GhCli(async () => {
      throw new Error("gh api failed: gh: Upgrade to GitHub Pro (HTTP 403)");
    });
    expect(await refusing.upsertEnvironment("e", { branch: "main" })).toBe("refused");
    expect(await refusing.createRuleset({ name: "main", include: ["~DEFAULT_BRANCH"], rules: ["deletion"], requiredChecks: [] })).toBe("refused");
    expect(await refusing.listEnvironments()).toEqual([]);
    expect(await refusing.listRulesets()).toEqual([]);

    const broken = new GhCli(async () => {
      throw new Error("gh api failed: HTTP 500");
    });
    await expect(broken.upsertEnvironment("e", { branch: "main" })).rejects.toThrow("500");
  });

  it("reads a hand-made ruleset's rules and required checks", async () => {
    const gh = new GhCli(async (args) =>
      args[1] === "repos/{owner}/{repo}/rulesets?includes_parents=false"
        ? JSON.stringify([{ id: 25500591 }])
        : JSON.stringify({
            id: 25500591,
            name: "main",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
            rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request", parameters: {} }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "verify", integration_id: 15368 }] } }],
          }),
    );
    expect(await gh.listRulesets()).toEqual([
      { id: 25500591, name: "main", target: "branch", enforcement: "active", include: ["~DEFAULT_BRANCH"], rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"], requiredChecks: ["verify"] },
    ]);
  });
});

describe("CloudflareApi (fake fetch)", () => {
  function api(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = new CloudflareApi("tok", async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} });
      const { status, body } = handler(String(url), init ?? {});
      return new Response(JSON.stringify(body), { status });
    });
    return { client, seen };
  }

  it("lists accounts with a bearer token", async () => {
    const { client, seen } = api(() => ({ status: 200, body: { success: true, result: [{ id: "a", name: "N" }] } }));

    expect(await client.listAccounts()).toEqual([{ id: "a", name: "N" }]);
    expect(seen[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts");
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("treats error 10007 as no subdomain and registers with PUT", async () => {
    const { client, seen } = api((_, init) =>
      init.method === "PUT"
        ? { status: 200, body: { success: true, result: { subdomain: "me" } } }
        : { status: 404, body: { success: false, errors: [{ code: 10007, message: "not found" }] } },
    );

    expect(await client.getWorkersSubdomain("a")).toBeNull();
    await client.registerWorkersSubdomain("a", "me");
    expect(seen[1]?.init.method).toBe("PUT");
    expect(seen[1]?.init.body).toBe(JSON.stringify({ subdomain: "me" }));
  });

  it("throws a readable error when the API refuses", async () => {
    const { client } = api(() => ({ status: 403, body: { success: false, errors: [{ code: 9109, message: "Invalid access" }] } }));

    await expect(client.listAccounts()).rejects.toThrow(/Cloudflare rejected the token.*Invalid access/);
  });
});

describe("CloudflareApi: token probes (fake fetch)", () => {
  function api(handler: (url: string) => { status: number; body: unknown }) {
    const seen: string[] = [];
    const client = new CloudflareApi("tok", async (url) => {
      seen.push(String(url).replace("https://api.cloudflare.com/client/v4", ""));
      const { status, body } = handler(String(url));
      return new Response(JSON.stringify(body), { status });
    });
    return { client, seen };
  }
  const ok = (result: unknown) => ({ status: 200, body: { success: true, result } });

  it("reads scripts, KV namespaces, the account and one zone, all with GET", async () => {
    const { client, seen } = api((url) =>
      url.endsWith("/workers/scripts") ? ok([{ id: "w" }]) : url.endsWith("/namespaces") ? ok([{ id: "kv1", title: "t" }]) : url.includes("/zones") ? ok([{ id: "z", name: "a.com" }]) : ok({ id: "acc", name: "N" }),
    );

    expect(await client.listWorkerScripts("acc")).toEqual(["w"]);
    expect(await client.listKvNamespaces("acc")).toEqual(["kv1"]);
    expect(await client.getAccount("acc")).toEqual({ id: "acc", name: "N" });
    expect(await client.listZones()).toEqual([{ id: "z", name: "a.com" }]);
    expect(seen).toEqual(["/accounts/acc/workers/scripts", "/accounts/acc/storage/kv/namespaces", "/accounts/acc", "/zones?per_page=1"]);
  });

  it("finds a KV namespace by exact title across pages and creates one with POST", async () => {
    const seen: { url: string; method?: string; body?: unknown }[] = [];
    const client = new CloudflareApi("tok", async (url, init) => {
      const path = String(url).replace("https://api.cloudflare.com/client/v4", "");
      seen.push({ url: path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === "POST") return new Response(JSON.stringify({ success: true, result: { id: "kv-new", title: "t" } }), { status: 200 });
      const page = path.includes("page=2") ? [{ id: "kv2", title: "wanted" }] : [{ id: "kv1", title: "other" }];
      return new Response(JSON.stringify({ success: true, result: page, result_info: { total_pages: 2 } }), { status: 200 });
    });

    expect(await client.findKvNamespace("acc", "wanted")).toEqual({ id: "kv2", title: "wanted" });
    expect(await client.findKvNamespace("acc", "absent")).toBeNull();
    expect(await client.createKvNamespace("acc", "t")).toEqual({ id: "kv-new", title: "t" });
    expect(seen.at(-1)).toEqual({ url: "/accounts/acc/storage/kv/namespaces", method: "POST", body: { title: "t" } });
  });

  it("verifies an account-owned token, falling back to the user token verify", async () => {
    const account = api(() => ok({ status: "active" }));
    await account.client.verifyToken("acc");
    expect(account.seen).toEqual(["/accounts/acc/tokens/verify"]);

    const user = api((url) => (url.includes("/accounts/") ? { status: 401, body: { success: false, errors: [{ code: 1000, message: "x" }] } } : ok({ status: "active" })));
    await user.client.verifyToken("acc");
    expect(user.seen).toEqual(["/accounts/acc/tokens/verify", "/user/tokens/verify"]);

    const expired = api(() => ok({ status: "expired" }));
    await expect(expired.client.verifyToken("acc")).rejects.toThrow(/expired/);
  });

  it("tells a refused permission (403 or 10000) from other failures", async () => {
    const { client } = api((url) => (url.includes("namespaces") ? { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } } : { status: 500, body: { success: false } }));

    await expect(client.listKvNamespaces("acc")).rejects.toBeInstanceOf(CloudflareRefused);
    await expect(client.listWorkerScripts("acc")).rejects.not.toBeInstanceOf(CloudflareRefused);
  });
});

describe("CloudflareApi: zones, DNS and Custom Domains (fake fetch)", () => {
  function api(handler: (url: string, init: RequestInit) => unknown) {
    const seen: { url: string; method?: string; body?: unknown }[] = [];
    const client = new CloudflareApi("tok", async (url, init) => {
      seen.push({ url: String(url).replace("https://api.cloudflare.com/client/v4", ""), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(handler(String(url), init ?? {})), { status: 200 });
    });
    return { client, seen };
  }

  it("finds a zone by exact name and returns null when the account has none", async () => {
    const { client, seen } = api(() => ({ success: true, result: [{ id: "z1", name: "example.com", status: "active" }] }));

    expect(await client.findZone("example.com")).toEqual({ id: "z1", name: "example.com" });
    expect(await client.findZone("other.com")).toBeNull();
    expect(seen[0]?.url).toBe("/zones?name=example.com");
  });

  it("reads every page of DNS records", async () => {
    const { client, seen } = api((url) =>
      url.includes("&page=1")
        ? { success: true, result: [{ type: "A", name: "a.example.com", content: "1.1.1.1" }], result_info: { total_pages: 2 } }
        : { success: true, result: [{ type: "TXT", name: "b.example.com", content: "x" }], result_info: { total_pages: 2 } },
    );

    expect((await client.listDnsRecords("z1")).map((r) => r.name)).toEqual(["a.example.com", "b.example.com"]);
    expect(seen).toHaveLength(2);
  });

  it("creates records unproxied with automatic TTL and the MX priority", async () => {
    const { client, seen } = api(() => ({ success: true, result: {} }));

    await client.createDnsRecord("z1", { type: "MX", name: "send.example.com", content: "feedback-smtp.us-east-1.amazonses.com", priority: 10, proxied: false });

    expect(seen[0]).toEqual({
      url: "/zones/z1/dns_records",
      method: "POST",
      body: { type: "MX", name: "send.example.com", content: "feedback-smtp.us-east-1.amazonses.com", ttl: 1, proxied: false, priority: 10 },
    });
  });

  it("checks that a Worker exists and attaches a Custom Domain with PUT", async () => {
    const { client, seen } = api((url) =>
      url.endsWith("/workers/scripts") ? { success: true, result: [{ id: "example" }] } : { success: true, result: [{ hostname: "example.com", service: "example" }] },
    );

    expect(await client.workerExists("acc", "example")).toBe(true);
    expect(await client.workerExists("acc", "other")).toBe(false);
    expect(await client.listWorkerDomains("acc", "example")).toEqual([{ hostname: "example.com", service: "example" }]);
    await client.attachWorkerDomain("acc", { hostname: "example.com", service: "example", zoneId: "z1", zoneName: "example.com" });

    expect(seen.at(-1)).toEqual({
      url: "/accounts/acc/workers/domains",
      method: "PUT",
      body: { hostname: "example.com", service: "example", zone_id: "z1", zone_name: "example.com" },
    });
  });

  it("rejects an answer with an unexpected shape", async () => {
    const { client } = api(() => ({ success: true, result: [{ nope: 1 }] }));

    await expect(client.findZone("example.com")).rejects.toThrow(/unexpected shape/);
  });
});

describe("ResendApi (fake fetch)", () => {
  function api(handler: (url: string, init: RequestInit) => unknown, status = 200) {
    const seen: { url: string; method?: string; body?: unknown }[] = [];
    const client = new ResendApi("re-key", async (url, init) => {
      seen.push({ url: String(url).replace("https://api.resend.com", ""), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(handler(String(url), init ?? {})), { status });
    });
    return { client, seen };
  }
  const record = { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=abc", status: "not_started", ttl: "Auto" };

  it("finds a domain by name and reads its records with the second call", async () => {
    const { client, seen } = api((url) =>
      url.endsWith("/domains")
        ? { data: [{ id: "d1", name: "example.com", status: "verified" }] }
        : { id: "d1", name: "example.com", status: "verified", records: [record] },
    );

    expect(await client.findDomain("example.com")).toMatchObject({ id: "d1", status: "verified", records: [{ type: "TXT", name: "resend._domainkey" }] });
    expect(await client.findDomain("nope.com")).toBeNull();
    expect(seen[1]?.url).toBe("/domains/d1");
  });

  it("creates a domain, verifies it and asks for a sending-only key limited to it", async () => {
    const { client, seen } = api((url) =>
      url.endsWith("/api-keys") ? { id: "k1", token: "re_secret" } : { id: "d1", name: "example.com", status: "not_started", records: [record] },
    );

    expect((await client.createDomain("example.com")).id).toBe("d1");
    await client.verifyDomain("d1");
    expect(await client.createRestrictedKey({ name: "example", domainId: "d1" })).toBe("re_secret");

    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["POST /domains", "POST /domains/d1/verify", "POST /api-keys"]);
    expect(seen[2]?.body).toEqual({ name: "example", permission: "sending_access", domain_id: "d1" });
  });

  it("throws a readable error when Resend refuses", async () => {
    const { client } = api(() => ({ message: "restricted_api_key" }), 401);

    await expect(client.createDomain("example.com")).rejects.toThrow(/Resend refused the request \(POST \/domains → 401\)/);
  });
});

describe("NeonCli (fake neonctl)", () => {
  type Call = { args: string[]; env: Record<string, string>; inherit?: boolean };
  /** `loggedIn`: whether `neonctl me` succeeds, i.e. neonctl already has a saved login on this machine. */
  function cli(answers: Record<string, string>, options: { apiKey?: string; failOn?: string; loggedIn?: boolean } = {}) {
    const calls: Call[] = [];
    const syncCalls: Call[] = [];
    const neon = new NeonCli({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      env: { PATH: "/bin", HOME: "/home/x", GITHUB_TOKEN: "ghp_secret", NEON_API_KEY: "ambient-key" },
      run: async (args, opts) => {
        calls.push({ args, ...opts });
        if (args[0] === "me" && !options.loggedIn) throw new Error("neonctl me failed: not signed in");
        if (args[0] === options.failOn) throw new Error(`neonctl ${args[0]} failed: nope`);
        return answers[args[0]!] ?? "{}";
      },
      runSync: (args, opts) => {
        syncCalls.push({ args, ...opts });
      },
    });
    return { neon, calls, syncCalls };
  }

  it("reuses neonctl's saved login: no browser when `neonctl me` succeeds", async () => {
    const { neon, calls } = cli({}, { loggedIn: true });
    await neon.login();
    expect(calls.map((c) => c.args[0])).toEqual(["me"]);
  });

  it("opens the browser with `auth` only when there is no saved login, handing the terminal over", async () => {
    const { neon, calls } = cli({}, { loggedIn: false });
    await neon.login();
    expect(calls.map((c) => c.args[0])).toEqual(["me", "auth"]);
    expect(calls[1]).toMatchObject({ args: ["auth"], inherit: true });
  });

  it("uses neonctl's default config directory: no --config-dir on any call", async () => {
    const { neon, calls } = cli({ orgs: "[]" }, { loggedIn: true });
    await neon.login();
    await neon.listOrgs();
    expect(calls.every((c) => !c.args.includes("--config-dir"))).toBe(true);
  });

  it("never logs out: close keeps the login for the next run", async () => {
    const { neon, calls, syncCalls } = cli({ orgs: "[]" }, { loggedIn: true });
    await neon.listOrgs();
    await neon.close();
    neon.closeSync();
    expect(syncCalls).toEqual([]);
    expect(calls.some((c) => c.args[0] === "logout")).toBe(false);
  });

  it("builds list, create and connection-string commands with -o json, --org-id, --no-secrets and --pooled", async () => {
    const { neon, calls } = cli({
      orgs: JSON.stringify([{ id: "org-1", name: "P" }]),
      projects: JSON.stringify({ projects: [{ id: "p1", name: "example" }] }),
      "connection-string": "postgresql://u:pw@h/neondb\n",
    }, { loggedIn: true });
    expect(await neon.listOrgs()).toEqual([{ id: "org-1", name: "P" }]);
    expect(await neon.listProjects("org-1")).toEqual([{ id: "p1", name: "example" }]);
    expect(await neon.connectionString("p1", { pooled: true, orgId: "org-1" })).toBe("postgresql://u:pw@h/neondb");
    const [orgsCall, listCall, uriCall] = calls.map((c) => c.args.join(" "));
    expect(orgsCall).toBe("orgs list -o json");
    expect(listCall).toBe("projects list --org-id org-1 -o json");
    expect(uriCall).toBe("connection-string --project-id p1 --org-id org-1 --pooled --role-name neondb_owner --database-name neondb");
  });

  it("creates with --no-secrets and reads the id from the JSON", async () => {
    const { neon, calls } = cli({ projects: JSON.stringify({ project: { id: "p9", name: "shop" }, connection_uris: [] }) });
    expect(await neon.createProject("shop", "org-1")).toEqual({ id: "p9", name: "shop" });
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["projects", "create", "--name", "shop", "--org-id", "org-1", "--no-secrets"]));
  });

  it("mints a key limited to one project with `api-keys create --project-id` (no --org-id), reading only `key` from the JSON", async () => {
    const { neon, calls } = cli({ "api-keys": JSON.stringify({ id: 7, key: "napi_secret_value", name: "x", created_at: "now" }) });
    expect(await neon.createApiKey("example-preview-ci", "p1")).toBe("napi_secret_value");
    expect(calls[0]!.args.slice(0, 8)).toEqual(["api-keys", "create", "--name", "example-preview-ci", "--project-id", "p1", "-o", "json"]);
    expect(calls[0]!.args).not.toContain("--org-id");
  });

  it("does not echo a refusal's output when minting fails", async () => {
    const { neon } = cli({}, { failOn: "api-keys" });
    await expect(neon.createApiKey("k", "p1")).rejects.toThrow("api-keys failed");
  });

  it("reads the default branch and renames it", async () => {
    const { neon, calls } = cli({ branches: JSON.stringify([{ id: "br-1", name: "dev", default: false }, { id: "br-2", name: "main", default: true }]) });
    expect(await neon.defaultBranchName("p1")).toBe("main");
    await neon.renameBranch("p1", "main", "base");
    expect(calls[0]!.args.slice(0, 6)).toEqual(["branches", "list", "--project-id", "p1", "-o", "json"]);
    expect(calls[1]!.args.slice(0, 6)).toEqual(["branches", "rename", "main", "base", "--project-id", "p1"]);
  });

  it("gives the child only the base environment, and an API key only when it was given one", async () => {
    const plain = cli({ orgs: "[]" });
    await plain.neon.listOrgs();
    expect(plain.calls[0]!.env).toEqual({ PATH: "/bin", HOME: "/home/x" });

    const keyed = cli({ orgs: "[]" }, { apiKey: "the-key" });
    await keyed.neon.listOrgs();
    await keyed.neon.login();
    expect(keyed.calls[0]!.env).toEqual({ PATH: "/bin", HOME: "/home/x", NEON_API_KEY: "the-key" });
    expect(keyed.calls.some((c) => c.args[0] === "auth" || c.args[0] === "me")).toBe(false);
  });
});

describe("WranglerCli", () => {
  it("reads the saved OAuth login with `auth token --json`, without any CLOUDFLARE_* variable in the child", async () => {
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const wrangler = new WranglerCli({
      env: { PATH: "/bin", HOME: "/h", CLOUDFLARE_API_TOKEN: "env-token" },
      run: async (args, { env }) => {
        calls.push({ args, env });
        return JSON.stringify({ type: "oauth", token: "oauth-1" });
      },
    });

    expect(await wrangler.savedToken()).toBe("oauth-1");
    expect(calls[0]!.args).toEqual(["auth", "token", "--json"]);
    expect(Object.keys(calls[0]!.env).sort()).toEqual(["HOME", "PATH"]);
  });

  it("has no saved login when wrangler fails or answers with something other than an OAuth token", async () => {
    const fails = new WranglerCli({ env: {}, run: async () => { throw new Error("not logged in"); } });
    const apiToken = new WranglerCli({ env: {}, run: async () => JSON.stringify({ type: "api_token", token: "t" }) });

    expect(await fails.savedToken()).toBeUndefined();
    expect(await apiToken.savedToken()).toBeUndefined();
  });

  it("logs in through `wrangler login` with the terminal", async () => {
    const calls: { args: string[]; inherit?: boolean }[] = [];
    const wrangler = new WranglerCli({ env: {}, run: async (args, { inherit }) => (calls.push({ args, inherit }), "") });

    await wrangler.login();

    expect(calls).toEqual([{ args: ["login"], inherit: true }]);
  });
});
