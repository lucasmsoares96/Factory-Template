import { describe, expect, it } from "vitest";
import { catalogEntries, catalogUsers, withCatalogEntry } from "../src/skeleton-change.ts";
import { skeletonAllowed } from "../src/scope.ts";

const YAML = "packages:\n  - apps/*\n\ncatalog:\n  # Tooling\n  \"@types/node\": 24.19.2\n  zod: 4.1.0\n\nonlyBuiltDependencies:\n  - esbuild\n";

describe("skeletonAllowed", () => {
  it("accepts the Skeleton, the fixed root files and the Products' generated files only", () => {
    for (const p of ["packages/skeleton/src/a.ts", "pnpm-workspace.yaml", "pnpm-lock.yaml", "apps/example/src/client/routeTree.gen.ts"]) expect(skeletonAllowed(p), p).toBe(true);
    for (const p of [".github/workflows/ci.yml", "package.json", "apps/example/src/home.tsx", "packages/other/pnpm-lock.yaml", "pnpm-lock.yaml.bak"]) expect(skeletonAllowed(p), p).toBe(false);
  });
});

describe("catalog helpers", () => {
  it("reads, adds, changes and removes entries without touching the rest", () => {
    expect([...catalogEntries(YAML)]).toEqual([["@types/node", "24.19.2"], ["zod", "4.1.0"]]);
    const added = withCatalogEntry(YAML, "left-pad", "1.3.0");
    expect(added).toContain("  zod: 4.1.0\n  left-pad: 1.3.0\n\nonlyBuiltDependencies:");
    expect(withCatalogEntry(added, "left-pad", null)).toBe(YAML);
    expect(withCatalogEntry(YAML, "zod", "4.2.0")).toContain("  zod: 4.2.0\n");
    expect(withCatalogEntry(YAML, "@scope/pkg", "1.0.0")).toContain('  "@scope/pkg": 1.0.0\n');
  });

  it("finds the dependencies a package.json takes from the catalog", () => {
    expect(catalogUsers('{"dependencies":{"zod":"catalog:","x":"^1"},"devDependencies":{"y":"catalog:default"}}')).toEqual(["zod", "y"]);
    expect(catalogUsers("not json")).toEqual([]);
  });
});
