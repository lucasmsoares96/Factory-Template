import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { notLeftovers } from "./global-setup.ts";
import { tempDir } from "./helpers.ts";

const exec = promisify(execFile);

it("the temp dirs of a test file are gone afterwards, whether its tests pass or fail", async () => {
  // A child vitest runs the probe with its own TMPDIR, so whatever is left in it is the probe's.
  // Plain output (no colours, no GitHub annotations for the probe's deliberate failure) so the summary can be read.
  const tmp = await tempDir("factory-hygiene-");
  const vitest = join(import.meta.dirname, "../node_modules/vitest/vitest.mjs");
  const run = await exec(process.execPath, [vitest, "run", "--reporter=default", "--config", join(import.meta.dirname, "probe/vitest.config.ts")], {
    cwd: join(import.meta.dirname, ".."),
    env: { ...process.env, TMPDIR: tmp, NO_COLOR: "1" },
  }).then(
    (r) => ({ ok: true, output: r.stdout + r.stderr }),
    (e: { stdout: string; stderr: string }) => ({ ok: false, output: e.stdout + e.stderr }),
  );

  // The probe's failing test really ran (and failed), and its passing test passed.
  expect(run.ok).toBe(false);
  expect(run.output).toMatch(/1 failed \| 1 passed/);
  expect((await readdir(tmp)).filter((name) => !notLeftovers.has(name))).toEqual([]);
});

it("the suite itself runs with a private TMPDIR that the run removes at the end", () => {
  expect(tmpdir()).toMatch(/factory-harness-tmp-/);
});
