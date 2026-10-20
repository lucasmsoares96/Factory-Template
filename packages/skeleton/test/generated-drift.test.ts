import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { filesChangedBy } from "../src/node/index.ts";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const write = (path: string, content: string) => writeFileSync(join(repo, path), content);

beforeEach(() => {
  // A repo with a committed generated file and an ignored one.
  repo = mkdtempSync(join(tmpdir(), "generated-drift-"));
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write(".gitignore", "openapi.json\n");
  write("routeTree.gen.ts", "export const routes = 1;\n");
  write("route.tsx", "export const page = 1;\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("nothing changed when generation rewrites a committed file with the same content", () => {
  const changed = filesChangedBy(() => {
    write("routeTree.gen.ts", "export const routes = 1;\n");
    write("openapi.json", "{}");
  }, repo);

  expect(changed).toEqual([]);
});

test("reports a committed generated file that generation had to update", () => {
  const changed = filesChangedBy(() => write("routeTree.gen.ts", "export const routes = 2;\n"), repo);

  expect(changed).toEqual(["routeTree.gen.ts"]);
});

test("reports a generated file that is not committed", () => {
  const changed = filesChangedBy(() => write("new.gen.ts", "export {};\n"), repo);

  expect(changed).toEqual(["new.gen.ts"]);
});

test("ignores local edits that generation leaves alone, and catches one it rewrites", () => {
  write("route.tsx", "export const page = 2;\n");
  write("routeTree.gen.ts", "// stale\n");

  const changed = filesChangedBy(() => write("routeTree.gen.ts", "export const routes = 2;\n"), repo);

  expect(changed).toEqual(["routeTree.gen.ts"]);
});
