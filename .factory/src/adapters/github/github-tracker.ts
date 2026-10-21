import { z } from "zod";
import type { Blocker, Issue, IssueComment, NewIssue, Tracker } from "../../seams/tracker.ts";
import { marked } from "../../marker.ts";
import { GitHubApi, GitHubError, type GitHubApiOptions } from "./api.ts";
import { createGitHubIssue } from "./create-issue.ts";

const issueRow = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullable().optional(),
  state: z.enum(["open", "closed"]),
  state_reason: z.string().nullable().optional(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string() })])).default([]),
  pull_request: z.unknown().optional(),
});
const commentRow = z.object({ id: z.number(), body: z.string().nullable().optional(), user: z.object({ login: z.string() }).nullable() });
const permissionRow = z.object({ permission: z.string(), role_name: z.string().optional() });
const eventRow = z.object({
  event: z.string(),
  label: z.object({ name: z.string() }).optional(),
  actor: z.object({ login: z.string() }).nullable().optional(),
});

const labelName = (l: string | { name: string }) => (typeof l === "string" ? l : l.name);

/**
 * Tracker over GitHub Issues (REST). `done` is `closed` + `completed`; the blockers come from the issue dependencies
 * endpoints, the parent and children from the sub-issues ones. The token never leaves this class.
 */
export class GitHubTracker implements Tracker {
  private readonly api: GitHubApi;
  private readonly options: GitHubApiOptions;

  constructor(options: GitHubApiOptions) {
    this.options = options;
    this.api = new GitHubApi(options);
  }

  async issue(number: number): Promise<Issue> {
    const base = this.api.repoPath(`/issues/${number}`);
    const row = await this.api.get(base, issueRow);
    const parent = await this.api.getOrNull(`${base}/parent`, issueRow);
    const children = await this.api.list(`${base}/sub_issues`, issueRow);
    const comments = await this.api.list(`${base}/comments`, commentRow);
    return {
      number: row.number,
      title: row.title,
      body: row.body ?? "",
      state: row.state,
      labels: row.labels.map(labelName),
      parent: parent ? { number: parent.number, body: parent.body ?? "" } : null,
      children: children.map((c) => c.number),
      comments: comments.map((c): IssueComment => ({ id: String(c.id), author: c.user?.login ?? "ghost", body: c.body ?? "" })),
    };
  }

  async blockers(number: number): Promise<Blocker[]> {
    const rows = await this.api.list(this.api.repoPath(`/issues/${number}/dependencies/blocked_by`), issueRow);
    return rows.map((r) => ({ number: r.number, done: r.state === "closed" && r.state_reason === "completed" }));
  }

  async blocking(number: number): Promise<number[]> {
    const rows = await this.api.list(this.api.repoPath(`/issues/${number}/dependencies/blocking`), issueRow);
    return rows.filter((r) => r.state === "open").map((r) => r.number);
  }

  async labeled(label: string): Promise<number[]> {
    const rows = await this.api.list(this.api.repoPath(`/issues?state=open&labels=${encodeURIComponent(label)}`), issueRow);
    return rows.filter((r) => r.pull_request === undefined).map((r) => r.number);
  }

  async swapLabel(number: number, from: string, to: string): Promise<boolean> {
    const base = this.api.repoPath(`/issues/${number}/labels`);
    // GitHub answers 404 when the label is not on the issue: that is the lock.
    const removed = await this.api.request("DELETE", `${base}/${encodeURIComponent(from)}`, z.unknown(), { allow404: true });
    if (removed === null) return false;
    await this.api.send("POST", base, { labels: [to] });
    return true;
  }

  async addLabel(number: number, label: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/issues/${number}/labels`), { labels: [label] });
  }

  async removeLabel(number: number, label: string): Promise<void> {
    await this.api.request("DELETE", `${this.api.repoPath(`/issues/${number}/labels`)}/${encodeURIComponent(label)}`, z.unknown(), { allow404: true });
  }

  async comment(number: number, body: string): Promise<void> {
    await this.api.send("POST", this.api.repoPath(`/issues/${number}/comments`), { body: marked(body) });
  }

  createIssue(input: NewIssue): Promise<{ number: number; url: string | null }> {
    return createGitHubIssue(this.options, { ...input, body: marked(input.body) });
  }

  async canWrite(login: string): Promise<boolean> {
    try {
      const row = await this.api.getOrNull(this.api.repoPath(`/collaborators/${encodeURIComponent(login)}/permission`), permissionRow);
      if (row === null) return false;
      // `permission` folds maintain into write and triage into read; `role_name` keeps the real role.
      return ["admin", "maintain", "write"].includes(row.role_name ?? row.permission);
    } catch (error) {
      // Someone who is not a collaborator: 404; a user that does not exist: 404 or 422.
      if (error instanceof GitHubError && (error.status === 404 || error.status === 422)) return false;
      throw error;
    }
  }

  async labelActor(number: number, label: string): Promise<string | null> {
    const events = await this.api.list(this.api.repoPath(`/issues/${number}/events`), eventRow);
    let actor: string | null = null;
    for (const event of events) {
      if (event.label?.name !== label) continue;
      if (event.event === "labeled") actor = event.actor?.login ?? null;
      else if (event.event === "unlabeled") actor = null;
    }
    return actor;
  }
}
