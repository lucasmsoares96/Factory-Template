import { resolveLocale } from "../i18n/index.ts";

// Replaced at build time by the Skeleton's Vite plugin (`LOCALE`). A Worker bundled
// without it (the Skeleton's test composition, run by wrangler) gets English.
declare const __SKELETON_LOCALE__: string | undefined;

/** The Worker's locale: the one the SPA was built with. */
export const buildLocale = resolveLocale(typeof __SKELETON_LOCALE__ === "string" ? __SKELETON_LOCALE__ : undefined);
