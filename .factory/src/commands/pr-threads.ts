import type { FactoryConfig } from "../config.ts";
import { isMarked } from "../marker.ts";
import type { CodeHost, ConversationEntry, ReviewThread, ThreadId } from "../seams/code-host.ts";
import type { Tracker } from "../seams/tracker.ts";

/** The Actions bot (previews, the Merge Gate notice): never a request, whatever the forge says of its access. */
export const ACTIONS_BOT ="github-actions[bot]";

/**
 * Threads still waiting for the Factory: the last comment has no Factory marker, and every comment in the thread was
 * written by someone with `write`+ (the Factory writes as the owner, who has it). The forge has no "resolved" flag in
 * the seam; the Factory never resolves a thread, so a thread is open until the Factory has had the last word.
 * Then the requests of the Conversation tab (see `conversationRequests`), as threads with `conversation` set.
 */
export async function openThreads(
  seams: { tracker: Tracker; codeHost: CodeHost },
  _config: FactoryConfig,
  pr: number,
): Promise<ReviewThread[]> {
  const open: ReviewThread[] = [];
  for (const thread of await seams.codeHost.threads(pr)) {
    const last = thread.replies.at(-1) ?? thread;
    if (isMarked(last.body)) continue;
    if (!(await onlyWriters(seams.tracker, thread))) continue;
    open.push(thread);
  }
  return [...open, ...(await conversationRequests(seams, pr))];
}

/** Hidden tag of a round's reply in the Conversation tab: `<!-- factory:answers comment-1 review-2 -->`, the ids it answers. */
export function answersTag(ids: string[]): string {
  return `<!-- factory:answers ${ids.join(" ")} -->`;
}

/** The request ids a marked entry answers; empty for any other Factory comment (update-branch, Previews, a discard, a session limit). */
function answeredIds(body: string): string[] {
  const tag = /<!-- factory:answers ([^>]*?) -->/.exec(body);
  return tag ? tag[1]!.split(/\s+/).filter(Boolean) : [];
}

/**
 * The Conversation tab has no threads: every writer's comment and review body is a request, open until a marked
 * round reply cites its id (`answersTag`). The order of the comments does not matter, and no other Factory comment
 * closes anything. Only writers' entries are read at all (not `github-actions[bot]`), so a stranger's text never
 * reaches the agent and a stranger's forged marker closes nothing.
 */
async function conversationRequests(seams: { tracker: Tracker; codeHost: CodeHost }, pr: number): Promise<ReviewThread[]> {
  const writers: ConversationEntry[] = [];
  for (const entry of await seams.codeHost.conversation(pr)) {
    if (entry.author !== ACTIONS_BOT && (await seams.tracker.canWrite(entry.author))) writers.push(entry);
  }
  const answered = new Set(writers.filter((e) => isMarked(e.body)).flatMap((e) => answeredIds(e.body)));
  return writers
    .filter((e) => !isMarked(e.body) && !answered.has(e.id))
    .map((e) => ({ id: e.id as ThreadId, path: null, conversation: true as const, author: e.author, body: e.body, replies: [] }));
}

/**
 * Every comment of the thread is a writer's: a thread with a stranger's text in it never reaches the agent (the prompt
 * is built from these threads), and is not answered. A stranger's forged marker does not help: the author is checked too.
 */
async function onlyWriters(tracker: Tracker, thread: ReviewThread): Promise<boolean> {
  for (const comment of [thread, ...thread.replies]) {
    if (!(await tracker.canWrite(comment.author))) return false;
  }
  return true;
}

/** The issue number of a Factory branch (`factory/issue-N`), or null for any other branch. */
export function issueOfBranch(config: FactoryConfig, branch: string): number | null {
  if (!branch.startsWith(config.branchPrefix)) return null;
  const rest = branch.slice(config.branchPrefix.length);
  return /^[1-9]\d*$/.test(rest) ? Number(rest) : null;
}
