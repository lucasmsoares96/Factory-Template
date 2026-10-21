import type {
  CodeHost,
  EvidenceGroup,
  PullRequest,
  PushResult,
  Review,
  ReviewThread,
} from "../../seams/code-host.ts";

export interface FakePullRequest extends PullRequest {
  title: string;
  body: string;
  base: string;
  reviews: Review[];
  /** The single evidence comment; `edits` counts how often it was rewritten. */
  evidence: { groups: EvidenceGroup[]; edits: number } | null;
  threads: ReviewThread[];
  labels: string[];
  /** Comments left on the PR outside reviews (e.g. when it is closed). */
  comments: string[];
}

/** In-memory CodeHost. Tests seed branches and read PRs and pushes back. */
export class FakeCodeHost implements CodeHost {
  readonly branches = new Map<string, string>();
  readonly pushes: { branch: string; sha: string; expectedSha: string | null }[] = [];
  readonly prs: FakePullRequest[] = [];
  readonly dispatches: { workflow: string; inputs: Record<string, string> }[] = [];
  /** Every write, in order, e.g. `openDraftPr #101`. */
  readonly writes: string[] = [];

  constructor(seed: { branches?: Record<string, string>; prs?: FakePullRequestSeed[] } = {}) {
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

  async pullRequest(number: number): Promise<PullRequest | null> {
    const pr = this.prs.find((p) => p.number === number);
    return pr ? { ...pr } : null;
  }

  async commentPr(pr: number, body: string): Promise<void> {
    this.pr(pr).comments.push(body);
    this.writes.push(`commentPr #${pr}`);
  }

  async openDraftPr(input: { branch: string; base: string; title: string; body: string }): Promise<PullRequest> {
    const headSha = this.branches.get(input.branch);
    if (!headSha) throw new Error(`FakeCodeHost: branch ${input.branch} was never pushed`);
    const number = Math.max(100, ...this.prs.map((p) => p.number)) + 1;
    const pr = fakePr({ number, headSha, draft: true, ...input });
    this.prs.push(pr);
    this.writes.push(`openDraftPr #${number}`);
    return { ...pr };
  }

  async updatePrBody(pr: number, body: string): Promise<void> {
    this.pr(pr).body = body;
    this.writes.push(`updatePrBody #${pr}`);
  }

  async markReady(pr: number): Promise<void> {
    this.pr(pr).draft = false;
    this.writes.push(`markReady #${pr}`);
  }

  async closePr(pr: number, comment?: string): Promise<void> {
    const target = this.pr(pr);
    if (comment) target.comments.push(comment);
    target.state = "closed";
    this.writes.push(`closePr #${pr}`);
  }

  async labelPr(pr: number, label: string): Promise<void> {
    const target = this.pr(pr);
    if (!target.labels.includes(label)) target.labels.push(label);
    this.writes.push(`labelPr #${pr} ${label}`);
  }

  async submitReview(pr: number, review: Review): Promise<void> {
    this.pr(pr).reviews.push(structuredClone(review));
    this.writes.push(`submitReview #${pr}`);
  }

  async threads(pr: number): Promise<ReviewThread[]> {
    return structuredClone(this.pr(pr).threads);
  }

  async replyToThread(pr: number, threadId: string, body: string): Promise<void> {
    const thread = this.pr(pr).threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`FakeCodeHost: no thread ${threadId} on PR #${pr}`);
    thread.replies.push({ author: "factory", body });
    this.writes.push(`replyToThread #${pr} ${threadId}`);
  }

  async postEvidence(pr: number, groups: EvidenceGroup[]): Promise<void> {
    const target = this.pr(pr);
    target.evidence = { groups: structuredClone(groups), edits: (target.evidence?.edits ?? -1) + 1 };
    this.writes.push(`postEvidence #${pr}`);
  }

  async dispatch(workflow: string, inputs: Record<string, string>): Promise<void> {
    this.dispatches.push({ workflow, inputs: { ...inputs } });
    this.writes.push(`dispatch ${workflow}`);
  }
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
    reviews: [],
    evidence: null,
    threads: [],
    labels: [],
    comments: [],
    ...seed,
  };
}
