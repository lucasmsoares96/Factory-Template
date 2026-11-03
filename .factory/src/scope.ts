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

/**
 * A file a person sees: the SPA's client code, a feature's screens (`routes/`, signed in; `public/`, visitors) and components (`.tsx`) and the
 * styles, in a Product (`apps/<id>/`) or in the Skeleton (its template included). Their diff sends the run through the Visual Review.
 */
const INTERFACE_PATH = /^(apps\/[^/]+\/|packages\/skeleton\/(template\/)?)(src\/client\/|src\/features\/[^/]+\/(routes|public)\/|src\/features\/.+\.tsx$|.*\.css$)/;

export function interfacePaths(changed: string[]): string[] {
  return changed.filter((p) => INTERFACE_PATH.test(p));
}

/** Interface files changed by `base..HEAD`. */
export async function changedInterfacePaths(git: Git, base: string): Promise<string[]> {
  const names = await git.run("-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", base, "HEAD");
  return interfacePaths(names.split("\n").filter(Boolean));
}

/** Files under the Skeleton changed by `base..HEAD`, in the working tree's branch. */
export async function changedSkeletonPaths(git: Git, base: string): Promise<string[]> {
  const names = await git.run("-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", base, "HEAD", "--", SKELETON_PATH);
  return skeletonPaths(names.split("\n").filter(Boolean));
}
