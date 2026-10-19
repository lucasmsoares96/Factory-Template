import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FactoryVerify } from "../src/adapters/factory-verify.ts";
import { tempDir } from "./helpers.ts";

/** A repo whose `factory:verify` script is `script` (run by the real `pnpm`). */
async function repoWith(script: string): Promise<string> {
  const repo = await tempDir("factory-verify-");
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "probe", private: true, scripts: { "factory:verify": script } }));
  return repo;
}

describe("factory:verify Verify", () => {
  it("passes when `pnpm factory:verify` exits 0", async () => {
    const repo = await repoWith("node -e \"console.log('all green')\"");

    const run = await new FactoryVerify({ repo }).run({ timeoutMs: 60_000 });

    expect(run).toMatchObject({ ok: true, failedCommand: null, timedOut: false });
    expect(run.output).toContain("all green");
  });

  it("fails with the command and its output, stdout and stderr together", async () => {
    const repo = await repoWith("node -e \"console.log('typecheck ok'); console.error('e2e: 1 failed'); process.exit(3)\"");

    const run = await new FactoryVerify({ repo }).run({ timeoutMs: 60_000 });

    expect(run).toMatchObject({ ok: false, failedCommand: "pnpm factory:verify", timedOut: false });
    expect(run.output).toContain("typecheck ok");
    expect(run.output).toContain("e2e: 1 failed");
  });

  it("stops at its timeout, which counts as a failure", async () => {
    const repo = await repoWith("node -e \"setInterval(() => {}, 1000)\"");

    const run = await new FactoryVerify({ repo }).run({ timeoutMs: 2000 });

    expect(run).toMatchObject({ ok: false, failedCommand: "pnpm factory:verify", timedOut: true });
  });
});
