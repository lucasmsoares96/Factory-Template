import { join } from "node:path";
import { expect, test } from "vitest";
import { defineE2EConfig } from "../e2e/index.ts";

// Seam 5: which specs a Product's `playwright test` runs.

test("a Product's E2E runs the Skeleton's specs and its own, from apps/<id>/e2e", () => {
  const dir = join("/repo/apps", "shop");
  const config = defineE2EConfig({ product: "shop", dir });

  const testDirs = (config.projects ?? []).map((project) => project.testDir);
  expect(testDirs).toHaveLength(2);
  expect(testDirs[0]).toMatch(/skeleton\/e2e\/specs$/);
  expect(testDirs[1]).toBe(join(dir, "e2e"));
  for (const project of config.projects ?? []) expect(project.use?.browserName ?? "chromium").toBe("chromium");
});
