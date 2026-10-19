import type { Database } from "./db.ts";
import type { PasswordHasherPool } from "./password.ts";

/** Bindings every Product Worker provides to the Skeleton. */
export type SkeletonBindings = {
  /** Postgres connection string: Neon's pooled URL in production and previews, the container locally. */
  DATABASE_URL: string;
  /** Better Auth's signing and encryption secret. */
  BETTER_AUTH_SECRET: string;
  /** The `PasswordHasher` Durable Object (exported by the Product's Worker). */
  PASSWORD_HASHER: PasswordHasherPool;
  /** `outbox` in previews, `pnpm dev` and tests; unset (Resend) in production. */
  EMAIL_TRANSPORT?: string;
  /** Resend API key restricted to the Product's domain. Only production has it. */
  RESEND_API_KEY?: string;
};

export type SkeletonEnv = {
  Bindings: SkeletonBindings;
  Variables: {
    db: Database;
    /** Runs `task` after the response; the request's database client outlives it. */
    defer: (task: Promise<unknown>) => void;
  };
};
