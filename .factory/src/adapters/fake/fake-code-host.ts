import { marked } from "../../marker.ts";
import type {
  CodeHost,
  ConversationEntry,
  EvidenceImage,
  PullRequest,
  PushResult,
  Review,
  ReviewThread,
  SubmittedReview,
} from "../../seams/code-host.ts";

export interface FakePullRequest extends PullRequest {
  title: string;
  body: string;
  base: string;
  /** Reviews on the PR; `author` is the Factory's login when unset (the ones `submitReview` adds). */
  reviews: (Review & { author?: string })[];
  /** The images received with the last body write; their references are URLs in `body`. */
  images: EvidenceImage[];
  threads: ReviewThread[];
  labels: string[];
  /** Comments left on the PR outside reviews (e.g. when it is closed). */
  comments: string[];
  /** The Conversation tab in order: seeded entries, then what the Factory writes there (comments and review bodies). */
  conversation: ConversationEntry[];
}

/** In-memory CodeHost. Tests seed branches and read PRs and pushes back. */
export class FakeCodeHost implements CodeHost {
  readonly branches = new Map<string, string>();
  readonly pushes: { branch: string; sha: string; expectedSha: string | null }[] = [];
  readonly prs: FakePullRequest[] = [];
  readonly dispatches: { workflow: string; inputs: Record<string, string> }[] = [];
  /** Every write, in order, e.g. `openDraftPr #101`. */
  readonly writes: string[] = [];

  /** Login the Factory writes as: author of its replies. */
  readonly self: string;

  constructor(seed: { branches?: Record<string, string>; prs?: FakePullRequestSeed[]; self?: string } = {}) {
    this.self = seed.self ?? "factory";
    for (const [branch, sha] of Object.entries(seed.branches ?? {})) this.branches.set(branch, sha);
    for (const pr of seed.prs ?? []) this.add(pr);
  }

  /** Seeds a pull request, as if someone opened it on the forge. */
  add(seed: FakePullRequestSeed): void {
    this.prs.push(fakePr(seed));
  }

  pr(number: number): FakePullRequest {
    const pr = this.prs.find((p) => p.number === number);
    if (!pr) throw new Error(`FakeCodeHost: no PR #${number}`);
    return pr;
  }

  async branchHead(branch: string): Promise<string | null> {
    return this.branches.get(branch) ?? null;
  }

  async push(input: { branch: string; sha: string; expectedSha: string | null }): Promise<PushResult> {
    this.pushes.push({ ...input });
    this.writes.push(`push ${input.branch}`);
    if ((this.branches.get(input.branch) ?? null) !== input.expectedSha) {
      return { ok: false, reason: "branch-moved" };
    }
    this.branches.set(input.branch, input.sha);
    for (const pr of this.prs) if (pr.branch === input.branch) pr.headSha = input.sha;
    return { ok: true };
  }

  async openPrFor(branch: string): Promise<PullRequest | null> {
    const pr = this.prs.find((p) => p.branch === branch && p.state === "open");
    return pr ? { ...pr } : null;
  }

  async openPullRequests(): Promise<PullRequest[]> {
    return this.prs.filter((p) => p.state === "open").map((p) => ({ ...p }));
  }

  async pullRequest(number: number): Promise<PullRequest | null> {
    const pr = this.prs.find((p) => p.number === number);
    return pr ? { ...pr } : null;
  }

  async commentPr(pr: number, body: string): Promise<void> {
    this.say(pr, marked(body));
    this.writes.push(`commentPr #${pr}`);
  }

  async openDraftPr(input: { branch: string; base: string; title: string; body: string; images?: EvidenceImage[] }): Promise<PullRequest> {
    const headSha = this.branches.get(input.branch);
    if (!headSha) throw new Error(`FakeCodeHost: branch ${input.branch} was never pushed`);
    const number = Math.max(100, ...this.prs.map((p) => p.number)) + 1;
    const { images = [], ...rest } = input;
    const pr = fakePr({ number, headSha, draft: true, ...rest, body: withUrls(marked(rest.body), number, images), images: structuredClone(images) });
    this.prs.push(pr);
    this.writes.push(`openDraftPr #${number}`);
    return { ...pr };
  }

  async updatePrBody(pr: number, body: string, images: EvidenceImage[] = []): Promise<void> {
    const target = this.pr(pr);
    target.body = withUrls(marked(body), pr, images);
    target.images = structuredClone(images);
    this.writes.push(`updatePrBody #${pr}`);
  }

  async markReady(pr: number): Promise<void> {
    this.pr(pr).draft = false;
    this.writes.push(`markReady #${pr}`);
  }

  async closePr(pr: number, comment?: string): Promise<void> {
    const target = this.pr(pr);
    if (comment) this.say(pr, marked(comment));
    target.state = "closed";
    this.writes.push(`closePr #${pr}`);
  }

  async labelPr(pr: number, label: string): Promise<void> {
    const target = this.pr(pr);
    if (!target.labels.includes(label)) target.labels.push(label);
    this.writes.push(`labelPr #${pr} ${label}`);
  }

  async submitReview(pr: number, review: Review): Promise<void> {
    this.pr(pr).reviews.push(structuredClone({ ...review, body: marked(review.body), comments: review.comments.map((c) => ({ ...c, body: marked(c.body) })) }));
    this.pr(pr).conversation.push({ id: `review-f${this.pr(pr).conversation.length + 1}`, kind: "review", author: this.self, body: marked(review.body) });
    this.writes.push(`submitReview #${pr}`);
  }

  async threads(pr: number): Promise<ReviewThread[]> {
    return structuredClone(this.pr(pr).threads);
  }

  async reviews(pr: number): Promise<SubmittedReview[]> {
    return this.pr(pr).reviews.map((r) => ({ author: r.author ?? this.self, body: r.body }));
  }

  async conversation(pr: number): Promise<ConversationEntry[]> {
    return structuredClone(this.pr(pr).conversation.filter((e) => e.body.trim() !== ""));
  }

  /** A comment by the Factory in the Conversation tab. */
  private say(pr: number, body: string): void {
    const target = this.pr(pr);
    target.comments.push(body);
    target.conversation.push({ id: `comment-f${target.conversation.length + 1}`, kind: "comment", author: this.self, body });
  }

  async replyToThread(pr: number, threadId: string, body: string): Promise<void> {
    const thread = this.pr(pr).threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`FakeCodeHost: no thread ${threadId} on PR #${pr}`);
    thread.replies.push({ author: this.self, body: marked(body) });
    this.writes.push(`replyToThread #${pr} ${threadId}`);
  }

  async dispatch(workflow: string, inputs: Record<string, string>): Promise<void> {
    this.dispatches.push({ workflow, inputs: { ...inputs } });
    this.writes.push(`dispatch ${workflow}`);
  }
}

/** Where the fake "uploads" a print. */
function withUrls(body: string, pr: number, images: EvidenceImage[]): string {
  return images.reduce((text, i) => text.replaceAll(i.path, `https://forge.test/pr/${pr}/images/${i.product}/${i.name}`), body);
}

export type FakePullRequestSeed = Pick<FakePullRequest, "number" | "branch"> & Partial<FakePullRequest>;

function fakePr(seed: FakePullRequestSeed): FakePullRequest {
  return {
    url: `https://forge.test/pr/${seed.number}`,
    headSha: "0".repeat(40),
    state: "open",
    draft: false,
    title: `PR ${seed.number}`,
    body: "",
    base: "main",
    fork: false,
    reviews: [],
    images: [],
    threads: [],
    labels: [],
    comments: [],
    conversation: [],
    ...seed,
  };
}
