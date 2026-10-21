import { z } from "zod";
import { CloudflareRefused, type CloudflareAccount, type CloudflareClient, type CloudflareDnsRecord, type CloudflareZone, type NewDnsRecord, type WorkerDomain } from "./clients.ts";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const API = "https://api.cloudflare.com/client/v4";

interface Envelope<T> {
  success: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
  result_info?: { total_pages?: number };
}

const zones = z.array(z.object({ id: z.string(), name: z.string() }));
const dnsRecords = z.array(z.object({ type: z.string(), name: z.string(), content: z.string() }));
const kvNamespaces = z.array(z.object({ id: z.string(), title: z.string().optional() }));
const kvNamespace = z.object({ id: z.string(), title: z.string() });
const account = z.object({ id: z.string(), name: z.string() });
const tokenStatus = z.object({ status: z.string() });
const scripts = z.array(z.object({ id: z.string() }));
const workerDomains = z.array(z.object({ hostname: z.string(), service: z.string() }));

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
    const message = `Cloudflare rejected the token or request (${method} ${path} → ${status})${reasons ? `: ${reasons}` : ""}`;
    // 403 / 10000: authenticated but not allowed, i.e. a permission is missing on the token.
    throw status === 403 || envelope.errors?.some((e) => e.code === 10000) ? new CloudflareRefused(message) : new Error(message);
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

  /** One call whose `result` is checked against `schema`; failures read like the other methods'. */
  private async request<S extends z.ZodType>(method: string, path: string, schema: S, body?: unknown): Promise<{ result: z.infer<S>; pages: number }> {
    const { status, envelope } = await this.call<unknown>(method, path, body);
    if (!envelope.success) CloudflareApi.fail(method, path, status, envelope);
    const parsed = schema.safeParse(envelope.result);
    if (!parsed.success) throw new Error(`Cloudflare answered ${method} ${path} with an unexpected shape: ${parsed.error.message}`);
    return { result: parsed.data, pages: envelope.result_info?.total_pages ?? 1 };
  }

  async listZones(): Promise<CloudflareZone[]> {
    return (await this.request("GET", "/zones?per_page=1", zones)).result.map(({ id, name }) => ({ id, name }));
  }

  async findZone(name: string): Promise<CloudflareZone | null> {
    const { result } = await this.request("GET", `/zones?name=${encodeURIComponent(name)}`, zones);
    return result.find((z) => z.name === name) ?? null;
  }

  async listDnsRecords(zoneId: string): Promise<CloudflareDnsRecord[]> {
    const all: CloudflareDnsRecord[] = [];
    for (let page = 1, pages = 1; page <= pages; page++) {
      const response = await this.request("GET", `/zones/${zoneId}/dns_records?per_page=100&page=${page}`, dnsRecords);
      all.push(...response.result);
      pages = response.pages;
    }
    return all;
  }

  async createDnsRecord(zoneId: string, record: NewDnsRecord): Promise<void> {
    // ttl 1 = automatic. TXT and MX are never proxied.
    const body = { type: record.type, name: record.name, content: record.content, ttl: 1, proxied: false, ...(record.priority === undefined ? {} : { priority: record.priority }) };
    await this.request("POST", `/zones/${zoneId}/dns_records`, z.unknown(), body);
  }

  async listWorkerScripts(accountId: string): Promise<string[]> {
    const { result } = await this.request("GET", `/accounts/${accountId}/workers/scripts`, scripts);
    return result.map((script) => script.id);
  }

  async workerExists(accountId: string, name: string): Promise<boolean> {
    return (await this.listWorkerScripts(accountId)).includes(name);
  }

  async listKvNamespaces(accountId: string): Promise<string[]> {
    const { result } = await this.request("GET", `/accounts/${accountId}/storage/kv/namespaces`, kvNamespaces);
    return result.map((ns) => ns.id);
  }

  async findKvNamespace(accountId: string, title: string): Promise<{ id: string; title: string } | null> {
    for (let page = 1, pages = 1; page <= pages; page++) {
      const response = await this.request("GET", `/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=${page}`, kvNamespaces);
      const found = response.result.find((ns) => ns.title === title);
      if (found) return { id: found.id, title };
      pages = response.pages;
    }
    return null;
  }

  async createKvNamespace(accountId: string, title: string): Promise<{ id: string; title: string }> {
    return (await this.request("POST", `/accounts/${accountId}/storage/kv/namespaces`, kvNamespace, { title })).result;
  }

  async getAccount(accountId: string): Promise<CloudflareAccount> {
    return (await this.request("GET", `/accounts/${accountId}`, account)).result;
  }

  /** Docs "Verify token" (account-owned: `GET /accounts/{id}/tokens/verify`; user tokens: `GET /user/tokens/verify`), read 2026-10-20. */
  async verifyToken(accountId: string): Promise<void> {
    let status: string;
    try {
      status = (await this.request("GET", `/accounts/${accountId}/tokens/verify`, tokenStatus)).result.status;
    } catch {
      status = (await this.request("GET", "/user/tokens/verify", tokenStatus)).result.status;
    }
    if (status !== "active") throw new Error(`The Cloudflare token is ${status}, not active.`);
  }

  async listWorkerDomains(accountId: string, service: string): Promise<WorkerDomain[]> {
    const { result } = await this.request("GET", `/accounts/${accountId}/workers/domains?service=${encodeURIComponent(service)}`, workerDomains);
    return result.filter((d) => d.service === service);
  }

  async attachWorkerDomain(accountId: string, domain: { hostname: string; service: string; zoneId: string; zoneName: string }): Promise<void> {
    const body = { hostname: domain.hostname, service: domain.service, zone_id: domain.zoneId, zone_name: domain.zoneName };
    await this.request("PUT", `/accounts/${accountId}/workers/domains`, z.unknown(), body);
  }
}
