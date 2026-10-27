import type { FactoryConfig } from "./config.ts";
import type { Git } from "./git.ts";
import type { Issue } from "./seams/tracker.ts";

/**
 * The Skeleton boundary of a Product issue. A Product extends the Skeleton by
 * configuration only, so a Product issue never changes `packages/skeleton/`
 * (the template, `packages/skeleton/template/`, is under it). What the Product
 * needs from the Skeleton goes into a follow-up ticket instead.
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

/**
 * The gaps without repeats, in first-reported order (Development before Review).
 * Two gaps are the same when, folded by `gapKey`, one equals or contains the
 * other (as whole words); the longer text is kept, in the place of the first.
 */
export function mergeGaps(gaps: Iterable<string>): string[] {
  const kept: { gap: string; key: string }[] = [];
  for (const gap of gaps) {
    const key = gapKey(gap);
    if (key.trim() === "") continue;
    const same = kept.find((k) => k.key.includes(key) || key.includes(k.key));
    if (!same) kept.push({ gap, key });
    else if (key.length > same.key.length) Object.assign(same, { gap, key });
  }
  return kept.map((k) => k.gap);
}

export interface SkeletonFollowUp {
  title: string;
  body: string;
  files: string[];
}

/** The ticket asking for the Skeleton change; the Tracker adapter adds the link back to the issue. */
export function followUpTicket(issue: Pick<Issue, "number" | "title">, product: string, files: string[], reported: string[]): SkeletonFollowUp {
  const gaps = mergeGaps(reported);
  const body = [
    `The Skeleton must grow: Product \`${product}\` needs a change in \`${SKELETON_PATH}\` to finish #${issue.number} (${issue.title}).`,
    "",
    "A Product extends the Skeleton by configuration only, so the Factory removed this change from the Product pull request.",
    ...(gaps.length > 0 ? ["", "## What the Skeleton must offer", "", ...gaps.map((g) => `<skeleton-gap>\n${g}\n</skeleton-gap>`)] : []),
    ...(files.length > 0 ? ["", "## Files the Product run changed (removed from its branch)", "", ...files.map((f) => `- \`${f}\``)] : []),
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The Skeleton exposes what the Product needs, through its interface (grown in a separate change).",
  ].join("\n");
  return { title: `The Skeleton must grow: ${issue.title}`, body, files };
}
