import type { Database } from "./db.ts";

/** Bindings every Product Worker provides to the Skeleton. */
export type SkeletonBindings = {
  /** Postgres connection string: Neon's pooled URL in production and previews, the container locally. */
  DATABASE_URL: string;
};

export type SkeletonEnv = {
  Bindings: SkeletonBindings;
  Variables: { db: Database };
};
