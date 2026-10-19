import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
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

const filesUnder = (dir: string) =>
  (readdirSync(dir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();

test("`example` is exactly what the template generates for `example`, apart from generated files", () => {
  const { dir } = newProduct({ root: workspace, id: "example", install: false });

  // The committed Product (tracked, or new and not ignored); generated files (`*.gen.*`) come from `pnpm generate`.
  const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "apps/example"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !/\.gen\./.test(file))
    .map((file) => relative("apps/example", file))
    .sort();
  const generated = filesUnder(dir).filter((file) => !/\.gen\./.test(file));

  expect(generated).toEqual(tracked);
  for (const file of tracked) {
    expect(readFileSync(join(dir, file), "utf8"), file).toBe(readFileSync(join(repoRoot, "apps/example", file), "utf8"));
  }
});

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
});

test("the template's Product has no feature, no migration of its own and an empty tool list", () => {
  const { dir } = newProduct({ root: workspace, id: "shop", install: false });

  expect(readFileSync(join(dir, "src/mcp-tools.gen.json"), "utf8").trim()).toBe("[]");
  expect(readFileSync(join(dir, "src/features/index.ts"), "utf8")).toContain("export const features: Feature[] = [];");
  expect(readdirSync(join(dir, "drizzle"))).toEqual([".gitkeep"]);
  expect(dirname(join(dir, "package.json"))).toBe(dir);
});
