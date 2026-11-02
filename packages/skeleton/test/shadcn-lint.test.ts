import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// Runs the real Oxlint with a test config that turns a @shadcn/lint rule on. The fixture lives
// in the repo (not a temp dir) so the plugin resolves from node_modules and finds the Skeleton's theme.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const oxlint = join(repoRoot, "node_modules/.bin/oxlint");
const dir = "packages/skeleton/test/shadcn-lint";

test("@shadcn/lint loads and suggests a class from the Skeleton's scale", () => {
  const run = spawnSync(
    oxlint,
    ["--format", "json", "-c", `${dir}/oxlintrc.json`, `${dir}/Fixture.tsx`],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const { diagnostics } = JSON.parse(run.stdout) as {
    diagnostics: Array<{ code: string; message: string }>;
  };
  const found = diagnostics.find((d) => d.code.includes("no-arbitrary-values"));
  expect(found?.message).toContain("w-[13px]");
  expect(found?.message).toContain("Use");
});
