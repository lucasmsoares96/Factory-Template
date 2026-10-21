import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { DockerContainerRunner } from "../src/local/container.ts";
import type { DockerCli, DockerResult } from "../src/local/docker.ts";
import { ensureImage, IMAGE_DIR, imageInputs, imageRef } from "../src/local/image.ts";
import { git, tempDir } from "./helpers.ts";

/** A scripted `docker` CLI: records each call; `answer` decides the result. */
function fakeDocker(answer: (args: string[]) => Partial<DockerResult> | undefined = () => undefined) {
  const calls: { args: string[]; env: Record<string, string> | undefined }[] = [];
  const docker: DockerCli = async (args, options) => {
    calls.push({ args, env: options?.env });
    return { code: 0, stdout: "", stderr: "", ...answer(args) };
  };
  return { docker, calls, commands: () => calls.map((c) => c.args.slice(0, 2).join(" ")) };
}

/** The files the image hash reads, in a throwaway repo. */
async function imageRepo(): Promise<string> {
  const repo = await tempDir("factory-image-");
  await writeFile(join(repo, ".node-version"), "24.22.0\n");
  await writeFile(join(repo, "package.json"), JSON.stringify({ packageManager: "pnpm@12.14.0" }));
  await writeFile(join(repo, "pnpm-lock.yaml"), "packages:\n\n  playwright-core@1.64.1:\n    resolution: {}\n\n  playwright@1.64.1:\n    resolution: {}\n");
  await mkdir(join(repo, ".factory"), { recursive: true });
  await cp(IMAGE_DIR, join(repo, ".factory/image"), { recursive: true });
  await git(repo, "init", "--quiet");
  await git(repo, "remote", "add", "origin", "git@github.com:acme/widgets.git");
  return repo;
}

describe("Factory image", () => {
  it("is tagged by the hash of .node-version, pnpm, Playwright, Claude Code, the Dockerfile and setup.sh", async () => {
    const repo = await imageRepo();
    const config = loadConfig({});
    const inputs = await imageInputs(repo, config);

    expect(inputs.args).toEqual({ NODE_VERSION: "24.22.0", PNPM_VERSION: "12.14.0", PLAYWRIGHT_VERSION: "1.64.1", CLAUDE_CODE_VERSION: "2.1.303" });
    const ref = await imageRef(repo, config, inputs);
    expect(ref).toMatch(/^ghcr\.io\/acme\/widgets\/factory:[0-9a-f]{16}$/);
    expect(await imageRef(repo, config, await imageInputs(repo, config))).toBe(ref);

    const bumped = loadConfig({ FACTORY_CLAUDE_CODE_VERSION: "2.1.304" });
    expect(await imageRef(repo, bumped, await imageInputs(repo, bumped))).not.toBe(ref);
    await writeFile(join(repo, ".factory/image/setup.sh"), "# changed\n", { flag: "a" });
    expect(await imageRef(repo, config, await imageInputs(repo, config))).not.toBe(ref);
    expect(await imageRef(repo, loadConfig({ FACTORY_IMAGE_NAME: "registry.test/me/img" }), inputs)).toMatch(/^registry\.test\/me\/img:/);
  });

  it("uses the local image, else pulls it, and only builds when the pull fails", async () => {
    const repo = await imageRepo();
    const inputs = await imageInputs(repo, loadConfig({}));
    const log = () => {};

    const present = fakeDocker();
    expect(await ensureImage(present.docker, "img:abc", inputs, log)).toBe("present");
    expect(present.commands()).toEqual(["image inspect"]);

    const pulled = fakeDocker((args) => (args[1] === "inspect" ? { code: 1 } : undefined));
    expect(await ensureImage(pulled.docker, "img:abc", inputs, log)).toBe("pulled");
    expect(pulled.commands()).toEqual(["image inspect", "pull img:abc"]);

    const built = fakeDocker((args) => (args[1] === "inspect" || args[0] === "pull" ? { code: 1 } : undefined));
    expect(await ensureImage(built.docker, "img:abc", inputs, log)).toBe("built");
    const build = built.calls.at(-1)!.args;
    expect(build.slice(0, 3)).toEqual(["build", "--tag", "img:abc"]);
    expect(build).toEqual(expect.arrayContaining(["--build-arg", "NODE_VERSION=24.22.0", "--build-arg", "CLAUDE_CODE_VERSION=2.1.303"]));
    expect(build.at(-1)).toBe(join(repo, ".factory/image"));
  });
});

describe("Docker container runner", () => {
  async function job() {
    const repo = await imageRepo();
    const inDir = await tempDir("factory-in-");
    const outDir = await tempDir("factory-out-");
    return { repo, issue: 7, inDir, outDir, base: "main", env: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret", FACTORY_MACHINE_USER: "factory" } };
  }

  const healthy = (args: string[]) => (args[0] === "inspect" ? { stdout: "healthy\n" } : undefined);

  it("clones the repo into a fresh container with only Claude's auth, Postgres on a private network and no Docker socket", async () => {
    const fake = fakeDocker(healthy);
    const runner = new DockerContainerRunner({ docker: fake.docker, config: loadConfig({}), log: () => {}, suffix: () => "x1" });

    expect(await runner.run(await job())).toEqual({ exitCode: 0 });

    const all = fake.calls.map((c) => c.args);
    const flat = all.flat();
    // Nothing from the host is mounted: the repo goes in as a bundle that is cloned.
    expect(flat.some((a) => /^(-v|--volume|--mount)$/.test(a) || a.includes("docker.sock"))).toBe(false);
    expect(flat.some((a) => a.includes("oauth-secret"))).toBe(false);

    const ns = "factory-factory-image-";
    const network = all.find((a) => a[0] === "network" && a[1] === "create")!;
    expect(network).toContain("--internal");
    const postgres = all.find((a) => a[0] === "run")!;
    expect(postgres).toEqual(expect.arrayContaining(["--network", network.at(-1)!, "--network-alias", "postgres"]));
    expect(postgres.some((a) => a === "-p" || a === "--publish")).toBe(false);

    const create = fake.calls.find((c) => c.args[0] === "create")!;
    const passed = create.args.flatMap((a, i) => (create.args[i - 1] === "-e" ? [a] : []));
    expect(passed.sort()).toEqual(
      ["CLAUDE_CODE_OAUTH_TOKEN", "DATABASE_URL", "FACTORY_ADAPTERS", "FACTORY_MACHINE_USER", "FACTORY_SESSIONS_DIR", "FACTORY_TRACKER_DIR"].sort(),
    );
    expect(create.env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret", DATABASE_URL: "postgres://postgres:postgres@postgres:5432/postgres", FACTORY_ADAPTERS: "local" });
    expect(create.args.some((a) => a.startsWith("--user") || a === "--privileged")).toBe(false);

    const exec = all.find((a) => a[0] === "exec")!;
    expect(exec.join(" ")).toContain("git clone");
    // The script takes the command as an argument (`work` or `triage`), then the base, the issue and the command.
    expect(exec.join(" ")).toContain('pnpm factory "$command"');
    expect(exec.slice(-3)).toEqual(["main", "7", "work"]);

    const names = [network.at(-1)!, ...all.filter((a) => a[0] === "create" || a[0] === "run").map((a) => a[a.indexOf("--name") + 1]!)];
    for (const name of names) expect(name.startsWith(ns)).toBe(true);
    expect(fake.commands().slice(-2)).toEqual([`rm --force`, `network rm`]);
    expect(all.at(-2)).toEqual(expect.arrayContaining(names.slice(1)));
    expect(all.at(-1)).toContain(names[0]);
  });

  it("removes the containers and the network when the job fails", async () => {
    const fake = fakeDocker((args) => (args[0] === "exec" ? { code: 2 } : healthy(args)));
    const runner = new DockerContainerRunner({ docker: fake.docker, config: loadConfig({}), log: () => {}, suffix: () => "x2" });

    expect(await runner.run(await job())).toEqual({ exitCode: 2 });
    expect(fake.commands().slice(-2)).toEqual(["rm --force", "network rm"]);

    const broken = fakeDocker((args) => (args[0] === "start" ? { code: 125, stderr: "boom" } : healthy(args)));
    const failing = new DockerContainerRunner({ docker: broken.docker, config: loadConfig({}), log: () => {}, suffix: () => "x3" });
    await expect(failing.run(await job())).rejects.toThrow(/docker start .* failed: boom/);
    expect(broken.commands().slice(-2)).toEqual(["rm --force", "network rm"]);
  });

  it("copies the job's artifacts back out of the container", async () => {
    const fake = fakeDocker(healthy);
    const runner = new DockerContainerRunner({ docker: fake.docker, config: loadConfig({}), log: () => {}, suffix: () => "x4" });
    const j = await job();

    await runner.run(j);

    const copies = fake.calls.filter((c) => c.args[0] === "cp").map((c) => c.args);
    expect(copies[0]).toEqual([`cp`, `${j.inDir}/.`, expect.stringMatching(/-agent:\/home\/factory\/in$/)]);
    expect(copies[1]).toEqual([`cp`, expect.stringMatching(/-agent:\/home\/factory\/out\/\.$/), j.outDir]);
  });
});
