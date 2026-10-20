// `pnpm factory:ci-probe`: proves the Skeleton's template yields a Product that
// passes `verify`. In a throwaway copy of the repository it runs
// `pnpm new-product ci-probe` and then `factory:verify` for that Product only
// (generate, typecheck, lint, test, e2e; no deploy). Heavy (a full install and a
// production build), so it is its own job (`ci-probe` in CI), not part of
// `factory:verify`. The copy and every Docker resource started from it are
// removed at the end, also when the probe fails or is interrupted.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findWorkspaceRoot } from "@workspace/skeleton/node";

const PRODUCT = "ci-probe";
const SKIPPED = [/^\.scratch\//, /^\.agents\//, /^\.claude\//, /^test-results\//];

const root = findWorkspaceRoot(process.cwd());
const copy = realpathSync(mkdtempSync(join(tmpdir(), "ci-probe-")));

/** The files of the repository as Git sees them (tracked, plus untracked and not ignored). */
function repositoryFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return output.split("\0").filter((file) => file && !SKIPPED.some((skip) => skip.test(file)));
}

function run(command: string, args: string[], env: Record<string, string | undefined> = {}) {
  const { status } = spawnSync(command, args, { cwd: copy, stdio: "inherit", env: { ...process.env, ...env } });
  if (status !== 0) throw new Error(`\`${command} ${args.join(" ")}\` failed (exit ${status}).`);
}

/** Removes the compose projects started from the copy (`ensurePostgres` names them after its folder). */
function removeDockerResources() {
  let projects: Array<{ Name: string; ConfigFiles: string }> = [];
  try {
    projects = JSON.parse(
      execFileSync("docker", ["compose", "ls", "--all", "--format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    );
  } catch {
    return; // No Docker (DATABASE_URL was used): nothing to remove.
  }
  for (const { Name, ConfigFiles } of projects) {
    const file = ConfigFiles.split(",").find((path) => path.startsWith(`${copy}/`));
    if (!file) continue;
    try {
      execFileSync("docker", ["compose", "-f", file, "-p", Name, "down", "--volumes", "--remove-orphans"], { stdio: "ignore" });
    } catch (error) {
      console.error(`Could not remove the Docker project ${Name}:`, error instanceof Error ? error.message : error);
    }
  }
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  removeDockerResources();
  rmSync(copy, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

let status = 0;
try {
  console.log(`ci-probe: copying the repository to ${copy}`);
  for (const file of repositoryFiles()) {
    mkdirSync(dirname(join(copy, file)), { recursive: true });
    try {
      cpSync(join(root, file), join(copy, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; // tracked but deleted in the working tree
    }
  }
  const git = (...args: string[]) => run("git", ["-c", "user.name=ci-probe", "-c", "user.email=ci-probe@example.com", ...args]);
  git("init", "--quiet", "-b", "main");
  git("add", "-A");
  git("commit", "--quiet", "-m", "chore: probe base");

  // The copy has no frozen lockfile: the new Product adds an importer to it.
  run("pnpm", ["new-product", PRODUCT], { npm_config_frozen_lockfile: "false" });
  git("add", "-A");
  git("commit", "--quiet", "-m", "feat: add the probe Product");

  run("node", ["scripts/verify.ts", "--filter", PRODUCT]);
  console.log(`ci-probe: ${PRODUCT} passed verify.`);
} catch (error) {
  console.error(`ci-probe failed: ${error instanceof Error ? error.message : error}`);
  status = 1;
} finally {
  cleanup();
}
process.exit(status);
