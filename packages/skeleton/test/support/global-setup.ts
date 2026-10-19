import { ensurePostgres } from "../../src/node/postgres.ts";

/** Gives every test file a Postgres server: `DATABASE_URL`, or a throwaway container. */
export default function setup() {
  const postgres = ensurePostgres({ purpose: "test-skeleton" });
  process.env.DATABASE_URL = postgres.url;
  return () => postgres.stop();
}
