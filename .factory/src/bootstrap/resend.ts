import { z } from "zod";
import type { ResendClient, ResendDomain } from "./clients.ts";

const API = "https://api.resend.com";

const record = z.object({
  record: z.string(),
  type: z.string(),
  name: z.string(),
  value: z.string(),
  priority: z.number().optional(),
  status: z.string(),
});
const domain = z.object({ id: z.string(), name: z.string(), status: z.string(), records: z.array(record).default([]) });
const domainList = z.object({ data: z.array(z.object({ id: z.string(), name: z.string() })) });
const apiKey = z.object({ id: z.string(), token: z.string() });

/** Resend over its REST API (Domains and API Keys references, checked 2026-10-20); the key stays in memory. */
export class ResendApi implements ResendClient {
  private readonly key: string;
  private readonly fetchFn: typeof fetch;

  constructor(key: string, fetchFn: typeof fetch = fetch) {
    this.key = key;
    this.fetchFn = fetchFn;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchFn(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend refused the request (${method} ${path} → ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return response.json();
  }

  async findDomain(name: string): Promise<ResendDomain | null> {
    const listed = domainList.parse(await this.call("GET", "/domains")).data.find((d) => d.name === name);
    // The list omits the DNS records; the single-domain call has them.
    return listed ? domain.parse(await this.call("GET", `/domains/${listed.id}`)) : null;
  }

  async createDomain(name: string): Promise<ResendDomain> {
    return domain.parse(await this.call("POST", "/domains", { name }));
  }

  async verifyDomain(id: string): Promise<void> {
    await this.call("POST", `/domains/${id}/verify`);
  }

  async createRestrictedKey(input: { name: string; domainId: string }): Promise<string> {
    return apiKey.parse(await this.call("POST", "/api-keys", { name: input.name, permission: "sending_access", domain_id: input.domainId })).token;
  }
}
