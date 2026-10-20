import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { builtWorkerConfig } from "../src/node/built-worker.ts";

let product: string;
beforeEach(() => {
  product = mkdtempSync(join(tmpdir(), "built-worker-"));
});
afterEach(() => rmSync(product, { recursive: true, force: true }));

test("finds the built wrangler.json where the Vite plugin says it is, whatever the Worker's name became", () => {
  mkdirSync(join(product, ".wrangler/deploy"), { recursive: true });
  writeFileSync(
    join(product, ".wrangler/deploy/config.json"),
    JSON.stringify({ configPath: "../../dist/ci_probe/wrangler.json", auxiliaryWorkers: [] }),
  );

  expect(builtWorkerConfig(product)).toBe(join(product, "dist/ci_probe/wrangler.json"));
});

test("says to build first when there is no build output", () => {
  expect(() => builtWorkerConfig(product)).toThrow("run `vite build` first");
});
