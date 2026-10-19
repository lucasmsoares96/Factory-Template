import { defineConfig } from "drizzle-kit";
import { productMigrations } from "./migrations.ts";

/**
 * The `drizzle.config.ts` of a Product. Its tables live in `public`, one
 * `schema.ts` per feature; its migrations are journaled apart from the
 * Skeleton's and always run after them.
 */
export function defineProductDrizzleConfig() {
  return defineConfig({
    dialect: "postgresql",
    schema: "./src/features/*/schema.ts",
    out: "./drizzle",
    schemaFilter: [...productMigrations.schemaFilter],
    migrations: { table: productMigrations.table, schema: productMigrations.schema },
    dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  });
}
