import { z } from "zod";
import type { MachineUserClient } from "./clients.ts";

const user = z.object({ login: z.string().min(1) });
const invitations = z.array(z.object({ id: z.number(), repository: z.object({ full_name: z.string() }) }));

/** The machine user's own GitHub account, by its classic PAT (REST by `fetch` and Zod; the token appears in no message). */
export class GitHubUserApi implements MachineUserClient {
  private readonly token: string;
  private readonly doFetch: typeof fetch;
  private readonly apiUrl: string;

  constructor(token: string, options: { fetch?: typeof fetch; apiUrl?: string } = {}) {
    this.token = token;
    this.doFetch = options.fetch ?? fetch;
    this.apiUrl = options.apiUrl ?? "https://api.github.com";
  }

  async viewer(): Promise<{ login: string; scopes: string[] | null }> {
    const response = await this.call("GET", "/user");
    const header = response.headers.get("x-oauth-scopes");
    const parsed = user.safeParse(await response.json());
    if (!parsed.success) throw new Error(`Unexpected GitHub response for GET /user: ${z.prettifyError(parsed.error)}`);
    return { login: parsed.data.login, scopes: header === null ? null : header.split(",").map((s) => s.trim()).filter(Boolean) };
  }

  async acceptInvitation(repo: string): Promise<boolean> {
    const parsed = invitations.parse(await (await this.call("GET", "/user/repository_invitations")).json());
    const invitation = parsed.find((i) => i.repository.full_name.toLowerCase() === repo.toLowerCase());
    if (!invitation) return false;
    await this.call("PATCH", `/user/repository_invitations/${invitation.id}`);
    return true;
  }

  private async call(method: string, path: string): Promise<Response> {
    const response = await this.doFetch(`${this.apiUrl}${path}`, {
      method,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (response.status === 401) throw new Error("GitHub rejected the PAT (401 Bad credentials): it is wrong, expired or revoked.");
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    return response;
  }
}
