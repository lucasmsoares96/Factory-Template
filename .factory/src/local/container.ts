import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import type { FactoryConfig } from "../config.ts";
import { must, type DockerCli } from "./docker.ts";
import { ensureImage, imageInputs, imageRef } from "./image.ts";

/** Inside the container. `in/` holds `repo.bundle` and `tracker/`. */
export const CONTAINER_HOME = "/home/factory";
export const IN_BUNDLE = "repo.bundle";
export const IN_TRACKER = "tracker";

export interface ContainerJob {
  /** The host repository (image inputs, resource names). */
  repo: string;
  issue: number;
  /** Host directory copied in: the base branch as `repo.bundle`, the tickets under `tracker/`. */
  inDir: string;
  /** Host directory that receives the `work` artifacts. */
  outDir: string;
  /** Branch the clone checks out and the run starts from. */
  base: string;
  /** Variables for the job: Claude's auth and the FACTORY_* settings, nothing else. */
  env: Record<string, string>;
}

/** Runs `pnpm factory work` for one issue somewhere disposable. */
export interface ContainerRunner {
  run(job: ContainerJob): Promise<{ exitCode: number }>;
}

export interface DockerContainerRunnerOptions {
  docker: DockerCli;
  config: FactoryConfig;
  log: (line: string) => void;
  postgresImage?: string;
  /** Random part of the resource names. */
  suffix?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

const POSTGRES_URL = "postgres://postgres:postgres@postgres:5432/postgres";

/**
 * The `work` job on the local Docker: a throwaway container of the Factory
 * image, the repo cloned from a bundle (never a bind mount), only Claude's
 * auth inside, Postgres in a sibling container on an internal network, no
 * Docker socket. Every container and the network go away at the end.
 */
export class DockerContainerRunner implements ContainerRunner {
  private readonly options: DockerContainerRunnerOptions;

  constructor(options: DockerContainerRunnerOptions) {
    this.options = options;
  }

  async run(job: ContainerJob): Promise<{ exitCode: number }> {
    const { docker, config, log } = this.options;
    const inputs = await imageInputs(job.repo, config);
    const image = await imageRef(job.repo, config, inputs);
    log(`factory: image ${image} (${await ensureImage(docker, image, inputs, log)})`);

    const ns = `factory-${slug(basename(job.repo))}-${job.issue}-${(this.options.suffix ?? random)()}`;
    const network = ns;
    const postgres = `${ns}-postgres`;
    const agent = `${ns}-agent`;
    const env = {
      ...job.env,
      DATABASE_URL: POSTGRES_URL,
      FACTORY_ADAPTERS: "local",
      FACTORY_TRACKER_DIR: `${CONTAINER_HOME}/in/${IN_TRACKER}/issues`,
      FACTORY_SESSIONS_DIR: `${CONTAINER_HOME}/out/sessions`,
    };
    try {
      // Internal: Postgres has no way out and nothing published on the host.
      await must(docker, ["network", "create", "--internal", network]);
      await must(docker, [
        "run", "--detach", "--name", postgres, "--network", network, "--network-alias", "postgres",
        "--tmpfs", "/var/lib/postgresql", "--env", "POSTGRES_PASSWORD=postgres",
        "--health-cmd", "pg_isready -U postgres -d postgres", "--health-interval", "1s",
        this.options.postgresImage ?? "postgres:18.6-alpine",
      ]);
      await this.waitHealthy(postgres);
      // `-e NAME` takes the value from the docker CLI's env: no secret on the command line.
      await must(
        docker,
        ["create", "--name", agent, "--network", network, "--init", "--shm-size", "2g", ...Object.keys(env).flatMap((k) => ["-e", k]), image],
        { env },
      );
      // The default bridge gives the agent the internet (Claude, the npm registry).
      await must(docker, ["network", "connect", "bridge", agent]);
      await must(docker, ["start", agent]);
      await must(docker, ["cp", `${job.inDir}/.`, `${agent}:${CONTAINER_HOME}/in`]);
      log(`factory: running issue #${job.issue} in ${agent}`);
      const { code } = await docker(["exec", agent, "bash", "-c", WORK_SCRIPT, "work", job.base, String(job.issue)], { inherit: true });
      await docker(["cp", `${agent}:${CONTAINER_HOME}/out/.`, job.outDir]);
      return { exitCode: code };
    } finally {
      await docker(["rm", "--force", "--volumes", agent, postgres]);
      await docker(["network", "rm", network]);
    }
  }

  private async waitHealthy(container: string): Promise<void> {
    const sleep = this.options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (let i = 0; i < 60; i++) {
      const { stdout } = await this.options.docker(["inspect", "--format", "{{.State.Health.Status}}", container]);
      if (stdout.trim() === "healthy") return;
      await sleep(1000);
    }
    throw new Error(`${container} did not become healthy`);
  }
}

/** Inside the container, as uid 1001: clone, install, then the same `work` as CI. */
const WORK_SCRIPT = `set -euo pipefail
base="$1"; issue="$2"
git clone --quiet --branch "$base" ${CONTAINER_HOME}/in/${IN_BUNDLE} ${CONTAINER_HOME}/repo
cd ${CONTAINER_HOME}/repo
git config user.name "Factory"
git config user.email "factory@localhost"
pnpm install --frozen-lockfile
mkdir -p ${CONTAINER_HOME}/out
pnpm factory work "$issue" --out ${CONTAINER_HOME}/out`;

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
}

function random(): string {
  return randomBytes(3).toString("hex");
}
