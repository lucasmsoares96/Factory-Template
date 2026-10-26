import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePostgres, type Postgres } from "../../packages/skeleton/src/node/postgres.ts";
import { tempDir } from "./helpers.ts";

const exec = promisify(execFile);
const repo = join(import.meta.dirname, "../..");
const deployScript = join(repo, ".factory/src/ci/deploy.ts");

let postgres: Postgres;
const databases: string[] = [];

beforeAll(() => {
  postgres = ensurePostgres({ purpose: "test-harness" });
});
afterAll(async () => {
  for (const name of databases) await query(postgres.url, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  postgres.stop();
});

async function query<Row extends pg.QueryResultRow>(url: string, sql: string): Promise<Row[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<Row>(sql)).rows;
  } finally {
    await client.end();
  }
}

/** A fresh, empty database on the test server, dropped after the file. */
async function emptyDatabase(): Promise<string> {
  const name = `harness_${randomUUID().replaceAll("-", "")}`;
  await query(postgres.url, `CREATE DATABASE "${name}"`);
  databases.push(name);
  const url = new URL(postgres.url);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * A PR checkout as the build job sees it: the Product's build output (with the redirect the Cloudflare Vite plugin
 * leaves) and the Skeleton's migrations of `main` plus one the PR adds.
 */
async function prCheckout(): Promise<string> {
  const tree = await tempDir("factory-pr-tree-");
  const files: Record<string, string> = {
    "apps/shop/.wrangler/deploy/config.json": JSON.stringify({ configPath: "../../dist/shop/wrangler.json" }),
    "apps/shop/dist/shop/wrangler.json": JSON.stringify({ name: "shop", main: "index.js" }),
    "apps/shop/dist/shop/index.js": "export default {}",
    "apps/shop/dist/client/index.html": "<html></html>",
    "packages/skeleton/drizzle/20990101000000_pr_column/migration.sql": `ALTER TABLE "skeleton"."users" ADD COLUMN "added_by_the_pr" text;`,
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(tree, name, ".."), { recursive: true });
    await writeFile(join(tree, name), content);
  }
  await cp(join(repo, "packages/skeleton/drizzle"), join(tree, "packages/skeleton/drizzle"), { recursive: true });
  return tree;
}

const deploy = (args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) =>
  exec(process.execPath, [deployScript, ...args], { cwd: options.cwd ?? repo, env: { ...process.env, ...options.env } });

describe("deploy migrate", () => {
  it("applies the Skeleton migrations the bundle carries, a new one from the PR included", async () => {
    const tree = await prCheckout();
    const out = join(await tempDir("factory-bundle-"), "bundle");
    await deploy(["bundle", "--product", "shop", "--out", out], { cwd: tree });
    await deploy(["verify-bundle", "--dir", out]);

    const databaseUrl = await emptyDatabase();
    await deploy(["migrate", "--dir", out], { env: { MIGRATE_DATABASE_URL: databaseUrl } });

    const columns = await query<{ column_name: string }>(
      databaseUrl,
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'skeleton' AND table_name = 'users'`,
    );
    expect(columns.map((c) => c.column_name)).toContain("added_by_the_pr");
    const tables = await query<{ table_name: string }>(databaseUrl, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'skeleton'`);
    expect(tables.map((t) => t.table_name)).toEqual(expect.arrayContaining(["users", "companies"]));
  });

  it("refuses an artifact built before the bundle carried the Skeleton migrations, and touches no database", async () => {
    const tree = await prCheckout();
    const out = join(await tempDir("factory-bundle-"), "bundle");
    await deploy(["bundle", "--product", "shop", "--out", out], { cwd: tree });
    const old = join(await tempDir("factory-old-bundle-"), "bundle");
    await cp(join(out, "worker"), join(old, "worker"), { recursive: true });
    await mkdir(join(old, "migrations"));

    const databaseUrl = await emptyDatabase();
    const run = deploy(["migrate", "--dir", old], { env: { MIGRATE_DATABASE_URL: databaseUrl } });

    await expect(run).rejects.toThrow(/migrations\/skeleton.*rebuild/s);
    expect(await query(databaseUrl, `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('skeleton', 'drizzle')`)).toEqual([]);
  });
});
