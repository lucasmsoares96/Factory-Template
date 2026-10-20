import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Seam 2: the CI workflows are read as data. Until a human installs them, they
// wait in the pending directory; once copied to `.github/workflows`, this is the
// only line to change (and `.scratch/factory-base/pending/ticket-12` goes away).
const WORKFLOWS_DIR = ".github/workflows";

const repo = join(import.meta.dirname, "../..");

interface Job {
  "runs-on"?: unknown;
  container?: { image?: string };
  permissions?: Record<string, string>;
  needs?: string | string[];
  strategy?: { "fail-fast"?: boolean; matrix?: unknown };
  services?: Record<string, unknown>;
  defaults?: { run?: { shell?: string } };
  steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown>; name?: string }>;
  uses?: string;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: unknown;
  jobs: Record<string, Job>;
}

/** Reads and parses every workflow in `dir`, relative to the repository root. */
function load(dir: string): Record<string, Workflow> {
  const names = ["factory-image.yml", "factory-pr.yml"];
  return Object.fromEntries(names.map((name) => [name, parse(readFileSync(join(repo, dir, name), "utf8")) as Workflow]));
}

/** The text of a job, to look for forbidden words. */
const textOf = (job: Job) => JSON.stringify(job);
const steps = (job: Job) => job.steps ?? [];
const runs = (job: Job) => steps(job).map((step) => step.run ?? "");
const runsOn = (job: Job) => JSON.stringify(job["runs-on"] ?? "");

/** The checks, as a function of the directory, so the same ones pass on `.github/workflows`. */
function checkWorkflows(dir: string) {
  const workflows = load(dir);
  const image = workflows["factory-image.yml"]!;
  const pr = workflows["factory-pr.yml"]!;
  const allJobs = Object.entries(workflows).flatMap(([file, workflow]) => Object.entries(workflow.jobs).map(([id, job]) => ({ file, id, job })));
  return { workflows, image, pr, allJobs };
}

describe.each([[WORKFLOWS_DIR]])("CI workflows in %s", (dir) => {
  const { image, pr, allJobs } = checkWorkflows(dir);
  const build = pr.jobs.build!;

  it("only `build` takes vars.FACTORY_RUNNER (and `work`, once it exists), always in a container", () => {
    const takers = allJobs.filter(({ job }) => runsOn(job).includes("vars.FACTORY_RUNNER")).map(({ id }) => id);
    expect(takers).toEqual(["build"]);
    expect(runsOn(build)).toContain("ubuntu-latest");
    expect(build.container?.image).toBe("${{ needs.image.outputs.image }}");
  });

  it("`build` is read-only, secretless, cacheless and does not keep the token", () => {
    expect(build.permissions).toEqual({ contents: "read", packages: "read" });
    expect(textOf(build)).not.toMatch(/secrets\./);
    expect(textOf(build)).not.toMatch(/cache/i);
    const checkout = steps(build).find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toMatchObject({ "persist-credentials": false, filter: "blob:none" });
    expect(build.defaults?.run?.shell).toBe("bash");
    expect(Object.keys(build.services ?? {})).toEqual(["postgres"]);
  });

  it("`build` has one job per affected package from the plan, without fail-fast", () => {
    expect(build.strategy?.["fail-fast"]).toBe(false);
    expect(build.strategy?.matrix).toBe("${{ fromJSON(needs.plan.outputs.matrix) }}");
    expect(pr.jobs.plan!.needs).toBe("image");
    expect(runs(pr.jobs.plan!).join("\n")).toContain("node .factory/src/ci/matrix.ts");
    expect(runs(build).join("\n")).toContain("pnpm factory:verify --filter");
  });

  it("no job of the PR workflow holds a secret or a write permission besides the image", () => {
    expect(pr.on).toHaveProperty("pull_request_target");
    expect(pr.permissions).toEqual({});
    for (const { file, id, job } of allJobs) {
      if (file !== "factory-pr.yml") continue;
      expect(textOf(job), id).not.toMatch(/secrets\./);
      const writes = Object.entries(job.permissions ?? {}).filter(([, level]) => level === "write");
      expect(writes, id).toEqual(id === "image" ? [["packages", "write"]] : []);
      for (const step of steps(job)) {
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"], id).toBe(false);
      }
    }
  });

  it("the reusable `image` job publishes with packages: write, checks the tag first and returns it", () => {
    const job = image.jobs.image!;
    expect(image.on).toHaveProperty("workflow_call");
    expect(job.permissions).toEqual({ contents: "read", packages: "write" });
    expect(runs(job).join("\n")).toContain("node .factory/src/ci/image.ts");
    expect(runs(job).join("\n")).toContain("imagetools inspect");
    const publish = steps(job).find((step) => step.uses?.startsWith("docker/build-push-action@"));
    expect(publish).toMatchObject({ if: "steps.registry.outputs.exists == 'false'", with: { push: true } });
    expect(JSON.stringify(image.on)).toContain("jobs.image.outputs.ref");
    expect(pr.jobs.image!.uses).toBe("./.github/workflows/factory-image.yml");
  });

  it("`skills-check` restores the pinned CLI from the lock, diffs and checks the symlinks", () => {
    const job = pr.jobs["skills-check"]!;
    const script = runs(job).join("\n");
    expect(script).toMatch(/skills@\d+\.\d+\.\d+ experimental_install/);
    expect(script).toContain("git diff --exit-code");
    expect(script).toContain(".factory/src/ci/skills.ts");
  });

  it("`ci-probe` runs the probe in the image without deploying", () => {
    const job = pr.jobs["ci-probe"]!;
    expect(runs(job)).toContain("pnpm factory:ci-probe");
    expect(textOf(job)).not.toMatch(/wrangler|deploy|secrets\./i);
    expect(job.container?.image).toBe("${{ needs.image.outputs.image }}");
  });

  it("`verify` is the required check: it waits for everything and fails if any job failed", () => {
    const job = pr.jobs.verify!;
    expect(job.needs).toEqual(expect.arrayContaining(["image", "plan", "build", "skills-check", "ci-probe"]));
    expect(String(job["runs-on"])).toBe("ubuntu-latest");
    expect(JSON.stringify(job)).toContain("always()");
    expect(JSON.stringify(job)).toContain("contains(needs.*.result, 'failure')");
  });

  it("every action is pinned to a commit", () => {
    for (const { id, job } of allJobs) {
      for (const step of steps(job)) if (step.uses) expect(step.uses, id).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("the Postgres service is the one docker-compose.yml uses", () => {
    const compose = readFileSync(join(repo, "docker-compose.yml"), "utf8");
    const version = /postgres:([\w.-]+)\}/.exec(compose)?.[1];
    expect(JSON.stringify(build.services)).toContain(`postgres:${version}`);
  });
});

describe("workflow files", () => {
  it("the legacy Claude workflows are gone once the new ones are installed", () => {
    const installed = existsSync(join(repo, ".github/workflows/factory-pr.yml"));
    for (const name of ["claude.yml", "claude-code-review.yml"]) {
      if (installed) expect(existsSync(join(repo, ".github/workflows", name)), name).toBe(false);
    }
  });
});

describe("turbo globalDependencies", () => {
  it("cover the root files every package depends on", () => {
    const turbo = JSON.parse(readFileSync(join(repo, "turbo.json"), "utf8")) as { globalDependencies: string[] };
    for (const file of [".node-version", ".oxlintrc.json", "docker-compose.yml", "package.json", "pnpm-workspace.yaml", "tsconfig.base.json", "scripts/verify.ts"]) {
      expect(turbo.globalDependencies, file).toContain(file);
    }
  });
});
