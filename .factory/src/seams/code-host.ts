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

/** A print of the evidence. The body references it by `path`; the adapter uploads it and swaps the reference for a URL. */
export interface EvidenceImage {
  product: string;
  name: string;
  path: string;
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
  replyToThread(pr: number, threadId: string, body: string): Promise<void>;
  /** Starts a Factory workflow run (e.g. `issue` for an unblocked issue). */
  dispatch(workflow: string, inputs: Record<string, string>): Promise<void>;
}
