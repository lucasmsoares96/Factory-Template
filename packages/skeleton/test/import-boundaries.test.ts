import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

// Runs the repository's real lint config over a throwaway tree with the same layout.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const oxlint = join(repoRoot, "node_modules/.bin/oxlint");
let tree: string;

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), "import-boundaries-"));
  copyFileSync(join(repoRoot, ".oxlintrc.json"), join(tree, ".oxlintrc.json"));
});
afterEach(() => rmSync(tree, { recursive: true, force: true }));

function write(path: string, source: string) {
  mkdirSync(dirname(join(tree, path)), { recursive: true });
  writeFileSync(join(tree, path), source);
}

/** The import specifiers the lint rejects, by file. */
function rejectedImports() {
  const run = spawnSync(oxlint, ["--format", "json"], { cwd: tree, encoding: "utf8" });
  const { diagnostics } = JSON.parse(run.stdout) as {
    diagnostics: Array<{ code: string; filename: string; message: string }>;
  };
  const rejected = diagnostics
    .filter((d) => d.code.endsWith("(no-restricted-imports)"))
    .map((d) => `${d.filename}: ${d.message.match(/'([^']+)'/)?.[1]}`);
  return [...new Set(rejected)].sort();
}

test("a Product imports only the Skeleton's public exports", () => {
  write(
    "apps/shop/src/worker.ts",
    [
      `import { createApp } from "@workspace/skeleton";`,
      `import { defineProductDrizzleConfig } from "@workspace/skeleton/drizzle";`,
      `import { health } from "@workspace/skeleton/src/platform/health.ts";`,
      `import { database } from "../../../packages/skeleton/src/platform/db.ts";`,
      `export { createApp, defineProductDrizzleConfig, health, database };`,
    ].join("\n"),
  );

  expect(rejectedImports()).toEqual([
    "apps/shop/src/worker.ts: ../../../packages/skeleton/src/platform/db.ts",
    "apps/shop/src/worker.ts: @workspace/skeleton/src/platform/health.ts",
  ]);
});

test("the Skeleton never imports from apps/", () => {
  write(
    "packages/skeleton/src/platform/app.ts",
    [
      `import { config } from "../../../../apps/shop/product.config.ts";`,
      `const lazy = await import("../../../../apps/shop/src/worker.ts");`,
      `import { local } from "./local.ts";`,
      `export { config, lazy, local };`,
    ].join("\n"),
  );

  expect(rejectedImports()).toEqual([
    "packages/skeleton/src/platform/app.ts: ../../../../apps/shop/product.config.ts",
    "packages/skeleton/src/platform/app.ts: ../../../../apps/shop/src/worker.ts",
  ]);
});
