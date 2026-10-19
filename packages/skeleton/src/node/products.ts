import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The molde `new-product` copies. */
export const TEMPLATE_DIR = fileURLToPath(new URL("../../template", import.meta.url));

/** A Product id is the folder, the Worker name and a hostname label: lower-case, digits and dashes. */
const PRODUCT_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 40;

/** The repository root: the closest directory at or above `from` with a `pnpm-workspace.yaml`. */
export function findWorkspaceRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No pnpm-workspace.yaml above ${from}: run this inside the repository.`);
    dir = parent;
  }
}

/** Throws unless `id` is a valid Product id (the rule `new-product` and `dev` share). */
export function assertProductId(id: string): void {
  if (id.length > MAX_ID_LENGTH || !PRODUCT_ID.test(id)) {
    throw new Error(
      `Invalid Product id "${id}": use lower-case letters, digits and single dashes, starting with a letter (at most ${MAX_ID_LENGTH} characters).`,
    );
  }
}

/** The ids of the Products in `<root>/apps`, sorted. */
export function listProducts(root: string): string[] {
  const apps = join(root, "apps");
  if (!existsSync(apps)) return [];
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(apps, entry.name, "package.json")))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Which Product `pnpm dev [id]` starts: the only one when there is just one,
 * the named one otherwise. Throws a message that says what to type.
 */
export function resolveDevProduct(products: readonly string[], requested?: string): string {
  if (requested !== undefined) {
    assertProductId(requested);
    if (products.includes(requested)) return requested;
    throw new Error(`No Product "${requested}" in apps/. Products: ${products.join(", ") || "none"}.`);
  }
  if (products.length === 1) return products[0]!;
  if (products.length === 0) throw new Error("No Product in apps/. Create one with `pnpm new-product <id>`.");
  throw new Error(`There are ${products.length} Products. Run \`pnpm dev <id>\` with one of: ${products.join(", ")}.`);
}

export function titleFromId(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type NewProductOptions = {
  /** The repository root. */
  root: string;
  id: string;
  /** Display name; defaults to the id in Title Case. */
  title?: string;
  /** Defaults to `<id>.com`. */
  domain?: string;
  /** Run `pnpm install` (registers the Product in the lockfile) and `generate` afterwards. */
  install?: boolean;
  /** Where the Product goes; defaults to `<root>/apps/<id>`. */
  outDir?: string;
};

/** Every file of the molde, as paths relative to it. */
export function templateFiles(dir: string = TEMPLATE_DIR): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path.slice(dir.length + 1));
    }
  };
  walk(dir);
  return files.sort();
}

/** Copies the molde into `outDir`, filling `{{id}}`, `{{title}}`, `{{domain}}`. Returns the files written. */
export function renderTemplate(outDir: string, values: { id: string; title: string; domain: string }): string[] {
  const written: string[] = [];
  for (const file of templateFiles()) {
    const text = readFileSync(join(TEMPLATE_DIR, file), "utf8").replace(
      /\{\{(id|title|domain)\}\}/g,
      (_, key: keyof typeof values) => values[key],
    );
    const target = join(outDir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(file);
  }
  return written;
}

/**
 * `pnpm new-product <id>`: creates `apps/<id>/` from the molde. `apps/*` is a
 * workspace glob, so the folder is the registration; `install` runs `pnpm install`
 * (lockfile) and `generate` (the committed generated files).
 */
export function newProduct({ root, id, title, domain, install = true, outDir }: NewProductOptions) {
  assertProductId(id);
  const target = outDir ?? join(root, "apps", id);
  if (existsSync(target) && statSync(target).isDirectory() && readdirSync(target).length > 0) {
    throw new Error(`${target} already exists.`);
  }
  const files = renderTemplate(target, { id, title: title ?? titleFromId(id), domain: domain ?? `${id}.com` });

  if (install) {
    const run = (...args: string[]) => {
      const { status } = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
      if (status !== 0) throw new Error(`\`pnpm ${args.join(" ")}\` failed.`);
    };
    run("install");
    run("--filter", `./apps/${id}`, "run", "generate");
  }
  return { dir: target, files };
}

/** What `new-product` tells the dev to do next. */
export function nextSteps(id: string): string {
  return [
    `Created apps/${id}/.`,
    "",
    "Next:",
    `  pnpm dev ${id}                  run it locally (Docker Postgres, no accounts needed)`,
    `  pnpm bootstrap product ${id}    set up its Worker, database and domain`,
    "",
    `Edit apps/${id}/product.config.ts for the title, sender and texts, and add features under apps/${id}/src/features/.`,
  ].join("\n");
}
