import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import type { ConversationEntry, ReviewThread, ThreadId } from "../src/seams/code-host.ts";
import { commitFile, derivedCheckout, git, HUMAN, lastJson, OWNER, readyIssue, tempDir, world, type World, type WorldOptions } from "./helpers.ts";

export const BRANCH = "factory/issue-7";
export const PR = 101;

/** What `main` did after the Factory branch was cut. */
export type MainChange = "none" | "clean" | "conflict";

async function setLine5(dir: string, value: number, message: string): Promise<void> {
  const file = join(dir, "src/app.ts");
  await writeFile(file, (await readFile(file, "utf8")).replace(/line5 = \d+/, `line5 = ${value}`));
  await git(dir, "commit", "--quiet", "-am", message);
}

/** A checkout with `factory/issue-7` (one commit, changing line 5) and `main` moved on by `main`. */
export function prCheckout(main: MainChange): Promise<string> {
  return derivedCheckout(`pr-flow-${main}`, async (dir) => {
    await git(dir, "checkout", "--quiet", "-b", BRANCH);
    await setLine5(dir, 500, "feat: change line five #7");
    await git(dir, "checkout", "--quiet", "main");
    if (main === "clean") await commitFile(dir, "src/main-only.ts", "export const fromMain = true;\n", "feat: main only");
    if (main === "conflict") await setLine5(dir, 55, "fix: line five from main");
  });
}

export const thread = (id: string, body: string, extra: Partial<ReviewThread> = {}): ReviewThread => ({
  id: id as ThreadId,
  path: "src/app.ts",
  author: HUMAN,
  body,
  replies: [],
  ...extra,
});

/** A comment in the PR's Conversation tab (`kind: "review"`: the body of a submitted review). */
export const said = (id: string, body: string, extra: Partial<ConversationEntry> = {}): ConversationEntry => ({ id, kind: "comment", author: HUMAN, body, ...extra });

export const replies = (...items: { threadId: string; decision: "address" | "decline" | "defer" | "answer"; body: string }[]) =>
  `<replies>${JSON.stringify({ threadReplies: items })}</replies>`;

export const reviewOk: AgentStep = () => ({ output: `<review>${JSON.stringify({ summary: "Fine.", inline: [] })}</review>` });

let edits = 0;
/** A Development session that commits one change and answers like `output`. */
export const commits = (output = ""): AgentStep => async ({ cwd }) => {
  edits++;
  await commitFile(cwd, "src/greet.ts", `export const greet = () => "hi ${edits}";\n`, `fix: address feedback #7 (${edits})`);
  return { output };
};

/** The Factory branch with a ready PR #101 whose issue #7 is `in-progress`, and two checkouts: one per job. */
export async function prWorld(input: { main: MainChange; threads?: ReviewThread[]; conversation?: ConversationEntry[]; draft?: boolean } & Pick<WorldOptions, "agent" | "verify">) {
  const [workRepo, publishRepo] = [await prCheckout(input.main), await prCheckout(input.main)];
  const head = await git(workRepo, "rev-parse", BRANCH);
  const w = world({
    repo: workRepo,
    issues: readyIssue({ labels: { "in-progress": OWNER } }),
    branches: { [BRANCH]: head },
    prs: [{ number: PR, branch: BRANCH, headSha: head, draft: input.draft ?? false, body: "Original body\n\nCloses #7", threads: input.threads ?? [], conversation: input.conversation ?? [] }],
    agent: input.agent,
    verify: input.verify,
  });
  const out = await tempDir("factory-out-");
  return { w, workRepo, publishRepo, head, out };
}

export type PrWorld = Awaited<ReturnType<typeof prWorld>>;

/** claim → work → publish → working off of a pr-feedback round through the CLI; returns the claim and the exit code of each job. */
export async function feedbackRound(p: PrWorld, options: { actor?: string; beforePublish?: () => void } = {}) {
  const { w } = p;
  expect(await w.factory("pr-feedback", "--pr", String(PR), "--actor", options.actor ?? HUMAN)).toBe(0);
  const claim = lastJson(w.logs) as { claimed: boolean; startSha?: string };
  if (!claim.claimed) return { claim, ran: false };
  await finishRound(p, ["--flow", "pr-feedback"], claim.startSha!, options.beforePublish);
  return { claim, ran: true };
}

/** work → publish → working off for a claimed PR flow. */
export async function finishRound(p: PrWorld, flow: string[], startSha: string, beforePublish?: () => void) {
  const { w } = p;
  expect(await w.factory("work", "7", ...flow, "--pr", String(PR), "--out", p.out, "--repo", p.workRepo)).toBe(0);
  beforePublish?.();
  expect(await w.factory("publish", "7", "--pr", String(PR), "--in", p.out, "--repo", p.publishRepo, "--start-sha", startSha)).toBe(0);
  // The last step of the run, as in the workflow.
  expect(await w.factory("working", "off", "7", "--pr", String(PR))).toBe(0);
}

export type { World };
