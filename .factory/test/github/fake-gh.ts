import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "../helpers.ts";

/** What the fake `gh` prints on one line: its arguments, its environment and its stdin. */
export interface FakeGhOutput {
  args: string[];
  env: Record<string, string>;
  input: string;
}

/** A directory holding a `gh` that prints a `FakeGhOutput` as JSON, or fails with a message on stderr when its first argument is `fail`. */
export async function fakeGh(): Promise<string> {
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
