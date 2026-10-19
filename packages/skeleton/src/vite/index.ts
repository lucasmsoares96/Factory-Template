import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import type { VirtualRouteNode } from "@tanstack/virtual-file-routes";
import react from "@vitejs/plugin-react";
import type { PluginOption } from "vite";
import { resolveLocale } from "../i18n/index.ts";
import { PRODUCT_ROUTE_TREE, routerConfig } from "./router.ts";

export { PRODUCT_ROUTE_TREE, routerConfig, type SpaLayout } from "./router.ts";

export type SkeletonViteOptions = {
  /** The Product's directory (`import.meta.dirname` in its vite.config.ts). */
  dir: string;
  /** The Product's own feature routes, each mounted by `physical()`. */
  routes?: VirtualRouteNode[];
};

/**
 * Every Vite plugin a Product's Worker needs: TanStack Router (same config as
 * `skeleton generate`), React, Tailwind (shadcn) and Cloudflare (the Worker and
 * its Static Assets). The `LOCALE` build variable picks the SPA's language.
 */
export function skeleton({ dir, routes }: SkeletonViteOptions): PluginOption[] {
  const locale = resolveLocale(process.env.LOCALE);
  return [
    {
      name: "skeleton",
      config: () => ({
        define: { "import.meta.env.LOCALE": JSON.stringify(locale) },
        resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/react-router"] },
      }),
    },
    tanstackRouter(routerConfig({ dir, routeTree: PRODUCT_ROUTE_TREE, routes })),
    react(),
    tailwindcss(),
    cloudflare(),
  ];
}
