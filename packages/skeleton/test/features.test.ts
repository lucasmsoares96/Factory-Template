import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Generator, getConfig } from "@tanstack/router-generator";
import type { Database } from "../src/platform/db.ts";
import { assertUniqueFeatures, defineFeature, seedFeatures } from "../src/platform/feature.ts";
import { featureRoutes, routerConfig } from "../src/vite/router.ts";

const feature = (id: string, seed?: () => Promise<void>) => defineFeature({ id, api() {}, seed });

test("two features with the same id are refused", () => {
  expect(() => assertUniqueFeatures([feature("notes"), feature("billing"), feature("notes")])).toThrow(
    'Two features share the id "notes".',
  );
  expect(() => assertUniqueFeatures([feature("notes"), feature("billing")])).not.toThrow();
});

test("seeds run in the order the features are listed, and features without one are skipped", async () => {
  const order: string[] = [];
  const db = {} as Database;

  await seedFeatures(db, [feature("a", async () => void order.push("a")), feature("b"), feature("c", async () => void order.push("c"))]);

  expect(order).toEqual(["a", "c"]);
});

// A Product's feature routes enter the route tree by convention (routes/ and public/ per feature).
let product: string;
beforeEach(() => {
  product = mkdtempSync(join(tmpdir(), "feature-routes-"));
  for (const path of ["src/client", "src/features/notes/routes", "src/features/notes/public", "src/features/billing/routes"]) {
    mkdirSync(join(product, path), { recursive: true });
  }
  writeFileSync(join(product, "src/features/notes/routes/index.tsx"), route("/notes/_signed-in/"));
  writeFileSync(join(product, "src/features/notes/public/shared.tsx"), route("/notes/shared"));
  writeFileSync(join(product, "src/features/billing/routes/index.tsx"), route("/billing/_signed-in/"));
});
afterEach(() => rmSync(product, { recursive: true, force: true }));

/** A route file; the generator rewrites the path to the one the folders give. */
const route = (path: string) =>
  `import { createFileRoute } from "@tanstack/react-router";\nexport const Route = createFileRoute("${path}")({ component: () => null });\n`;

test("signed-in routes mount under the signed-in layout and public ones beside sign-in, each at /<feature>", async () => {
  const { routes, publicRoutes } = featureRoutes(product);
  expect(routes).toHaveLength(2);
  expect(publicRoutes).toHaveLength(1);

  const config = getConfig(routerConfig({ dir: product, routeTree: "src/client/routeTree.gen.ts", routes, publicRoutes }), product);
  await new Generator({ config, root: product }).run();

  const tree = readFileSync(join(product, "src/client/routeTree.gen.ts"), "utf8");
  expect(tree).toContain("path: '/notes/shared'".replace(/'/g, '"'));
  expect(tree).toMatch(/"\/_signed-in\/billing\/"|"\/_signed-in\/billing"/);
  expect(tree).toMatch(/"\/_signed-in\/notes\/"|"\/_signed-in\/notes"/);
  expect(tree).not.toMatch(/_signed-in\/notes\/shared/);
});

test("a Product without features has no feature routes", () => {
  expect(featureRoutes(join(product, "nowhere"))).toEqual({ routes: [], publicRoutes: [] });
});
