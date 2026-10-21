import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { loadProduct } from "../../src/bootstrap/cli.ts";
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

  it("refuses an unknown command", async () => {
    const w = world();

    const { code, output } = await w.run("frobnicate");

    expect(code).toBe(1);
    expect(output).toContain("Unknown command");
  });

  it("is wired to `pnpm bootstrap`", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const { stdout } = await exec("pnpm", ["--silent", "bootstrap", "help"], { cwd: root });

    expect(stdout).toContain("pnpm bootstrap");
  });

  it("reads a Product's identity from apps/<id>/product.config.ts, and refuses ids that are not Products", async () => {
    expect(await loadProduct("example")).toMatchObject({ id: "example", domain: expect.any(String) });
    await expect(loadProduct("ghost")).rejects.toThrow("No Product at apps/ghost");
    await expect(loadProduct("../etc")).rejects.toThrow(/not a Product id/);
  });

  it("`pnpm bootstrap domain` without an id or with an unknown Product fails before any API call", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    await expect(exec("pnpm", ["--silent", "bootstrap", "domain", "ghost"], { cwd: root })).rejects.toMatchObject({ stdout: expect.stringContaining("No Product at apps/ghost") });
  });
});
