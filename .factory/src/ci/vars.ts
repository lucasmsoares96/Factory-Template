// `node .factory/src/ci/vars.ts`: copies the repo variables that override Factory settings (`FACTORY_MAX_ATTEMPTS`,
// `FACTORY_LABELS_*`, ...) into `$GITHUB_ENV`, from the `vars` context passed as JSON in
// `$VARS_JSON`. Only the names `config.ts` defines are copied: a variable cannot set `NODE_OPTIONS` or a token.
import { appendFileSync } from "node:fs";
import { configVariables } from "../config.ts";

export function factoryEnvLines(varsJson: string): string[] {
  let vars: unknown;
  try {
    vars = JSON.parse(varsJson || "{}");
  } catch {
    return [];
  }
  if (vars === null || typeof vars !== "object") return [];
  const allowed = new Set(configVariables());
  return Object.entries(vars as Record<string, unknown>)
    .filter(([name, value]) => allowed.has(name) && typeof value === "string" && value !== "" && !/[\r\n]/.test(value))
    .map(([name, value]) => `${name}=${value}`)
    .sort();
}

if (import.meta.main) {
  const lines = factoryEnvLines(process.env.VARS_JSON ?? "");
  if (process.env.GITHUB_ENV && lines.length > 0) appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
  console.log(`${lines.length} Factory setting(s) from repo variables`);
}
