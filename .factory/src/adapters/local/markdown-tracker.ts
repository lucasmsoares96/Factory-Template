import { marked } from "../../marker.ts";
import type { Blocker, Issue, LabelOrigin, NewIssue, Tracker } from "../../seams/tracker.ts";
import { comments, isClosed, MarkdownIssues } from "./markdown-issues.ts";

export interface MarkdownTrackerOptions {
  /** The `issues/` directory of one feature, e.g. `.scratch/factory-base/issues`. */
  dir: string;
  /** Login the Factory writes as. */
  self: string;
  /** The local human: author of the hand-written comments and of every Status they set. */
  human: string;
}

/**
 * Tracker over the local Markdown tickets: the `Status:` line is the label,
 * `Blocked by:` the blockers (unblocked when all are `done`) and `## Comments`
 * the conversation. Whoever edits the files is the local human, who can write.
 */
export class MarkdownTracker implements Tracker {
  readonly files: MarkdownIssues;
  private readonly self: string;
  private readonly human: string;

  constructor(options: MarkdownTrackerOptions) {
    this.files = new MarkdownIssues(options.dir);
    this.self = options.self;
    this.human = options.human;
  }

  async issue(number: number): Promise<Issue> {
    const { issue } = await this.files.read(number);
    const spec = issue.specPath ? await this.files.readSpec(issue.specPath) : null;
    return {
      number,
      title: issue.title,
      body: issue.body,
      state: isClosed(issue.status) ? "closed" : "open",
      stateReason: null,
      labels: issue.status ? [issue.status] : [],
      parent: spec === null ? null : { number: 0, body: spec },
      children: [],
      comments: comments(issue, this.human),
    };
  }

  async blockers(number: number): Promise<Blocker[]> {
    const { issue } = await this.files.read(number);
    return Promise.all(
      issue.blockedBy.map(async (n) => ({ number: n, done: (await this.files.read(n)).issue.status === "done" })),
    );
  }

  async addBlocker(number: number, blockedBy: number): Promise<void> {
    const { issue } = await this.files.read(number);
    if (issue.blockedBy.includes(blockedBy)) return;
    const { file } = await this.files.read(blockedBy);
    await this.files.setBlockedBy(number, [...issue.blockedBy.map((n) => n.toString().padStart(2, "0")), file.id]);
  }

  async blocking(number: number): Promise<number[]> {
    return this.scan((issue) => !isClosed(issue.status) && issue.blockedBy.includes(number));
  }

  async labeled(label: string): Promise<number[]> {
    return this.scan((issue) => !isClosed(issue.status) && issue.status === label);
  }

  async swapLabel(number: number, from: string, to: string): Promise<boolean> {
    const { issue } = await this.files.read(number);
    if (issue.status !== from) return false;
    await this.files.setStatus(number, to);
    return true;
  }

  async addLabel(_number: number, _label: string): Promise<void> {
    // The Status line is the only label of a Markdown ticket.
  }

  async removeLabel(_number: number, _label: string): Promise<void> {
    // The Status line is the only label of a Markdown ticket.
  }

  async comment(number: number, body: string): Promise<void> {
    await this.files.appendComment(number, this.self, marked(body));
  }

  async updateIssue(number: number, _body: string): Promise<void> {
    throw new Error(`Editing the body of ticket ${number} is not available in local mode.`);
  }

  async rewriteIssueBody(number: number, _body: string): Promise<void> {
    throw new Error(`Editing the body of ticket ${number} is not available in local mode.`);
  }

  async createIssue(input: NewIssue): Promise<{ number: number; url: string | null }> {
    return { number: (await this.files.create(input)).number, url: null };
  }

  async canWrite(_login: string): Promise<boolean> {
    return true;
  }

  async labelActor(number: number, label: string): Promise<string | null> {
    const { issue } = await this.files.read(number);
    return issue.status === label ? this.human : null;
  }

  /** A ticket keeps no history: every Status is the local human's. */
  async labelOrigin(number: number, label: string): Promise<LabelOrigin | null> {
    const actor = await this.labelActor(number, label);
    return actor === null ? null : { actor, replaced: null };
  }

  private async scan(match: (issue: Awaited<ReturnType<MarkdownIssues["read"]>>["issue"]) => boolean): Promise<number[]> {
    const found: number[] = [];
    for (const file of await this.files.files()) {
      if (match((await this.files.read(file.number)).issue)) found.push(file.number);
    }
    return found;
  }
}
