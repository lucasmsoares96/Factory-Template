import { defineConfig } from "drizzle-kit";
import { skeletonMigrations } from "./src/db/migrations.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: [...skeletonMigrations.schemaFilter],
  migrations: { table: skeletonMigrations.table, schema: skeletonMigrations.schema },
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
