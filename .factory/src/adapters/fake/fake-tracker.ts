import { marked } from "../../marker.ts";
import type { Blocker, Issue, IssueComment, NewIssue, Tracker } from "../../seams/tracker.ts";

export interface FakeIssueInput {
  number: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
  /** Labels with the login that applied each one. */
  labels?: Record<string, string>;
  parent?: number | null;
  comments?: { author: string; body: string }[];
  blockedBy?: number[];
  /** For blockers: whether the issue counts as `done`. */
  done?: boolean;
}

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: Map<string, string>;
  parent: number | null;
  comments: IssueComment[];
  blockedBy: number[];
  done: boolean;
  relatedTo: number | null;
}

/** In-memory Tracker. Tests seed it and read its state back. */
export class FakeTracker implements Tracker {
  readonly issues = new Map<number, FakeIssue>();
  readonly writers = new Set<string>();
  /** Login the Factory writes as: author of its comments and actor of its label changes. */
  readonly self: string;
  private nextCommentId = 1;

  constructor(seed: { issues?: FakeIssueInput[]; writers?: string[]; self?: string } = {}) {
    this.self = seed.self ?? "factory";
    for (const issue of seed.issues ?? []) this.add(issue);
    for (const login of seed.writers ?? []) this.writers.add(login);
  }

  add(input: FakeIssueInput): void {
    this.issues.set(input.number, {
      number: input.number,
      title: input.title ?? `Issue ${input.number}`,
      body: input.body ?? "",
      state: input.state ?? "open",
      labels: new Map(Object.entries(input.labels ?? {})),
      parent: input.parent ?? null,
      comments: (input.comments ?? []).map((c) => ({ id: `c${this.nextCommentId++}`, ...c })),
      blockedBy: input.blockedBy ?? [],
      done: input.done ?? false,
      relatedTo: null,
    });
  }

  /** Labels currently on the issue. */
  labelsOf(number: number): string[] {
    return [...this.get(number).labels.keys()];
  }

  commentsOn(number: number): IssueComment[] {
    return this.get(number).comments;
  }

  async issue(number: number): Promise<Issue> {
    const issue = this.get(number);
    const parent = issue.parent === null ? null : this.get(issue.parent);
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: [...issue.labels.keys()],
      parent: parent && { number: parent.number, body: parent.body },
      children: [...this.issues.values()].filter((i) => i.parent === number).map((i) => i.number),
      comments: issue.comments.map((c) => ({ ...c })),
    };
  }

  async blockers(number: number): Promise<Blocker[]> {
    return this.get(number).blockedBy.map((n) => ({ number: n, done: this.get(n).done }));
  }

  async blocking(number: number): Promise<number[]> {
    return [...this.issues.values()]
      .filter((i) => i.state === "open" && i.blockedBy.includes(number))
      .map((i) => i.number);
  }

  async labeled(label: string): Promise<number[]> {
    return [...this.issues.values()]
      .filter((i) => i.state === "open" && i.labels.has(label))
      .map((i) => i.number);
  }

  async swapLabel(number: number, from: string, to: string): Promise<boolean> {
    const issue = this.get(number);
    if (!issue.labels.has(from)) return false;
    issue.labels.delete(from);
    issue.labels.set(to, this.self);
    return true;
  }

  async addLabel(number: number, label: string): Promise<void> {
    const issue = this.get(number);
    if (!issue.labels.has(label)) issue.labels.set(label, this.self);
  }

  async comment(number: number, body: string): Promise<void> {
    this.get(number).comments.push({ id: `c${this.nextCommentId++}`, author: this.self, body: marked(body) });
  }

  async createIssue(input: NewIssue): Promise<{ number: number; url: string | null }> {
    const number = Math.max(0, ...this.issues.keys()) + 1;
    this.add({ number, title: input.title, body: input.body, labels: Object.fromEntries((input.labels ?? []).map((l) => [l, this.self])) });
    this.get(number).relatedTo = input.relatedTo ?? null;
    return { number, url: `https://forge.test/issues/${number}` };
  }

  async canWrite(login: string): Promise<boolean> {
    return this.writers.has(login);
  }

  async labelActor(number: number, label: string): Promise<string | null> {
    return this.get(number).labels.get(label) ?? null;
  }

  private get(number: number): FakeIssue {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`FakeTracker: no issue #${number}`);
    return issue;
  }
}
