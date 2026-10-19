import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type Postgres = {
  /** Connection string of the server's default database. */
  url: string;
  /** Stops the container if this call started one; a no-op otherwise. */
  stop(): void;
};

/**
 * Uses `DATABASE_URL` when it is set. Otherwise starts the repository's
 * `docker compose` Postgres under a project named after the repository
 * directory and `purpose`, on a random local port, so sibling worktrees and
 * parallel runs never collide.
 */
export function ensurePostgres({
  purpose,
  keep = false,
  cwd = process.cwd(),
}: {
  purpose: string;
  keep?: boolean;
  cwd?: string;
}): Postgres {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return { url: fromEnv, stop() {} };

  const composeFile = findUp("docker-compose.yml", cwd);
  const project = `${basename(dirname(composeFile))}-${purpose}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  const compose = (...args: string[]) =>
    execFileSync("docker", ["compose", "-f", composeFile, "-p", project, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });

  compose("up", "--detach", "--wait", "--quiet-pull", "postgres");
  const address = compose("port", "postgres", "5432").trim();
  const port = address.slice(address.lastIndexOf(":") + 1);
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    stop() {
      if (!keep) compose("down", "--volumes", "--remove-orphans");
    },
  };
}

function findUp(file: string, from: string): string {
  let dir = from;
  for (;;) {
    const candidate = join(dir, file);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${file} not found above ${from}`);
    dir = parent;
  }
}
