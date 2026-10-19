import type { CloudflareAccount, CloudflareClient } from "./clients.ts";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const API = "https://api.cloudflare.com/client/v4";

interface Envelope<T> {
  success: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
}

/** Real Cloudflare client over the REST API. The token stays in memory. */
export class CloudflareApi implements CloudflareClient {
  private readonly token: string;
  private readonly fetchFn: Fetch;

  constructor(token: string, fetchFn: Fetch = fetch) {
    this.token = token;
    this.fetchFn = fetchFn;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; envelope: Envelope<T> }> {
    const response = await this.fetchFn(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = (await response.json().catch(() => ({ success: false }))) as Envelope<T>;
    return { status: response.status, envelope };
  }

  private static fail(method: string, path: string, status: number, envelope: Envelope<unknown>): never {
    const reasons = (envelope.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ");
    throw new Error(`Cloudflare rejected the token or request (${method} ${path} → ${status})${reasons ? `: ${reasons}` : ""}`);
  }

  async listAccounts(): Promise<CloudflareAccount[]> {
    const { status, envelope } = await this.call<CloudflareAccount[]>("GET", "/accounts");
    if (!envelope.success) CloudflareApi.fail("GET", "/accounts", status, envelope);
    return (envelope.result ?? []).map(({ id, name }) => ({ id, name }));
  }

  async getWorkersSubdomain(accountId: string): Promise<string | null> {
    const path = `/accounts/${accountId}/workers/subdomain`;
    const { status, envelope } = await this.call<{ subdomain?: string }>("GET", path);
    // 10007: "not found", the account has no workers.dev subdomain yet.
    if (envelope.errors?.some((e) => e.code === 10007)) return null;
    if (!envelope.success) CloudflareApi.fail("GET", path, status, envelope);
    return envelope.result?.subdomain || null;
  }

  async registerWorkersSubdomain(accountId: string, subdomain: string): Promise<void> {
    const path = `/accounts/${accountId}/workers/subdomain`;
    const { status, envelope } = await this.call("PUT", path, { subdomain });
    if (!envelope.success) CloudflareApi.fail("PUT", path, status, envelope);
  }
}
