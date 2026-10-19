import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { physical, rootRoute, type VirtualRouteNode } from "@tanstack/virtual-file-routes";

const skeletonSrc = fileURLToPath(new URL("..", import.meta.url));

/** Where every Product's route tree lives (committed). */
export const PRODUCT_ROUTE_TREE = "src/client/routeTree.gen.ts";

export type SpaLayout = {
  /** The composition's package directory (absolute). */
  dir: string;
  /** Where the route tree is generated, relative to `dir` (committed). */
  routeTree: string;
  /**
   * The composition's own feature routes, mounted next to the Skeleton's, e.g.
   * `physical("/notes", "../features/notes/routes")` (relative to the route tree's folder).
   */
  routes?: VirtualRouteNode[];
};

/**
 * TanStack Router's generator config, shared by `skeleton generate` and the Vite
 * plugin so both write the same `routeTree.gen.ts`. The Skeleton's root layout
 * and feature routes come first; each feature's routes enter by `physical()`.
 */
export function routerConfig({ dir, routeTree, routes = [] }: SpaLayout) {
  const generatedRouteTree = join(dir, routeTree);
  const routesDirectory = dirname(generatedRouteTree);
  // The generator joins (not resolves) these paths onto routesDirectory.
  const skeleton = (path: string) => relative(routesDirectory, join(skeletonSrc, path));
  return {
    target: "react" as const,
    autoCodeSplitting: true,
    routesDirectory,
    generatedRouteTree,
    quoteStyle: "double" as const,
    disableLogging: true,
    virtualRouteConfig: rootRoute(skeleton("client/root.tsx"), [
      physical(skeleton("features/home/routes")),
      physical(skeleton("features/auth/routes")),
      ...routes,
    ]),
  };
}
