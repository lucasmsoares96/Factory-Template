import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { world } from "./helpers.ts";

const exec = promisify(execFile);

describe("bootstrap CLI", () => {
  it("prints usage for help", async () => {
    const w = world();

    const { code, output } = await w.run("help");

    expect(code).toBe(0);
    expect(output).toContain("pnpm bootstrap doctor");
    expect(output).toContain("--redo");
  });

  it("refuses commands that other tickets add", async () => {
    const w = world();

    const { code, output } = await w.run("destroy");

    expect(code).toBe(1);
    expect(output).toContain("Unknown command");
  });

  it("is wired to `pnpm bootstrap`", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const { stdout } = await exec("pnpm", ["--silent", "bootstrap", "help"], { cwd: root });

    expect(stdout).toContain("pnpm bootstrap");
  });
});
