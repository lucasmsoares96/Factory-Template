import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { listProducts, newProduct, resolveDevProduct } from "../src/node/index.ts";
import { skeleton } from "./support/cli.ts";

// Seam 5/6: what `pnpm new-product` leaves on disk, seen from the outside.

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "new-product-"));
  writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

test("the template's Product passes generate, typecheck and lint, and has a place for its own E2E specs", () => {
  // Generated inside the repo so it resolves the workspace's dependencies (it reuses `example`'s node_modules).
  const id = "zz-template-check";
  const dir = join(repoRoot, "apps", id);
  rmSync(dir, { recursive: true, force: true });
  try {
    newProduct({ root: repoRoot, id, install: false });
    symlinkSync("../example/node_modules", join(dir, "node_modules"));
    expect(existsSync(join(dir, "e2e/.gitkeep"))).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("`e2e/`");

    const bin = (name: string) => join(repoRoot, name === "wrangler" ? "apps/example" : "", "node_modules/.bin", name);
    const steps: [string, string[]][] = [
      [bin("wrangler"), ["types"]],
      [process.execPath, [fileURLToPath(new URL("../bin/skeleton.ts", import.meta.url)), "generate", "--product", "."]],
      [bin("tsc"), ["-p", "tsconfig.worker.json"]],
      [bin("tsc"), ["-p", "tsconfig.app.json"]],
      [bin("tsc"), ["-p", "tsconfig.json"]],
      [bin("oxlint"), []],
    ];
    for (const [command, args] of steps) {
      const run = spawnSync(command, args, { cwd: dir, encoding: "utf8" });
      expect(run.error, String(run.error)).toBeUndefined();
      expect(run.status, `${basename(command)} ${args.join(" ")}\n${run.stdout}${run.stderr}`).toBe(0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 240_000);

test("the new Product carries its id, title and sender, and leaves no placeholder behind", () => {
  const { dir, files } = newProduct({ root: workspace, id: "pet-shop", title: "Pet Shop", domain: "petshop.dev", install: false });

  const config = readFileSync(join(dir, "product.config.ts"), "utf8");
  expect(config).toContain(`id: "pet-shop"`);
  expect(config).toContain(`emailFrom: "Pet Shop <no-reply@petshop.dev>"`);
  expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name).toBe("pet-shop");
  expect(readFileSync(join(dir, "wrangler.jsonc"), "utf8")).toContain(`"name": "pet-shop"`);
  expect(files).toContain("AGENTS.md");
  for (const file of files) expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/\{\{\w+\}\}/);
});

test("the Product title and domain default from the id", () => {
  const { dir } = newProduct({ root: workspace, id: "pet-shop", install: false });

  expect(readFileSync(join(dir, "product.config.ts"), "utf8")).toContain(`emailFrom: "Pet Shop <no-reply@pet-shop.com>"`);
});

test("an id that is not a lower-case dashed name, or already taken, is refused", () => {
  for (const id of ["Shop", "1shop", "pet_shop", "pet--shop", "-shop", "shop-", "x".repeat(41), ""]) {
    expect(() => newProduct({ root: workspace, id, install: false }), id).toThrow(/Invalid Product id/);
  }
  newProduct({ root: workspace, id: "shop", install: false });
  expect(() => newProduct({ root: workspace, id: "shop", install: false })).toThrow(/already exists/);
});

test("`skeleton new-product <id>` creates apps/<id>/ and shows the commands that come next", () => {
  const run = skeleton(["new-product", "shop", "--no-install"], { cwd: workspace });

  expect(run.status).toBe(0);
  expect(existsSync(join(workspace, "apps/shop/product.config.ts"))).toBe(true);
  expect(run.output).toContain("pnpm dev shop");
  expect(run.output).toContain("pnpm bootstrap product shop");
  expect(skeleton(["new-product", "shop", "--no-install"], { cwd: workspace }).status).toBe(1);
  expect(skeleton(["new-product"], { cwd: workspace }).output).toContain("Usage: pnpm new-product <id>");
});

test("`pnpm dev` starts the only Product, and asks for `pnpm dev <id>` when there are several", () => {
  expect(() => resolveDevProduct(listProducts(workspace))).toThrow(/pnpm new-product/);
  newProduct({ root: workspace, id: "shop", install: false });
  expect(listProducts(workspace)).toEqual(["shop"]);
  expect(resolveDevProduct(listProducts(workspace))).toBe("shop");

  newProduct({ root: workspace, id: "blog", install: false });
  mkdirSync(join(workspace, "apps/not-a-product"));

  expect(() => resolveDevProduct(listProducts(workspace))).toThrow("Run `pnpm dev <id>` with one of: blog, shop.");
  expect(resolveDevProduct(listProducts(workspace), "blog")).toBe("blog");
  expect(() => resolveDevProduct(listProducts(workspace), "nope")).toThrow('No Product "nope"');
  // The id ends up in a `--filter ./apps/<id>` path: it must be a valid Product id even if a folder matches.
  mkdirSync(join(workspace, "apps/Bad_Id"));
  writeFileSync(join(workspace, "apps/Bad_Id/package.json"), "{}");
  expect(() => resolveDevProduct(listProducts(workspace), "Bad_Id")).toThrow('Invalid Product id "Bad_Id"');
  expect(() => resolveDevProduct(listProducts(workspace), "../x")).toThrow('Invalid Product id "../x"');
});

test("the template's Product has no feature, no migration of its own and an empty tool list", () => {
  const { dir } = newProduct({ root: workspace, id: "shop", install: false });

  expect(readFileSync(join(dir, "src/mcp-tools.gen.json"), "utf8").trim()).toBe("[]");
  expect(readFileSync(join(dir, "src/features/index.ts"), "utf8")).toContain("export const features: Feature[] = [];");
  expect(readdirSync(join(dir, "drizzle"))).toEqual([".gitkeep"]);
  expect(dirname(join(dir, "package.json"))).toBe(dir);
});
