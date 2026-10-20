import { z } from "zod";
import type { NewIssue } from "../../seams/tracker.ts";

/**
 * GitHub REST `POST /repos/{owner}/{repo}/issues`, by `fetch` and Zod. The
 * rest of the GitHub Tracker is ticket 16; its `createIssue` calls this.
 */

const created = z.object({ number: z.number().int().positive(), html_url: z.string().min(1) });

export interface GitHubIssueApi {
  /** `owner/name`. */
  repo: string;
  token: string;
  fetch?: typeof fetch;
  apiUrl?: string;
}

export async function createGitHubIssue(api: GitHubIssueApi, input: NewIssue): Promise<{ number: number; url: string }> {
  const doFetch = api.fetch ?? fetch;
  const body = input.relatedTo === undefined ? input.body : `${input.body.trimEnd()}\n\nRelated to #${input.relatedTo}`;
  const response = await doFetch(`${api.apiUrl ?? "https://api.github.com"}/repos/${api.repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${api.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title: input.title, body, labels: input.labels ?? [] }),
  });
  if (!response.ok) throw new Error(`GitHub refused to create the issue (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const parsed = created.safeParse(await response.json());
  if (!parsed.success) throw new Error(`Unexpected GitHub response creating an issue: ${z.prettifyError(parsed.error)}`);
  return { number: parsed.data.number, url: parsed.data.html_url };
}
