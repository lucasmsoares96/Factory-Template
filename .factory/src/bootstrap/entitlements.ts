import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** What a Plan says about one Entitlement: on, off or up to a number. */
export type EntitlementValue = boolean | number;

/** The metadata value Stripe holds for an Entitlement (`entitlement_<name>`). */
export const entitlementMetadata = (value: EntitlementValue): string => String(value);

/**
 * The Entitlement names in `billing({ entitlements: ["a", "b"] })` of a Product's `features/index.ts` (comments cut away).
 * Only string literals in an inline array are read; anything computed is not seen.
 */
export function parseEntitlements(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const list = /\bbilling\s*\(\s*\{[^}]*?\bentitlements\s*:\s*\[([^\]]*)\]/.exec(code)?.[1];
  if (list === undefined) return [];
  return [...new Set([...list.matchAll(/(["'`])([^"'`]+)\1/g)].map((match) => match[2]!))];
}

/** The Entitlements `apps/<id>` declares, read as text from `src/features/index.ts` under `root` (the repository). */
export function declaredEntitlements(root: string, productId: string): string[] {
  const file = resolve(root, "apps", productId, "src/features/index.ts");
  return existsSync(file) ? parseEntitlements(readFileSync(file, "utf8")) : [];
}

/** The declared names that no Plan sets (a Plan sets one by having `entitlement_<name>` in its metadata, on or off). */
export function missingEntitlements(declared: readonly string[], plans: readonly { entitlements: Record<string, unknown> }[]): string[] {
  return declared.filter((name) => !plans.some((plan) => name in plan.entitlements));
}
