/**
 * Tracker seam: issues, labels, blockers and issue comments.
 * Adapters: fake (in memory), Markdown local (ticket 10), GitHub (ticket 16).
 * Credentials live inside each adapter, never in this interface.
 */

export interface IssueComment {
  id: string;
  author: string;
  body: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  /** Parent issue (the spec), if any. */
  parent: { number: number; body: string } | null;
  /** Sub-issues; a non-empty list marks a parent spec. */
  children: number[];
  comments: IssueComment[];
}

export interface Blocker {
  number: number;
  /** Normalized: GitHub `closed`+`completed`, Forgejo `closed`, Markdown `Status: done`. */
  done: boolean;
}

export interface NewIssue {
  title: string;
  body: string;
  labels?: string[];
  /** The issue this one comes from. The adapter links back to it in the new issue. */
  relatedTo?: number;
}

export interface Tracker {
  issue(number: number): Promise<Issue>;
  /** Issues that block `number`. */
  blockers(number: number): Promise<Blocker[]>;
  /** Open issues that `number` blocks. */
  blocking(number: number): Promise<number[]>;
  /** Open issues that currently carry `label`. */
  labeled(label: string): Promise<number[]>;
  /**
   * Replaces `from` with `to`. Returns false, changing nothing, when `from`
   * is no longer on the issue: this is the lock.
   */
  swapLabel(number: number, from: string, to: string): Promise<boolean>;
  /** Adds `label` to the issue (a no-op when it is there). Markdown tickets have one status and no other labels: a no-op there. */
  addLabel(number: number, label: string): Promise<void>;
  /** Removes `label` from the issue (a no-op when it is not there). A no-op in the Markdown tracker. */
  removeLabel(number: number, label: string): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  /** Replaces the body of the issue. Not available in the Markdown tracker. */
  updateIssue(number: number, body: string): Promise<void>;
  /** Opens a new issue; returns its number and, when the forge has one, its URL. */
  createIssue(input: NewIssue): Promise<{ number: number; url: string | null }>;
  /** Whether `login` has `write` or higher on the repository. */
  canWrite(login: string): Promise<boolean>;
  /** Who last applied `label` to the issue, or null if it is not there. */
  labelActor(number: number, label: string): Promise<string | null>;
  /** How `label` came to be on the issue, or null if it is not there. */
  labelOrigin(number: number, label: string): Promise<LabelOrigin | null>;
}

export interface LabelOrigin {
  /** Who last applied the label. */
  actor: string;
  /**
   * When the same actor had just removed another label (a swap, as `swapLabel` makes it): that label and who had
   * applied it. Null for a label applied on its own.
   */
  replaced: { label: string; actor: string | null } | null;
}
