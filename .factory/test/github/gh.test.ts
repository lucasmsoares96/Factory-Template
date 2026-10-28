import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGh } from "../../src/adapters/github/gh.ts";
import { tempDir } from "../helpers.ts";

/** A `gh` on PATH that prints its environment and its stdin as JSON, or fails with a message on stderr. */
async function fakeGh(): Promise<string> {
  const dir = await tempDir("fake-gh-");
  const script = [
    `#!${process.execPath}`,
    'let input = "";',
    'process.stdin.on("data", (chunk) => (input += chunk));',
    'process.stdin.on("end", () => {',
    '  if (process.argv[2] === "fail") { process.stderr.write("HTTP 403: nope\\n"); process.exit(1); }',
    "  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), env: process.env, input }));",
    "});",
  ].join("\n");
  await writeFile(join(dir, "gh"), script);
  await chmod(join(dir, "gh"), 0o755);
  return dir;
}

describe("runGh", () => {
  it("gives gh exactly the env it is passed, none of the parent's secrets, and writes the input to stdin", async () => {
    const bin = await fakeGh();
    process.env.FACTORY_TEST_SECRET = "parent-secret";
    try {
      const out = JSON.parse(await runGh(["api", "user"], { env: { PATH: bin, GH_TOKEN: "tok" }, input: "body" })) as { args: string[]; env: Record<string, string>; input: string };

      expect(out.args).toEqual(["api", "user"]);
      expect(out.input).toBe("body");
      expect(out.env.GH_TOKEN).toBe("tok");
      expect(out.env.PATH).toBe(bin);
      expect(out.env.FACTORY_TEST_SECRET).toBeUndefined();
      expect(out.env.HOME).toBeUndefined();
    } finally {
      delete process.env.FACTORY_TEST_SECRET;
    }
  });

  it("rejects with gh's stderr", async () => {
    const bin = await fakeGh();
    await expect(runGh(["fail", "x"], { env: { PATH: bin } })).rejects.toThrow("gh fail x failed: HTTP 403: nope");
  });

  it("says how to install gh when it is not on PATH", async () => {
    const empty = await tempDir("no-gh-");
    await expect(runGh(["api", "user"], { env: { PATH: empty } })).rejects.toThrow("https://cli.github.com");
  });
});
