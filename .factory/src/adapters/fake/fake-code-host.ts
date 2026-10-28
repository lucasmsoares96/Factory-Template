import { marked } from "../../marker.ts";
import type {
  ActiveRun,
  CodeHost,
  ConversationEntry,
  EvidenceImage,
  FailedCheck,
  MergeResult,
  PrCheck,
  PullRequest,
  PushResult,
  ReactionTarget,
  Review,
  ReviewThread,
  FactoryWorkflow,
  ThreadId,
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
  /** What `failedChecks` returns, as seeded (the caller cuts the logs). */
  failedChecks: FailedCheck[];
  /** When set, `failedChecks` throws with this message. */
  failedChecksError?: string;
  /** Set by `merge`. */
  merged?: boolean;
  /** What `changedFiles` returns. */
  files: string[];
  /** When set, `merge` refuses with this reason. */
  mergeRefusal?: string;
}

/** In-memory CodeHost. Tests seed branches and read PRs and pushes back. */
export class FakeCodeHost implements CodeHost {
  readonly branches = new Map<string, string>();
  readonly pushes: { branch: string; sha: string; expectedSha: string | null }[] = [];
  readonly prs: FakePullRequest[] = [];
  readonly dispatches: { workflow: FactoryWorkflow; inputs: Record<string, string> }[] = [];
  /** Every write, in order, e.g. `openDraftPr #101`. */
  readonly writes: string[] = [];
  /** Every reaction the Factory left, in order. */
  readonly reactions: (ReactionTarget & { reaction: string })[] = [];
  /** What `activeRuns` returns, as seeded. */
  readonly runs: ActiveRun[] = [];
  /** The pull requests whose failed checks were read, in order. */
  readonly checkReads: number[] = [];
  /** The jobs of the pull request workflow at each head, as `prChecks` returns them. */
  readonly checksAt = new Map<string, PrCheck[]>();
  /** The conclusion of the newest deploy of the base branch that ended; null: none ended. */
  deploy: string | null = null;

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

  async unlabelPr(pr: number, label: string): Promise<void> {
    const target = this.pr(pr);
    // As on GitHub, removing a label that is not there changes nothing.
    if (!target.labels.includes(label)) return;
    target.labels = target.labels.filter((l) => l !== label);
    this.writes.push(`unlabelPr #${pr} ${label}`);
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

  async failedChecks(pr: number, _lines: number): Promise<FailedCheck[]> {
    this.checkReads.push(pr);
    const target = this.pr(pr);
    if (target.failedChecksError) throw new Error(target.failedChecksError);
    return structuredClone(target.failedChecks);
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

  async replyToThread(pr: number, threadId: ThreadId, body: string): Promise<void> {
    const thread = this.pr(pr).threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`FakeCodeHost: no thread ${threadId} on PR #${pr}`);
    thread.replies.push({ author: this.self, body: marked(body) });
    this.writes.push(`replyToThread #${pr} ${threadId}`);
  }

  async react(target: ReactionTarget, reaction: "eyes"): Promise<void> {
    this.reactions.push({ ...target, reaction });
    this.writes.push(`react ${target.kind} ${target.id}`);
  }

  async pullRequestBody(pr: number): Promise<string> {
    return this.pr(pr).body;
  }

  async changedFiles(pr: number): Promise<string[]> {
    return [...this.pr(pr).files];
  }

  async prChecks(sha: string): Promise<PrCheck[]> {
    return structuredClone(this.checksAt.get(sha) ?? []);
  }

  async lastDeploy(): Promise<string | null> {
    return this.deploy;
  }

  async merge(pr: number, sha: string): Promise<MergeResult> {
    const target = this.pr(pr);
    if (target.headSha !== sha) return { ok: false, reason: "Head branch was modified." };
    if (target.mergeRefusal) return { ok: false, reason: target.mergeRefusal };
    target.state = "closed";
    target.merged = true;
    this.writes.push(`merge #${pr}`);
    return { ok: true };
  }

  async activeRuns(): Promise<ActiveRun[]> {
    return structuredClone(this.runs);
  }

  async dispatch(workflow: FactoryWorkflow, inputs: Record<string, string>): Promise<void> {
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
    failedChecks: [],
    files: [],
    ...seed,
  };
}
