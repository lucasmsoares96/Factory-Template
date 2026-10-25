import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { layout, physical, rootRoute, type VirtualRouteNode } from "@tanstack/virtual-file-routes";

const skeletonSrc = fileURLToPath(new URL("..", import.meta.url));

/** Where every Product's route tree lives (committed). */
export const PRODUCT_ROUTE_TREE = "src/client/routeTree.gen.ts";

export type SpaLayout = {
  /** The composition's package directory (absolute). */
  dir: string;
  /** Where the route tree is generated, relative to `dir` (committed). */
  routeTree: string;
  /**
   * The composition's own feature routes, mounted next to the Skeleton's home
   * page under the signed-in layout (a visitor without a session goes to the
   * sign-in screen), e.g. `physical("/notes", "../features/notes/routes")`
   * (relative to the route tree's folder).
   */
  routes?: VirtualRouteNode[];
  /**
   * Routes a visitor without a session can open, mounted at the root next to
   * the sign-in and sign-up screens.
   */
  publicRoutes?: VirtualRouteNode[];
};

/**
 * The UI routes of a Product's features, found by convention: for each
 * `src/features/<id>/`, `routes/` (signed-in) and `public/` (open to visitors)
 * mount at `/<id>`. Both `skeleton generate` and the Vite plugin call it, so
 * they always write the same route tree.
 */
export function featureRoutes(dir: string, routeTree: string = PRODUCT_ROUTE_TREE) {
  const routesDirectory = dirname(join(dir, routeTree));
  const featuresDir = join(dir, "src/features");
  const found: { routes: VirtualRouteNode[]; publicRoutes: VirtualRouteNode[] } = { routes: [], publicRoutes: [] };
  if (!existsSync(featuresDir)) return found;
  for (const entry of readdirSync(featuresDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    for (const [folder, list] of [["routes", found.routes], ["public", found.publicRoutes]] as const) {
      const routesPath = join(featuresDir, entry.name, folder);
      if (existsSync(routesPath)) list.push(physical(`/${entry.name}`, relative(routesDirectory, routesPath)));
    }
  }
  return found;
}

/**
 * TanStack Router's generator config, shared by `skeleton generate` and the Vite
 * plugin so both write the same `routeTree.gen.ts`. The Skeleton's root layout
 * holds the public auth screens and the signed-in layout, which holds the home
 * page, the account page, the Company pages (`/c/...`) and the composition's
 * routes; each feature's routes enter by `physical()`.
 */
export function routerConfig({ dir, routeTree, routes = [], publicRoutes = [] }: SpaLayout) {
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
      physical(skeleton("features/auth/routes")),
      ...publicRoutes,
      layout("_signed-in", skeleton("client/signed-in.tsx"), [
        physical(skeleton("features/home/routes")),
        physical("/account", skeleton("features/account/routes")),
        physical("/c", skeleton("features/companies/routes")),
        ...routes,
      ]),
    ]),
  };
}
