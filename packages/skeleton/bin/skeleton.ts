#!/usr/bin/env node
// The Skeleton's command line, called from each Product's package.json scripts.
// Modules load per command so the quick commands stay quick.
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const usage = `Usage: skeleton <command> [options]

Commands:
  dev [--product <dir>]          Start the Product's Worker and SPA (vite dev) on a migrated
                                 database: DATABASE_URL, or the docker compose Postgres.
  db migrate [--product <dir>]   Apply the Skeleton's migrations, then the Product's.
  db check [--product <dir>]     Fail unless drizzle-kit check passes and a brand-new database,
                                 once migrated, matches the schema (push --explain: no_changes).
  migrations check-published [--dir drizzle] [--base <ref>]
                                 Fail if a migration already on the base branch was edited,
                                 renamed or deleted.

Without --product, only the Skeleton's migrations are involved.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    base: { type: "string" },
    dir: { type: "string", default: "drizzle" },
  },
});
const productDir = values.product && resolve(values.product);
const productMigrations = productDir && resolve(productDir, "drizzle");

try {
  switch (positionals.join(" ")) {
    case "dev":
      await dev(productDir ?? process.cwd());
      break;
    case "db migrate": {
      const { ensurePostgres } = await import("../src/node/postgres.ts");
      const { migrateDatabase } = await import("../src/node/migrate.ts");
      const postgres = ensurePostgres({ purpose: "dev", keep: true });
      await migrateDatabase({ databaseUrl: postgres.url, productMigrationsFolder: productMigrations });
      console.log("Migrations applied.");
      break;
    }
    case "db check": {
      const { ensurePostgres } = await import("../src/node/postgres.ts");
      const { checkMigrations } = await import("../src/node/check.ts");
      const postgres = ensurePostgres({ purpose: "check" });
      try {
        const { ok, report } = await checkMigrations({ serverUrl: postgres.url, productDir });
        (ok ? console.log : console.error)(report);
        if (!ok) process.exitCode = 1;
      } finally {
        postgres.stop();
      }
      break;
    }
    case "migrations check-published":
      await checkPublished();
      break;
    default:
      console.error(usage);
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function dev(dir: string) {
  const { spawn } = await import("node:child_process");
  const { ensurePostgres } = await import("../src/node/postgres.ts");
  const { migrateDatabase } = await import("../src/node/migrate.ts");
  const postgres = ensurePostgres({ purpose: "dev", keep: true, cwd: dir });
  await migrateDatabase({ databaseUrl: postgres.url, productMigrationsFolder: resolve(dir, "drizzle") });
  // `secrets.required` in wrangler.jsonc makes the Worker read DATABASE_URL from the environment.
  const vite = spawn("vite", ["dev"], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: postgres.url },
  });
  vite.on("exit", (code) => process.exit(code ?? 0));
}

async function checkPublished() {
  const { findChangedPublishedMigrations, resolveBaseRef } = await import(
    "../src/node/published-migrations.ts"
  );
  const base = resolveBaseRef({ base: values.base });
  if (!base) {
    const message = "No base ref (origin/main or main) to compare migrations with.";
    if (process.env.CI) throw new Error(message);
    console.warn(`${message} Skipped.`);
    return;
  }
  const changed = findChangedPublishedMigrations({ dir: values.dir, base });
  if (changed.length) {
    console.error(
      `Published migrations must never change (compared with ${base}).\n` +
        `Revert these and add a new migration instead:\n${changed.map((c) => `  ${c}`).join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Published migrations are untouched (compared with ${base}).`);
  }
}
