// The logic behind `factory-deploy.yml`, one subcommand per step so the YAML stays thin:
//   plan          affected Products that are in DEPLOY_PRODUCTS  -> `matrix`, `empty`; those also in PREVIEW_PRODUCTS -> `previews`, `previews_empty`
//   bundle        (build job, no secrets) the build output (Worker and assets), the Skeleton's and the Product's migrations -> a folder
//   verify-bundle (deploy job) the extracted artifact holds only what the allowlist names
//   config        (deploy job) the Worker config with the Product's id, next to the built one
//   secrets-file  (deploy job) the Worker's secrets from the environment, to a file wrangler reads
//   url           (deploy job) the deployed URL from wrangler's output file
//   migrate       (deploy job) the artifact's Skeleton migrations, then its Product migrations, against the direct Neon URL (MIGRATE_DATABASE_URL, or the first line of --url-file)
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { productSecretName } from "../bootstrap/domain.ts";
import { buildMatrix, type AffectedPackage } from "./matrix.ts";

export interface DeployEntry {
  /** The Product id, also its package name, its Worker name and its `apps/<id>` folder. */
  id: string;
  /** `<ID>_`, the prefix of its secrets. */
  prefix: string;
}

const PRODUCT_ID = /^[a-z][a-z0-9-]*$/;
const NO_COMMIT = /^0+$/;

/** `a, b c` and `a,b` both read as two ids. */
export function parseList(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).filter(Boolean);
}

/**
 * The Products to deploy: affected by the push (or all of them on a manual run) and listed in DEPLOY_PRODUCTS.
 * An id that is listed but has no `apps/<id>` is ignored, and so is one that does not look like an id.
 */
export function planDeploy(input: { affected: AffectedPackage[]; packages: AffectedPackage[]; deployProducts: string; all: boolean }): { include: DeployEntry[] } {
  const products = (list: AffectedPackage[]) => buildMatrix({ affected: list, changedFiles: [], packages: input.packages }).include.filter((e) => e.kind === "product").map((e) => e.name);
  const existing = new Set(products(input.packages));
  const wanted = new Set(input.all ? existing : products(input.affected));
  const include = parseList(input.deployProducts)
    .filter((id) => PRODUCT_ID.test(id) && wanted.has(id) && existing.has(id))
    .sort()
    .map((id) => ({ id, prefix: productSecretName(id, "") }));
  return { include };
}

/** Names allowed in the artifact. Everything else, and every symlink, makes the deploy refuse it. */
const BUNDLE_ROOTS = ["worker", "migrations"];
/** The migration sets under `migrations/`: the PR's own copy of each, never the deploying checkout's. */
const MIGRATION_SETS = ["product", "skeleton"];
const MIGRATION_FILE = /(\.(sql|json)|^\.gitkeep)$/;

/**
 * `<dir>/migrations/skeleton`, the Skeleton migrations the artifact was built with. An artifact built before the bundle
 * carried them has none: falling back to the deploying checkout's would apply `main`'s migrations to the PR's Worker.
 */
export function artifactSkeletonMigrations(dir: string): string {
  const folder = join(dir, "migrations/skeleton");
  const hasOne = existsSync(folder) && readdirSync(folder, { withFileTypes: true }).some((e) => e.isDirectory());
  if (!hasOne) throw new Error(`The artifact has no Skeleton migrations in ${folder}: it was built before the bundle carried them. Push to the branch (or rerun the build) to rebuild it.`);
  return folder;
}

/** `worker/<name>/wrangler.json`: the build's output folder sits next to `worker/client` (the assets, `../client` in the config). */
export function builtConfigs(dir: string): string[] {
  const worker = join(dir, "worker");
  if (!existsSync(worker)) return [];
  return readdirSync(worker, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(worker, e.name, "wrangler.json")))
    .map((e) => join(worker, e.name, "wrangler.json"));
}

/** What is wrong with an extracted artifact; empty means it may be deployed. */
export function bundleProblems(dir: string): string[] {
  const problems: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = relative(dir, path).split(sep).join("/");
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) problems.push(`${rel}: not a regular file or folder`);
      else if (!BUNDLE_ROOTS.includes(rel.split("/")[0]!)) problems.push(`${rel}: outside ${BUNDLE_ROOTS.join(", ")}`);
      else if (rel.split("/").length === 2 && rel.startsWith("migrations/") && !(entry.isDirectory() && MIGRATION_SETS.includes(entry.name))) {
        problems.push(`${rel}: outside ${MIGRATION_SETS.map((set) => `migrations/${set}`).join(", ")}`);
      }
      else if (rel.startsWith("migrations/") && entry.isFile() && !MIGRATION_FILE.test(entry.name)) problems.push(`${rel}: not a migration file`);
      else if (entry.isDirectory()) walk(path);
    }
  };
  if (!existsSync(dir)) return [`${dir} does not exist`];
  walk(dir);
  if (builtConfigs(dir).length !== 1) problems.push("worker/<name>/wrangler.json must exist exactly once");
  return problems;
}

/** The built Worker config of a Product, with its name set to the id and the build-time-only fields dropped. */
export function deployConfig(built: Record<string, unknown>, id: string): Record<string, unknown> {
  // `configPath` and `userConfigPath` are paths of the build machine; `secrets` and `dev` mean nothing to a deploy.
  const { name: _name, secrets: _secrets, dev: _dev, configPath: _config, userConfigPath: _user, ...rest } = built;
  return { ...rest, name: id };
}

/** The Worker secrets the deploy sets, from the environment of the job; `RESEND_API_KEY` only when the domain exists. */
export function workerSecrets(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, from] of [["DATABASE_URL", "POOLED_DATABASE_URL"], ["BETTER_AUTH_SECRET", "AUTH_SECRET"], ["RESEND_API_KEY", "RESEND_KEY"]] as const) {
    const value = env[from];
    if (value) out[name] = value;
  }
  for (const required of ["DATABASE_URL", "BETTER_AUTH_SECRET"]) if (!out[required]) throw new Error(`The deploy has no ${required}: run \`pnpm bootstrap product <id>\`.`);
  return out;
}

/** The URL `wrangler deploy` reports in its output file (ND-JSON, `WRANGLER_OUTPUT_FILE_PATH`). */
export function deployedUrl(ndjson: string): string | undefined {
  for (const line of ndjson.split("\n").filter(Boolean).reverse()) {
    const entry = JSON.parse(line) as { type?: string; targets?: string[] };
    if (entry.type === "deploy" && entry.targets?.[0]) return entry.targets[0];
  }
  return undefined;
}

function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function turbo<T>(args: string[]): T {
  const out = execFileSync("pnpm", ["exec", "turbo", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out.slice(out.indexOf("{"))) as T;
}

/** The folder the Cloudflare Vite plugin wrote the Worker to (`apps/<id>/dist/<name>`), told by the redirect it leaves. */
function builtDir(product: string): string {
  const redirect = join("apps", product, ".wrangler/deploy/config.json");
  const { configPath } = JSON.parse(readFileSync(redirect, "utf8")) as { configPath: string };
  return dirname(resolve(dirname(redirect), configPath));
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { base: { type: "string" }, head: { type: "string", default: "HEAD" }, product: { type: "string" }, out: { type: "string" }, dir: { type: "string" }, file: { type: "string" }, "url-file": { type: "string" } },
  });
  const [command] = positionals;
  const need = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  const productId = () => {
    const id = need(values.product, "product");
    if (!PRODUCT_ID.test(id)) throw new Error(`"${id}" is not a Product id.`);
    return id;
  };

  if (command === "plan") {
    const packages = turbo<{ data: { packages: { items: AffectedPackage[] } } }>(["query", "{ packages { items { name path } } }"]).data.packages.items;
    const all = !values.base || NO_COMMIT.test(values.base) || process.env.EVENT_NAME === "workflow_dispatch";
    const affected = all
      ? []
      : turbo<{ data: { affectedPackages: { items: AffectedPackage[] } } }>(["query", "affected", "--packages", "--base", values.base!, "--head", values.head!]).data.affectedPackages.items;
    const matrix = planDeploy({ affected, packages, deployProducts: process.env.DEPLOY_PRODUCTS ?? "", all });
    console.log(JSON.stringify(matrix));
    output("matrix", JSON.stringify(matrix));
    output("empty", String(matrix.include.length === 0));
    // The deployed Products that also have previews: their `base` branch is migrated after the deploy.
    const previews = { include: matrix.include.filter((e) => parseList(process.env.PREVIEW_PRODUCTS).includes(e.id)) };
    output("previews", JSON.stringify(previews));
    output("previews_empty", String(previews.include.length === 0));
  } else if (command === "bundle") {
    const id = productId();
    const out = resolve(need(values.out, "out"));
    const built = builtDir(id);
    cpSync(dirname(built), join(out, "worker"), { recursive: true, dereference: false });
    if (existsSync(join("apps", id, "drizzle"))) cpSync(join("apps", id, "drizzle"), join(out, "migrations/product"), { recursive: true });
    // The Skeleton's migrations of this checkout: the deploy applies these, not its own, so a PR's new one reaches its preview.
    cpSync("packages/skeleton/drizzle", join(out, "migrations/skeleton"), { recursive: true });
    mkdirSync(join(out, "migrations"), { recursive: true });
    const problems = bundleProblems(out);
    if (problems.length > 0) throw new Error(`The bundle is not deployable:\n${problems.join("\n")}`);
    console.log(`bundle for ${id} at ${out}`);
  } else if (command === "verify-bundle") {
    const problems = bundleProblems(resolve(need(values.dir, "dir")));
    if (problems.length > 0) throw new Error(`The artifact holds more than the allowlist:\n${problems.join("\n")}`);
    console.log("artifact ok");
  } else if (command === "config") {
    const [config] = builtConfigs(resolve(need(values.dir, "dir")));
    if (!config) throw new Error("No worker/<name>/wrangler.json in the artifact.");
    const built = JSON.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
    const path = join(dirname(config), "wrangler.deploy.json");
    writeFileSync(path, JSON.stringify(deployConfig(built, productId()), null, 2));
    output("path", path);
    console.log(path);
  } else if (command === "secrets-file") {
    writeFileSync(resolve(need(values.file, "file")), JSON.stringify(workerSecrets(process.env)), { mode: 0o600 });
  } else if (command === "url") {
    const url = deployedUrl(readFileSync(resolve(need(values.file, "file")), "utf8"));
    if (!url) throw new Error("wrangler reported no deployed URL.");
    console.log(url);
  } else if (command === "migrate") {
    const { migrateDatabase } = await import("../../../packages/skeleton/src/node/migrate.ts");
    const databaseUrl = values["url-file"] ? readFileSync(resolve(values["url-file"]), "utf8").trim() : process.env.MIGRATE_DATABASE_URL;
    if (!databaseUrl) throw new Error("MIGRATE_DATABASE_URL is not set.");
    const dir = resolve(need(values.dir, "dir"));
    const skeletonMigrationsFolder = artifactSkeletonMigrations(dir);
    await migrateDatabase({ databaseUrl, skeletonMigrationsFolder, productMigrationsFolder: join(dir, "migrations/product") });
    console.log("migrations applied");
  } else {
    throw new Error("Usage: deploy.ts <plan|bundle|verify-bundle|config|secrets-file|url|migrate>");
  }
}

