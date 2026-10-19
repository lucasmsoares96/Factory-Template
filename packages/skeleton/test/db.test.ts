import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, expect, test } from "vitest";
import { skeleton } from "./support/cli.ts";
import { createEmptyDatabase } from "./support/database.ts";

const databases: Array<{ drop(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.drop()));
});

const copies: string[] = [];
afterAll(() => copies.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Copies a fixture next to the original, so its imports still resolve. */
function copyFixture(fixture: string) {
  const dir = mkdtempSync(`${fixture}-copy-`);
  copies.push(dir);
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

async function emptyDatabase() {
  const db = await createEmptyDatabase();
  databases.push(db);
  return db;
}

test("migrate seeds the owner and employee member roles", async () => {
  const db = await emptyDatabase();

  const run = skeleton(["db", "migrate"], { env: { DATABASE_URL: db.url } });

  expect(run.status, run.output).toBe(0);
  const roles = await db.query<{ id: string }>(`SELECT id FROM skeleton.member_roles ORDER BY id`);
  expect(roles.map((r) => r.id)).toEqual(["employee", "owner"]);
});

const productWithTables = new URL("./fixtures/product-with-tables", import.meta.url).pathname;

test("migrate applies a Product's migrations after the Skeleton's, in a journal of their own", async () => {
  // The fixture's migration is named before the Skeleton's and references a Skeleton table.
  const db = await emptyDatabase();

  const run = skeleton(["db", "migrate", "--product", productWithTables], {
    env: { DATABASE_URL: db.url },
  });

  expect(run.status, run.output).toBe(0);
  const roles = await db.query<{ id: string }>(`SELECT id FROM skeleton.member_roles ORDER BY id`);
  expect(roles.map((r) => r.id)).toEqual(["employee", "manager", "owner"]);
  const journals = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'drizzle' ORDER BY table_name`,
  );
  expect(journals.map((t) => t.table_name)).toEqual(["__product_migrations", "__skeleton_migrations"]);
});

// `db check` runs drizzle-kit and migrates a fresh database in a child process:
// about 15 s alone, but several times that while the full verify loads the
// machine (Workers, browsers and scrypt hashing run in parallel).
const CHECK_TIMEOUT = { timeout: 180_000 };

test("check passes when the migrations rebuild the Skeleton schema on an empty database", CHECK_TIMEOUT, () => {
  const run = skeleton(["db", "check"]);

  expect(run.status, run.output).toBe(0);
});

test("check passes for a Product whose migrations match its schema", CHECK_TIMEOUT, () => {
  const run = skeleton(["db", "check", "--product", productWithTables]);

  expect(run.status, run.output).toBe(0);
});

test("check fails when a Product schema changed without a migration", CHECK_TIMEOUT, () => {
  const product = copyFixture(productWithTables);
  const schema = join(product, "src/features/notes/schema.ts");
  writeFileSync(
    schema,
    readFileSync(schema, "utf8").replace(`id: text("id").primaryKey(),`, `id: text("id").primaryKey(),\n  title: text("title"),`),
  );

  const run = skeleton(["db", "check", "--product", product]);

  expect(run.status).toBe(1);
  expect(run.output).toMatch(/schema differs from its migrations/);
  expect(run.output).toMatch(/"title"/);
});
