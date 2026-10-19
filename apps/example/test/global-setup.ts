import { ensurePostgres, migrateDatabase } from "@workspace/skeleton/node";

/** A migrated Postgres for the Worker under test: `DATABASE_URL`, or a throwaway container. */
export default async function setup() {
  const postgres = ensurePostgres({ purpose: "e2e-example" });
  process.env.DATABASE_URL = postgres.url;
  await migrateDatabase({ databaseUrl: postgres.url, productMigrationsFolder: "./drizzle" });
  return () => postgres.stop();
}
