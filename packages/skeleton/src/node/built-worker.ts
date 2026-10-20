import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The `wrangler.json` that `vite build` wrote for the Product in `dir`. The
 * Cloudflare Vite plugin names the output folder after the Worker in a form of
 * its own (`ci-probe` becomes `ci_probe`), so ask the redirect it leaves in
 * `.wrangler/deploy/config.json` instead of guessing.
 */
export function builtWorkerConfig(dir: string): string {
  const redirect = join(dir, ".wrangler/deploy/config.json");
  let configPath: string;
  try {
    ({ configPath } = JSON.parse(readFileSync(redirect, "utf8")) as { configPath: string });
  } catch {
    throw new Error(`No build output for ${dir}: run \`vite build\` first (expected ${redirect}).`);
  }
  return resolve(dirname(redirect), configPath);
}
