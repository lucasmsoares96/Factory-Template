import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FactoryConfig } from "../config.ts";
import { must, type DockerCli } from "./docker.ts";

const exec = promisify(execFile);

/** `.factory/image/`: the Dockerfile and setup.sh. */
export const IMAGE_DIR = fileURLToPath(new URL("../../image/", import.meta.url));

export interface ImageInputs {
  /** Build arguments of the Dockerfile. */
  args: { NODE_VERSION: string; PNPM_VERSION: string; PLAYWRIGHT_VERSION: string; CLAUDE_CODE_VERSION: string };
  /** The build context in the repo. */
  context: string;
  dockerfile: string;
  setup: string;
}

/**
 * What the image is made of, read from the repo: Node from `.node-version`,
 * pnpm from `packageManager`, Playwright from `pnpm-lock.yaml` and Claude
 * Code from the config, plus the Dockerfile and setup.sh themselves.
 */
export async function imageInputs(repo: string, config: FactoryConfig): Promise<ImageInputs> {
  const context = join(repo, ".factory/image");
  const node = (await readFile(join(repo, ".node-version"), "utf8")).trim().replace(/^v/, "");
  const manifest = JSON.parse(await readFile(join(repo, "package.json"), "utf8")) as { packageManager?: string };
  const pnpm = /^pnpm@(\d+\.\d+\.\d+)/.exec(manifest.packageManager ?? "")?.[1];
  if (!pnpm) throw new Error("package.json has no `packageManager: pnpm@<version>`");
  const lock = await readFile(join(repo, "pnpm-lock.yaml"), "utf8");
  const playwright = /^ {2}playwright@(\d+\.\d+\.\d+):$/m.exec(lock)?.[1];
  if (!playwright) throw new Error("pnpm-lock.yaml has no playwright package");
  return {
    args: { NODE_VERSION: node, PNPM_VERSION: pnpm, PLAYWRIGHT_VERSION: playwright, CLAUDE_CODE_VERSION: config.claudeCode.version },
    context,
    dockerfile: await readFile(join(context, "Dockerfile"), "utf8"),
    setup: await readFile(join(context, "setup.sh"), "utf8"),
  };
}

/** `<name>:<hash>`; the hash changes with any version, the Dockerfile or setup.sh. */
export async function imageRef(repo: string, config: FactoryConfig, inputs: ImageInputs): Promise<string> {
  const hash = createHash("sha256")
    .update(JSON.stringify([inputs.args, inputs.dockerfile, inputs.setup]))
    .digest("hex")
    .slice(0, 16);
  return `${config.image.name || (await defaultName(repo))}:${hash}`;
}

/** `ghcr.io/<owner>/<repo>/factory` from a GitHub `origin`; `factory-local/<dir>` otherwise. */
async function defaultName(repo: string): Promise<string> {
  const origin = await exec("git", ["remote", "get-url", "origin"], { cwd: repo }).then((r) => r.stdout.trim(), () => "");
  const github = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(origin);
  if (github) return `ghcr.io/${github[1]}/${github[2]}/factory`.toLowerCase();
  return `factory-local/${basename(repo).toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
}

/**
 * Makes `ref` available locally: already there, pulled from the registry, or,
 * when the pull fails (not published yet, no access), built from setup.sh.
 */
export async function ensureImage(
  docker: DockerCli,
  ref: string,
  inputs: ImageInputs,
  log: (line: string) => void,
): Promise<"present" | "pulled" | "built"> {
  if ((await docker(["image", "inspect", "--format", "{{.Id}}", ref])).code === 0) return "present";
  log(`factory: pulling ${ref}`);
  if ((await docker(["pull", ref], { inherit: true })).code === 0) return "pulled";
  log(`factory: ${ref} is not in the registry; building it (a few minutes)`);
  const args = Object.entries(inputs.args).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`]);
  await must(docker, ["build", "--tag", ref, ...args, inputs.context], { inherit: true });
  return "built";
}
