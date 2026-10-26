import { existsSync, readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { productMigrations, skeletonMigrations } from "../db/migrations.ts";

/**
 * Applies the Skeleton's migrations and then, when given, the Product's.
 * Each set keeps its own journal table, so neither sees the other's history.
 * The Skeleton's come from this package unless `skeletonMigrationsFolder` names
 * another copy (a deploy applies the ones its artifact was built with).
 */
export async function migrateDatabase({
  databaseUrl,
  productMigrationsFolder,
  skeletonMigrationsFolder = skeletonMigrations.folder,
}: {
  databaseUrl: string;
  productMigrationsFolder?: string;
  skeletonMigrationsFolder?: string;
}) {
  const db = drizzle({ connection: { connectionString: databaseUrl, max: 1 } });
  try {
    await migrate(db, {
      migrationsFolder: skeletonMigrationsFolder,
      migrationsTable: skeletonMigrations.table,
      migrationsSchema: skeletonMigrations.schema,
    });
    if (productMigrationsFolder && hasMigrations(productMigrationsFolder)) {
      await migrate(db, {
        migrationsFolder: productMigrationsFolder,
        migrationsTable: productMigrations.table,
        migrationsSchema: productMigrations.schema,
      });
    }
  } finally {
    await db.$client.end();
  }
}

/** True when the folder holds at least one generated migration. */
export function hasMigrations(folder: string) {
  return (
    existsSync(folder) &&
    readdirSync(folder, { withFileTypes: true }).some((entry) => entry.isDirectory())
  );
}
