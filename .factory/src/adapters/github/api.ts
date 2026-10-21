import { z } from "zod";

/**
 * The GitHub REST client of the adapters: `fetch` plus Zod, the token held here and put in no message.
 * Both GitHub adapters (Tracker and CodeHost) build on it.
 */
export interface GitHubApiOptions {
  /** `owner/name`. */
  repo: string;
  token: string;
  fetch?: typeof fetch;
  apiUrl?: string;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class GitHubApi {
  readonly repo: string;
  private readonly token: string;
  private readonly doFetch: typeof fetch;
  private readonly apiUrl: string;

  constructor(options: GitHubApiOptions) {
    this.repo = options.repo;
    this.token = options.token;
    this.doFetch = options.fetch ?? fetch;
    this.apiUrl = options.apiUrl ?? "https://api.github.com";
  }

  /** `/repos/{owner}/{repo}` + `path`. */
  repoPath(path: string): string {
    return `/repos/${this.repo}${path}`;
  }

  /** One request. 404 returns null when `allow404` is set; any other failure throws a `GitHubError`. */
  async request<T>(method: string, path: string, schema: z.ZodType<T>, options: { body?: unknown; allow404?: boolean } = {}): Promise<T | null> {
    const response = await this.doFetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (response.status === 404 && options.allow404) return null;
    if (!response.ok) throw new GitHubError(`GitHub ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`, response.status);
    const text = await response.text();
    const parsed = schema.safeParse(text === "" ? null : JSON.parse(text));
    if (!parsed.success) throw new Error(`Unexpected GitHub response for ${method} ${path}: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  }

  async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return (await this.request("GET", path, schema))!;
  }

  async getOrNull<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    return this.request("GET", path, schema, { allow404: true });
  }

  /** Every page of a list endpoint (100 per page). */
  async list<T>(path: string, item: z.ZodType<T>): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const rows = await this.get(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, z.array(item));
      all.push(...rows);
      if (rows.length < 100) return all;
    }
  }

  async send(method: string, path: string, body?: unknown): Promise<void> {
    await this.request(method, path, z.unknown(), { body });
  }
}
