import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { skeleton } from "./support/cli.ts";

const ROOT = "00000000-0000-0000-0000-000000000000";
let dir: string;

function writeSnapshot(name: string, id: string, parent: string) {
  mkdirSync(join(dir, "drizzle", name), { recursive: true });
  writeFileSync(join(dir, "drizzle", name, "migration.sql"), "SELECT 1;");
  writeFileSync(join(dir, "drizzle", name, "snapshot.json"), JSON.stringify({ id, prevIds: [parent], version: "8", dialect: "postgres" }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "migration-chain-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const check = (cwd = dir) => skeleton(["migrations", "check-chain"], { cwd });

test("passes a linear chain", () => {
  writeSnapshot("20260101000000_init", "a", ROOT);
  writeSnapshot("20260201000000_more", "b", "a");
  writeSnapshot("20260301000000_last", "c", "b");

  const run = check();

  expect(run.status, run.output).toBe(0);
});

test("passes the Skeleton's own migrations", () => {
  const run = check(resolve(import.meta.dirname, ".."));

  expect(run.status, run.output).toBe(0);
});

test("passes a package without migrations", () => {
  const run = check();

  expect(run.status, run.output).toBe(0);
});

test("fails when two snapshots share a parent, naming the newer folder to delete and regenerate", () => {
  // Two branches each generated a migration on top of the same one: git merges both folders without a conflict.
  writeSnapshot("20260101000000_init", "a", ROOT);
  writeSnapshot("20260201000000_from_main", "b", "a");
  writeSnapshot("20260202000000_from_branch", "c", "a");

  const run = check();

  expect(run.status).toBe(1);
  expect(run.output).toContain("drizzle/20260201000000_from_main");
  expect(run.output).toMatch(/delete drizzle\/20260202000000_from_branch/i);
});

test("fails when a snapshot's parent is missing, naming that folder", () => {
  writeSnapshot("20260101000000_init", "a", ROOT);
  writeSnapshot("20260301000000_orphan", "c", "gone");

  const run = check();

  expect(run.status).toBe(1);
  expect(run.output).toMatch(/delete drizzle\/20260301000000_orphan/i);
  expect(run.output).toContain("gone");
});

test("fails when two first migrations both follow the root, naming the newer folder", () => {
  // A package with no migrations on the base branch, and two branches that each made its first one.
  writeSnapshot("20260101000000_from_main", "a", ROOT);
  writeSnapshot("20260102000000_from_branch", "b", ROOT);

  const run = check();

  expect(run.status).toBe(1);
  expect(run.output).toMatch(/delete drizzle\/20260102000000_from_branch/i);
});
