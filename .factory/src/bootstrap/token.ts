import { z } from "zod";
import { GitHubApi, GitHubError } from "../adapters/github/api.ts";
import type { TokenClient } from "./clients.ts";

const repository = z.object({ permissions: z.object({ push: z.boolean().optional() }).optional() });

/** The owner's fine-grained token as GitHub sees it, through the adapters' `GitHubApi` (the token appears in no message). */
export class GitHubTokenApi implements TokenClient {
  private readonly token: string;
  private readonly options: { fetch?: typeof fetch; apiUrl?: string };

  constructor(token: string, options: { fetch?: typeof fetch; apiUrl?: string } = {}) {
    this.token = token;
    this.options = options;
  }

  /** `GET /repos/{o}/{r}`: `permissions.push` is true only when the token can write to this repository. */
  async repoAccess(repo: string): Promise<{ push: boolean }> {
    const api = new GitHubApi({ ...this.options, repo, token: this.token });
    try {
      const body = await api.get(api.repoPath(""), repository);
      return { push: body.permissions?.push === true };
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) throw new Error("GitHub rejected the token (401 Bad credentials): it is wrong, expired or revoked.");
      if (error instanceof GitHubError && error.status === 404) throw new Error(`The token cannot see ${repo}: when creating it, choose "Only select repositories" and pick this repository.`);
      throw error;
    }
  }
}
