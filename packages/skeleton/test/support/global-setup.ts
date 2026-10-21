import { ensurePostgres } from "../../src/node/postgres.ts";
import { createEmptyDatabase } from "./database.ts";

/** Gives every test file a Postgres server: `DATABASE_URL`, or a throwaway container. */
export default async function setup() {
  const postgres = ensurePostgres({ purpose: "test-skeleton" });
  process.env.DATABASE_URL = postgres.url;
  // A fresh server is slow on its first CREATE DATABASE (cold caches, first checkpoint), and under load that
  // cost landed inside whichever test created a database first. Pay it here, where no test timer is running.
  await (await createEmptyDatabase()).drop();
  return () => postgres.stop();
}
