import { z } from "@hono/zod-openapi";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** The default `limit` of a list; it never goes above 100. */
export const PAGE_LIMIT = 50;
const MAX_LIMIT = 100;

/** The query every list takes: `limit` (50 by default) and the `cursor` of the previous page. */
export const PageQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(PAGE_LIMIT)
    .openapi({ description: `How many items to answer, 1 to ${MAX_LIMIT}.`, example: PAGE_LIMIT }),
  cursor: z
    .string()
    .optional()
    .openapi({
      description: "The `nextCursor` of the previous page; without it, the first page.",
      example: "WyIyMDI2LTEwLTI0VDEyOjAwOjAwLjAwMFoiLCJpZCJd",
    }),
});

/** A list's answer: one page of `item`, and the cursor of the next one. */
export function pageOf<T extends z.ZodType>(item: T, name: string) {
  return z
    .object({
      items: z.array(item).openapi({ description: "This page's items." }),
      nextCursor: z
        .string()
        .nullable()
        .openapi({ description: "Pass it as `cursor` for the next page; `null` on the last page." }),
    })
    .openapi(name);
}

/**
 * A keyset position: the sort key of the last item of a page, a timestamp
 * (milliseconds, as the column keeps them) plus an id that breaks ties. Opaque
 * to clients.
 */
export type Position = { at: Date; id: string };

export function encodeCursor({ at, id }: Position): string {
  return btoa(JSON.stringify([at.toISOString(), id])).replaceAll("=", "");
}

/** The position a cursor holds, or `null` when it is not one this API wrote. */
export function decodeCursor(cursor: string): Position | null {
  try {
    const [at, id] = JSON.parse(atob(cursor)) as unknown[];
    if (typeof at !== "string" || typeof id !== "string") return null;
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? null : { at: date, id };
  } catch {
    return null;
  }
}

/**
 * The keyset condition of a page: rows after `position` in `(at, id)` order,
 * or no condition for the first page. `at` must keep milliseconds only.
 */
export function afterPosition(position: Position | undefined, at: AnyPgColumn, id: AnyPgColumn): SQL | undefined {
  return position ? sql`(${at}, ${id}) > (${position.at.toISOString()}::timestamptz, ${position.id})` : undefined;
}

/**
 * Cuts the `limit + 1` rows a list query fetched into a page: the extra row only
 * says that another page exists.
 */
export function toPage<Row, Item>(
  rows: Row[],
  limit: number,
  { item, position }: { item: (row: Row) => Item; position: (row: Row) => Position },
) {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(item),
    nextCursor: rows.length > limit && last ? encodeCursor(position(last)) : null,
  };
}
