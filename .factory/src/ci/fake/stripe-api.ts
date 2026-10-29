// An in-memory Stripe sandbox (the events endpoints the previews use) behind a `fetch`, so `StripePreviewApi` is tested
// through the real SDK: paths, form bodies, the key header and the 16 endpoint limit. Every call is recorded, and a route
// the previews should never call (products, prices, customers, ...) answers 404 and shows up in `calls`.
export interface FakeStripeEndpoint {
  id: string;
  url: string;
  metadata: Record<string, string>;
  secret: string;
}

export class FakeStripeSandbox {
  readonly endpoints: FakeStripeEndpoint[] = [];
  /** `METHOD /v1/path` of every call. */
  readonly calls: string[] = [];
  readonly auth: (string | null)[] = [];
  private sequence = 0;

  readonly apiKey: string;
  readonly limit: number;

  constructor(apiKey = "rk_test_preview", limit = 16) {
    this.apiKey = apiKey;
    this.limit = limit;
  }

  /** An endpoint that is not the previews' (another tool's, or a Product's own), already in the sandbox. */
  seed(metadata: Record<string, string> = {}, url = "https://elsewhere.example/hook"): FakeStripeEndpoint {
    const endpoint = { id: `we_${++this.sequence}`, url, metadata, secret: `whsec_${this.sequence}` };
    this.endpoints.push(endpoint);
    return endpoint;
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method;
    this.auth.push(request.headers.get("authorization"));
    this.calls.push(`${method} ${url.pathname}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const error = (status: number, message: string) => json(status, { error: { type: status === 401 ? "authentication_error" : "invalid_request_error", message } });
    if (request.headers.get("authorization") !== `Bearer ${this.apiKey}`) return error(401, "Invalid API Key provided");
    const render = (e: FakeStripeEndpoint, withSecret: boolean) => ({ id: e.id, object: "webhook_endpoint", url: e.url, metadata: e.metadata, enabled_events: [], status: "enabled", ...(withSecret ? { secret: e.secret } : {}) });

    if (method === "GET" && url.pathname === "/v1/webhook_endpoints") {
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const after = url.searchParams.get("starting_after");
      const start = after ? this.endpoints.findIndex((e) => e.id === after) + 1 : 0;
      const page = this.endpoints.slice(start, start + limit);
      return json(200, { object: "list", url: "/v1/webhook_endpoints", has_more: start + limit < this.endpoints.length, data: page.map((e) => render(e, false)) });
    }
    if (method === "POST" && url.pathname === "/v1/webhook_endpoints") {
      const form = new URLSearchParams(await request.text());
      if (this.endpoints.length >= this.limit) return error(400, `You have reached the maximum of ${this.limit} test webhook endpoints.`);
      const metadata: Record<string, string> = {};
      for (const [key, value] of form) {
        const match = /^metadata\[(.+)\]$/.exec(key);
        if (match) metadata[match[1]!] = value;
      }
      const endpoint = this.seed(metadata, form.get("url") ?? "");
      return json(200, render(endpoint, true));
    }
    const one = /^\/v1\/webhook_endpoints\/(we_\d+)$/.exec(url.pathname);
    if (method === "DELETE" && one) {
      const at = this.endpoints.findIndex((e) => e.id === one[1]);
      if (at === -1) return error(404, "No such webhook endpoint");
      this.endpoints.splice(at, 1);
      return json(200, { id: one[1], object: "webhook_endpoint", deleted: true });
    }
    return error(404, `Unrecognized request URL (${method}: ${url.pathname})`);
  };
}
