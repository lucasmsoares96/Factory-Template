import { fileURLToPath } from "node:url";

/** Where the Skeleton's migrations live and where their journal is kept. */
export const skeletonMigrations = {
  folder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  table: "__skeleton_migrations",
  schema: "drizzle",
  schemaFilter: ["skeleton"],
} as const;

/** Where a Product's own migrations are journaled, apart from the Skeleton's. */
export const productMigrations = {
  table: "__product_migrations",
  schema: "drizzle",
  schemaFilter: ["public"],
} as const;
