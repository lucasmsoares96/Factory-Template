import { z } from "zod";
import type { TokenClient } from "./clients.ts";

const repository = z.object({ permissions: z.object({ push: z.boolean().optional() }).optional() });

/** The owner's fine-grained token as GitHub sees it (REST by `fetch` and Zod; the token appears in no message). */
export class GitHubTokenApi implements TokenClient {
  private readonly token: string;
  private readonly doFetch: typeof fetch;
  private readonly apiUrl: string;

  constructor(token: string, options: { fetch?: typeof fetch; apiUrl?: string } = {}) {
    this.token = token;
    this.doFetch = options.fetch ?? fetch;
    this.apiUrl = options.apiUrl ?? "https://api.github.com";
  }

  /** `GET /repos/{o}/{r}`: `permissions.push` is true only when the token can write to this repository. */
  async repoAccess(repo: string): Promise<{ push: boolean }> {
    const response = await this.doFetch(`${this.apiUrl}/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (response.status === 401) throw new Error("GitHub rejected the token (401 Bad credentials): it is wrong, expired or revoked.");
    if (response.status === 404) throw new Error(`The token cannot see ${repo}: when creating it, choose "Only select repositories" and pick this repository.`);
    if (!response.ok) throw new Error(`GitHub GET /repos/${repo} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    const parsed = repository.safeParse(await response.json());
    if (!parsed.success) throw new Error(`Unexpected GitHub response for GET /repos/${repo}: ${z.prettifyError(parsed.error)}`);
    return { push: parsed.data.permissions?.push === true };
  }
}
