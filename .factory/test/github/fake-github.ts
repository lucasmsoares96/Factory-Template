import type { HttpMethod } from "../../src/adapters/github/api.ts";

/**
 * A tiny in-memory GitHub REST server behind a `fetch`: just the endpoints the adapters call, with GitHub's
 * semantics where they differ from the fakes (404 on a missing label, pagination, `state_reason`).
 */
export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

/** `text` answers with a plain body, as a log download does once `fetch` has followed its redirect. */
type Handler = (call: { params: string[]; query: URLSearchParams; body: any; method: string }) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | undefined;

export class FakeGitHubServer {
  readonly calls: Call[] = [];
  private readonly routes: { method: HttpMethod; pattern: RegExp; handler: Handler }[] = [];

  on(method: HttpMethod, pattern: string, handler: Handler): void {
    this.routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path: url.pathname + url.search, body, headers: new Headers(init?.headers) });
    for (const route of this.routes) {
      const match = route.pattern.exec(url.pathname);
      if (route.method !== method || !match) continue;
      const out = route.handler({ params: match.slice(1), query: url.searchParams, body, method });
      if (!out) break;
      return new Response(out.text ?? (out.json === undefined ? null : JSON.stringify(out.json)), { status: out.status ?? 200, headers: out.headers });
    }
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  };

  writes(): string[] {
    return this.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
  }
}
