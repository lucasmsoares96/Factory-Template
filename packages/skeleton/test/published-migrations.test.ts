import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { skeleton } from "./support/cli.ts";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

function writeMigration(name: string, sql: string) {
  mkdirSync(join(repo, "drizzle", name), { recursive: true });
  writeFileSync(join(repo, "drizzle", name, "migration.sql"), sql);
  writeFileSync(join(repo, "drizzle", name, "snapshot.json"), "{}");
}

beforeEach(() => {
  // A product repo whose `main` already shipped one migration, with work on a branch.
  repo = mkdtempSync(join(tmpdir(), "published-migrations-"));
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeMigration("20260101000000_init", "CREATE TABLE a (id text);");
  git("add", ".");
  git("commit", "--quiet", "-m", "init");
  git("switch", "--quiet", "-c", "feature");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const check = () => skeleton(["migrations", "check-published", "--base", "main"], { cwd: repo });

test("passes when the branch only adds migrations", () => {
  writeMigration("20260201000000_more", "CREATE TABLE b (id text);");
  git("add", ".");
  git("commit", "--quiet", "-m", "more");

  const run = check();

  expect(run.status, run.output).toBe(0);
});

test("fails when a published migration is edited, even before committing", () => {
  writeFileSync(join(repo, "drizzle/20260101000000_init/migration.sql"), "CREATE TABLE a (id int);");

  const run = check();

  expect(run.status).toBe(1);
  expect(run.output).toContain("drizzle/20260101000000_init/migration.sql");
});

test("fails when a published migration is renamed", () => {
  renameSync(join(repo, "drizzle/20260101000000_init"), join(repo, "drizzle/20260101000000_first"));
  git("add", "--all");
  git("commit", "--quiet", "-m", "rename");

  const run = check();

  expect(run.status).toBe(1);
  expect(run.output).toContain("drizzle/20260101000000_init/migration.sql");
});
