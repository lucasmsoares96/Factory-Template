/**
 * CodeHost seam: branches, pull requests, reviews, threads and evidence.
 * Adapters: fake (in memory), local (ticket 10), GitHub (ticket 16).
 * The adapter is bound to the local repository it pushes from; credentials
 * live inside the adapter, never in this interface.
 */

export interface PullRequest {
  number: number;
  url: string;
  branch: string;
  headSha: string;
  state: "open" | "closed";
  draft: boolean;
}

export interface InlineComment {
  path: string;
  /** Line on the new side of the diff. */
  line: number;
  body: string;
}

export interface Review {
  body: string;
  event: "COMMENT";
  comments: InlineComment[];
}

export interface ReviewThread {
  id: string;
  path: string | null;
  author: string;
  body: string;
  replies: { author: string; body: string }[];
}

export interface EvidenceGroup {
  product: string;
  images: { name: string; path: string }[];
}

export type PushResult = { ok: true } | { ok: false; reason: "branch-moved" };

export interface CodeHost {
  /** Head of `branch` on the host, or null when it does not exist. */
  branchHead(branch: string): Promise<string | null>;
  /**
   * Pushes local `sha` to `branch` with `--force-with-lease` against
   * `expectedSha` (null: the branch must not exist).
   */
  push(input: { branch: string; sha: string; expectedSha: string | null }): Promise<PushResult>;
  /** The open pull request whose head is `branch`, if any. */
  openPrFor(branch: string): Promise<PullRequest | null>;
  openDraftPr(input: { branch: string; base: string; title: string; body: string }): Promise<PullRequest>;
  markReady(pr: number): Promise<void>;
  /** Closes the pull request, leaving `comment` on it first when given. */
  closePr(pr: number, comment?: string): Promise<void>;
  /** Adds `label` to the pull request. */
  labelPr(pr: number, label: string): Promise<void>;
  submitReview(pr: number, review: Review): Promise<void>;
  threads(pr: number): Promise<ReviewThread[]>;
  replyToThread(pr: number, threadId: string, body: string): Promise<void>;
  /** Creates the single evidence comment of the PR, or edits it. */
  postEvidence(pr: number, groups: EvidenceGroup[]): Promise<void>;
  /** Starts a Factory workflow run (e.g. `issue` for an unblocked issue). */
  dispatch(workflow: string, inputs: Record<string, string>): Promise<void>;
}
