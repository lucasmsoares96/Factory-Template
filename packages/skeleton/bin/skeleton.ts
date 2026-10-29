#!/usr/bin/env node
// The Skeleton's command line, called from each Product's package.json scripts.
// Modules load per command so the quick commands stay quick.
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const usage = `Usage: skeleton <command> [options]

Commands:
  generate [--product <dir>]     Write the OpenAPI document, the Kubb client and MSW handlers
                                 (src/gen/), TanStack Router's routeTree.gen.ts and the MCP
                                 tools (src/mcp-tools.gen.json). Without --product, for the
                                 Skeleton's own SPA and test composition (its tests use them).
  dev [--product <dir>]          Start the Product's Worker and SPA (vite dev) on a migrated
                                 database: DATABASE_URL, or the docker compose Postgres.
                                 Emails land in the skeleton.email_outbox table, and billing
                                 runs on a fake Stripe inside the Worker (/api/fake-stripe).
  db migrate [--product <dir>]   Apply the Skeleton's migrations, then the Product's.
  db check [--product <dir>]     Fail unless drizzle-kit check passes and a brand-new database,
                                 once migrated, matches the schema (push --explain: no_changes).
  new-product <id> [--title <name>] [--domain <domain>] [--no-install]
                                 Create apps/<id>/ from the Skeleton's template, then run
                                 pnpm install and generate (not with --no-install).
  migrations check-published [--dir drizzle] [--base <ref>]
                                 Fail if a migration already on the base branch was edited,
                                 renamed or deleted.
  migrations check-chain [--dir drizzle]
                                 Fail if two migration snapshots share a parent (the chain
                                 forked, e.g. two branches each added one) or a parent is missing.

Without --product, only the Skeleton's migrations are involved.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    base: { type: "string" },
    dir: { type: "string", default: "drizzle" },
    title: { type: "string" },
    domain: { type: "string" },
    "no-install": { type: "boolean", default: false },
  },
});
const productDir = values.product && resolve(values.product);
const productMigrations = productDir && resolve(productDir, "drizzle");

try {
  if (positionals[0] === "new-product") {
    const [, id, ...extra] = positionals;
    if (!id || extra.length) throw new Error("Usage: pnpm new-product <id> [--title <name>] [--domain <domain>] [--no-install]");
    const { findWorkspaceRoot, newProduct, nextSteps } = await import("../src/node/products.ts");
    newProduct({
      root: findWorkspaceRoot(process.cwd()),
      id,
      title: values.title,
      domain: values.domain,
      install: !values["no-install"],
    });
    console.log(`\n${nextSteps(id)}`);
  } else switch (positionals.join(" ")) {
    case "generate":
      await generateCommand();
      break;
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
    case "migrations check-chain":
      await checkChain();
      break;
    default:
      console.error(usage);
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function generateCommand() {
  const { generate, PRODUCT_MCP_TOOLS } = await import("../src/node/generate.ts");
  if (productDir) {
    const { readFile } = await import("node:fs/promises");
    const { importWorkerModule } = await import("../src/node/worker-module.ts");
    const { name } = JSON.parse(await readFile(resolve(productDir, "package.json"), "utf8"));
    const worker = await importWorkerModule(resolve(productDir, "src/worker.ts"));
    const app = worker.default as Parameters<typeof generate>[0]["app"];
    const { PRODUCT_ROUTE_TREE, featureRoutes } = await import("../src/vite/router.ts");
    await generate({
      dir: productDir,
      app,
      title: name,
      routeTree: PRODUCT_ROUTE_TREE,
      mcpTools: PRODUCT_MCP_TOOLS,
      ...featureRoutes(productDir),
    });
  } else {
    // The Skeleton's own document comes from its test composition.
    const { importWorkerModule } = await import("../src/node/worker-module.ts");
    const dir = resolve(import.meta.dirname, "..");
    const worker = await importWorkerModule(resolve(dir, "test/worker/index.ts"));
    const app = worker.default as Parameters<typeof generate>[0]["app"];
    await generate({
      dir,
      app,
      title: "skeleton",
      routeTree: "test/spa/routeTree.gen.ts",
      mcpTools: "test/worker/mcp-tools.gen.json",
    });
  }
}

async function dev(dir: string) {
  const { spawn } = await import("node:child_process");
  const { ensurePostgres } = await import("../src/node/postgres.ts");
  const { migrateDatabase } = await import("../src/node/migrate.ts");
  const postgres = ensurePostgres({ purpose: "dev", keep: true, cwd: dir });
  await migrateDatabase({ databaseUrl: postgres.url, productMigrationsFolder: resolve(dir, "drizzle") });
  // With `secrets` in wrangler.jsonc, the Worker reads its required secrets and
  // overrides its vars from the environment. Emails land in the outbox table.
  const vite = spawn("vite", ["dev"], {
    cwd: dir,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: postgres.url,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-never-used-in-production",
      EMAIL_TRANSPORT: "outbox",
      // Billing runs on a Stripe that lives in the Worker: no internet, no real key.
      STRIPE_FAKE: "true",
    },
  });
  vite.on("exit", (code) => process.exit(code ?? 0));
}

async function checkChain() {
  const { findBrokenMigrationChain } = await import("../src/node/migration-chain.ts");
  const problems = findBrokenMigrationChain({ dir: values.dir });
  if (problems.length) {
    console.error(`The migration chain in ${values.dir} is broken:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`The migration chain in ${values.dir} is linear.`);
  }
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
