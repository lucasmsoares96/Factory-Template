import { Git } from "./git.ts";

/**
 * The Skeleton's path (the template, `packages/skeleton/template/`, is under it).
 * A Product issue may change it in its own pull request (ADR 0017): the change
 * reaches every Product, so the pull request warns and the Review checks it.
 */
export const SKELETON_PATH = "packages/skeleton/";

export function skeletonPaths(changed: string[]): string[] {
  return changed.filter((p) => p.startsWith(SKELETON_PATH));
}

/** Files under the Skeleton changed by `base..HEAD`, in the working tree's branch. */
export async function changedSkeletonPaths(git: Git, base: string): Promise<string[]> {
  const names = await git.run("-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", base, "HEAD", "--", SKELETON_PATH);
  return skeletonPaths(names.split("\n").filter(Boolean));
}
