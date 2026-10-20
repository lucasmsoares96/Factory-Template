import { pgTable, text } from "drizzle-orm/pg-core";
import { memberRoles } from "../../../../../../src/db/schema.ts";

/** A Product table that points at a Skeleton table. */
export const notes = pgTable("notes", {
  id: text("id").primaryKey(),
  role: text("role").references(() => memberRoles.id),
});
