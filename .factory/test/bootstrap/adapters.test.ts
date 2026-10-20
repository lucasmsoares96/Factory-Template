import { describe, expect, it } from "vitest";
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
