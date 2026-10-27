/**
 * CodeHost seam: branches, pull requests (body with its evidence images), reviews and threads.
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
  /** The branch it merges into. */
  base: string;
  /** Its head lives in another repository: the Factory cannot push there, and never runs its code. */
  fork: boolean;
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

/** A review someone submitted on a pull request: its body only (the inline comments come with `threads`). */
export interface SubmittedReview {
  author: string;
  body: string;
}

/** One entry of the pull request's Conversation tab: a comment, or the body of a submitted review. */
export interface ConversationEntry {
  /** Unique across both kinds (`comment-<id>`, `review-<id>` on GitHub), never equal to a thread id. */
  id: string;
  kind: "comment" | "review";
  author: string;
  body: string;
}

export interface ReviewThread {
  id: string;
  path: string | null;
  /** A request from the Conversation tab rather than an inline thread: it is answered there, in one comment for the round. */
  conversation?: true;
  author: string;
  body: string;
  replies: { author: string; body: string }[];
}

/** A print of the evidence. The body references it by `path`; the adapter uploads it and swaps the reference for a URL. */
export interface EvidenceImage {
  product: string;
  name: string;
  path: string;
}

/** A check that ended in `failure` or `timed_out` on a pull request's head, with the end of its job's log. */
export interface FailedCheck {
  name: string;
  url: string;
  /** The last lines of the job's log. */
  log: string;
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
  /** Every open pull request of the repository, drafts and forks included. */
  openPullRequests(): Promise<PullRequest[]>;
  /** Pull request `number` in any state, or null when it does not exist. */
  pullRequest(number: number): Promise<PullRequest | null>;
  /** A conversation comment on the pull request (not a review thread). */
  commentPr(pr: number, body: string): Promise<void>;
  /**
   * `body` references each of `images` as `![alt](<image.path>)`: the adapter uploads the print, replaces that
   * reference with its URL and writes the body.
   */
  openDraftPr(input: { branch: string; base: string; title: string; body: string; images?: EvidenceImage[] }): Promise<PullRequest>;
  /** Replaces the body of the pull request, with its images as in `openDraftPr`. */
  updatePrBody(pr: number, body: string, images?: EvidenceImage[]): Promise<void>;
  markReady(pr: number): Promise<void>;
  /** Closes the pull request, leaving `comment` on it first when given. */
  closePr(pr: number, comment?: string): Promise<void>;
  /** Adds `label` to the pull request. */
  labelPr(pr: number, label: string): Promise<void>;
  submitReview(pr: number, review: Review): Promise<void>;
  threads(pr: number): Promise<ReviewThread[]>;
  /** The reviews submitted on the pull request, oldest first. */
  reviews(pr: number): Promise<SubmittedReview[]>;
  /**
   * The checks that ended in `failure` or `timed_out` on the pull request's current head, each with the last `lines`
   * lines of its job's log. Throws when the forge cannot be read.
   */
  failedChecks(pr: number, lines: number): Promise<FailedCheck[]>;
  /** The Conversation tab, oldest first: its comments and the bodies of submitted reviews (empty bodies left out). */
  conversation(pr: number): Promise<ConversationEntry[]>;
  replyToThread(pr: number, threadId: string, body: string): Promise<void>;
  /** Starts a Factory workflow run (e.g. `issue` for an unblocked issue). */
  dispatch(workflow: string, inputs: Record<string, string>): Promise<void>;
}
