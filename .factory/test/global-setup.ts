import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Gives the whole run a private TMPDIR. Every temp dir a test makes lands in it, so at the end the run can
 * tell what was left behind (and fail on it) instead of leaving `factory-*` dirs in the machine's /tmp.
 */
export default async function setup() {
  const root = await mkdtemp(join(tmpdir(), "factory-harness-tmp-"));
  process.env.TMPDIR = root;
  return async () => {
    const left = await readdir(root);
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
    if (left.length > 0) throw new Error(`the harness tests left temp dirs behind: ${left.join(", ")}`);
  };
}
