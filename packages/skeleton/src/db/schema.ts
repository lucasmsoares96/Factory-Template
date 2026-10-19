import { pgSchema, text } from "drizzle-orm/pg-core";

/** Every Skeleton table lives in this Postgres schema, apart from the Product's tables in `public`. */
export const skeletonSchema = pgSchema("skeleton");

/**
 * The roles a Member can hold in a Company. The Skeleton seeds `owner` and
 * `employee`; a Product adds its own roles with an `INSERT` in its migrations.
 */
export const memberRoles = skeletonSchema.table("member_roles", {
  id: text("id").primaryKey(),
});
