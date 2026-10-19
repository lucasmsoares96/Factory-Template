import { describe, expect, it } from "vitest";
import { GhCli } from "../../src/bootstrap/github.ts";
import { CloudflareApi } from "../../src/bootstrap/cloudflare.ts";

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
    expect((seen[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
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
