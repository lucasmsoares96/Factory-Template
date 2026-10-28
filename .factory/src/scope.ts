import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactoryConfig } from "./config.ts";
import { Git } from "./git.ts";
import type { SKELETON_PATCH_FILE } from "./result.ts";
import type { Issue } from "./seams/tracker.ts";

/**
 * The Skeleton boundary of a Product issue. A Product extends the Skeleton by
 * configuration only, so a Product issue never changes `packages/skeleton/`
 * (the template, `packages/skeleton/template/`, is under it). What the Product
 * needs from the Skeleton goes into a follow-up ticket instead, and a change
 * the run made there into a pull request of its own.
 */
export const SKELETON_PATH = "packages/skeleton/";

/**
 * The Product an issue targets, or null when it is not a Product issue:
 * 1. a `product:<id>` label (the label wins);
 * 2. else, if the issue text names `packages/skeleton`, it is Skeleton-scoped: null;
 * 3. else the first `apps/<id>` path, or `Product: <id>` line, in the issue text.
 * The parent spec is not read: a spec spans many Products.
 */
export function productOf(issue: Pick<Issue, "labels" | "title" | "body">, config: FactoryConfig): string | null {
  const label = issue.labels.find((l) => l.startsWith(config.labels.productPrefix));
  if (label) return label.slice(config.labels.productPrefix.length) || null;
  const text = `${issue.title}\n${issue.body}`;
  if (text.includes(SKELETON_PATH)) return null;
  return /\bapps\/([a-z0-9][a-z0-9-]*)/.exec(text)?.[1] ?? /^\W*Product:\W*([a-z0-9][a-z0-9-]*)/im.exec(text)?.[1] ?? null;
}

export function skeletonPaths(changed: string[]): string[] {
  return changed.filter((p) => p.startsWith(SKELETON_PATH));
}

/** Files under the Skeleton changed by `base..HEAD`, in the working tree's branch. */
export async function changedSkeletonPaths(git: Git, base: string): Promise<string[]> {
  const names = await git.run("-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", base, "HEAD", "--", SKELETON_PATH);
  return skeletonPaths(names.split("\n").filter(Boolean));
}

/**
 * Puts `paths` back as they are in `base` (removing what the branch added) and
 * commits that as a new commit: history is never rewritten.
 */
export async function revertToBase(git: Git, base: string, paths: string[], message: string): Promise<void> {
  // One call each (not one per path): git is the slow part of this job on a loaded machine.
  const listed = await git.run("-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", base, "--", ...paths);
  const inBase = new Set(listed.split("\n").filter(Boolean));
  const restore = paths.filter((p) => inBase.has(p));
  const remove = paths.filter((p) => !inBase.has(p));
  if (restore.length > 0) await git.run("checkout", base, "--", ...restore);
  if (remove.length > 0) await git.run("rm", "--quiet", "--force", "--ignore-unmatch", "--", ...remove);
  await git.run("-c", "user.name=Factory", "-c", "user.email=factory@localhost", "commit", "--quiet", "-m", message);
}

/** Text of every `<skeleton-gap>…</skeleton-gap>` in an agent message. */
export function skeletonGaps(output: string): string[] {
  return [...output.matchAll(/<skeleton-gap>([\s\S]*?)<\/skeleton-gap>/g)].map((m) => m[1]!.trim()).filter(Boolean);
}

/** A gap's text for comparison: case, whitespace and Markdown punctuation folded. */
function gapKey(gap: string): string {
  return ` ${gap.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/** A shorter gap only matches an equal one: "footer slot" must not swallow every gap that mentions a footer slot. */
const MIN_CONTAINED_WORDS = 4;

/** Whether two `gapKey`s name the same gap: equal, or the longer holds the shorter and the shorter is specific enough. */
function sameGap(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.includes(short) && short.trim().split(" ").length >= MIN_CONTAINED_WORDS;
}

/**
 * The gaps without repeats, in first-reported order (Development before Review).
 * Two gaps are the same when, folded by `gapKey`, they are equal or one contains
 * the other as whole words (see `sameGap`); the longer text is kept, so no word
 * of the ask is lost, in the place of the first.
 */
export function mergeGaps(gaps: Iterable<string>): string[] {
  const kept: { gap: string; key: string }[] = [];
  for (const gap of gaps) {
    const key = gapKey(gap);
    if (key.trim() === "") continue;
    const same = kept.find((k) => sameGap(k.key, key));
    if (!same) kept.push({ gap, key });
    else if (key.length > same.key.length) Object.assign(same, { gap, key });
  }
  return kept.map((k) => k.gap);
}

export interface SkeletonFollowUp {
  title: string;
  body: string;
  files: string[];
  gaps: string[];
  patch: typeof SKELETON_PATCH_FILE | null;
}

/** The `<skeleton-gap>` texts under their heading, for the Skeleton issue and pull request; nothing without gaps. */
export function gapsSection(gaps: string[]): string[] {
  return gaps.length > 0 ? ["", "## What the Skeleton must offer", "", ...gaps.map((g) => `<skeleton-gap>\n${g}\n</skeleton-gap>`)] : [];
}

/** The ticket asking for the Skeleton change; the Tracker adapter adds the link back to the issue. */
export function followUpTicket(issue: Pick<Issue, "number" | "title">, product: string, files: string[], reportedGaps: string[], patch: typeof SKELETON_PATCH_FILE | null): SkeletonFollowUp {
  const gaps = mergeGaps(reportedGaps);
  const body = [
    `The Skeleton must grow: Product \`${product}\` needs a change in \`${SKELETON_PATH}\` to finish #${issue.number} (${issue.title}).`,
    "",
    patch
      ? "A Product extends the Skeleton by configuration only, so the Factory removed this change from the Product pull request and opened it as a pull request of its own, from the base branch: review and merge it to close this issue."
      : "A Product extends the Skeleton by configuration only, so the Factory removed this change from the Product pull request.",
    ...gapsSection(gaps),
    ...(files.length > 0 ? ["", "## Files the Product run changed (removed from its branch)", "", ...files.map((f) => `- \`${f}\``)] : []),
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The Skeleton exposes what the Product needs, through its interface (grown in a separate change).",
  ].join("\n");
  return { title: `The Skeleton must grow: ${issue.title}`, body, files, gaps, patch };
}

/**
 * The reverted Skeleton change as one patch against `base`. `snapshots` maps each reverted file to the commit it was
 * reverted from: a file reverted in several attempts keeps its last version, each file diffed against `base`.
 */
export async function skeletonPatch(git: Git, base: string, snapshots: Map<string, string>): Promise<string> {
  const bySnapshot = new Map<string, string[]>();
  for (const [path, sha] of [...snapshots].sort(([a], [b]) => a.localeCompare(b))) bySnapshot.set(sha, [...(bySnapshot.get(sha) ?? []), path]);
  let patch = "";
  for (const [sha, paths] of bySnapshot) patch += await git.run("diff", "--binary", "--no-renames", "--full-index", base, sha, "--", ...paths);
  return patch;
}

/**
 * Applies `patch` on `base` in a throwaway worktree and commits it; returns the commit. Throws when the patch does not
 * apply, changes nothing, or changes anything outside `packages/skeleton/`: the Skeleton pull request carries only that.
 */
export async function skeletonCommit(git: Git, base: string, patch: string, message: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "factory-skeleton-"));
  const tree = new Git(dir);
  try {
    await git.run("worktree", "add", "--quiet", "--detach", dir, base);
    await tree.run("apply", "--index", "--whitespace=nowarn", patch);
    const names = await tree.run("-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--no-renames", base);
    const changed = names.split("\n").filter(Boolean);
    if (changed.length === 0) throw new Error("The Skeleton patch changes nothing.");
    const outside = changed.filter((p) => !p.startsWith(SKELETON_PATH));
    if (outside.length > 0) throw new Error(`The Skeleton patch changes files outside ${SKELETON_PATH}: ${outside.join(", ")}`);
    await tree.run("-c", "user.name=Factory", "-c", "user.email=factory@localhost", "commit", "--quiet", "--no-verify", "-m", message);
    return await tree.head();
  } finally {
    await git.run("worktree", "remove", "--force", dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}
