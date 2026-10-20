import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

async function pnpmFactory(...args: string[]) {
  try {
    const { stdout, stderr } = await exec("pnpm", ["--silent", "factory", ...args], { cwd: root });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe("pnpm factory", () => {
  it("lists the commands", async () => {
    const { code, stdout } = await pnpmFactory("help");

    expect(code).toBe(0);
    for (const command of ["claim", "work", "publish"]) expect(stdout).toMatch(new RegExp(`^  ${command} `, "m"));
  });

  it("fails with a clear message when no adapters are configured", async () => {
    const { code, stderr } = await pnpmFactory("claim", "7");

    expect(code).not.toBe(0);
    expect(stderr).toContain("FACTORY_ADAPTERS");
  });
});
