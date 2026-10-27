import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Seam 2: the CI workflows are read as data.
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
  "timeout-minutes"?: number;
  steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown>; name?: string; env?: Record<string, string>; if?: string; "continue-on-error"?: boolean }>;
  uses?: string;
  with?: Record<string, unknown>;
  if?: string;
  environment?: unknown;
  env?: Record<string, string>;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: unknown;
  jobs: Record<string, Job>;
}

/** Reads and parses every workflow in `dir`, relative to the repository root. */
function load(dir: string): Record<string, Workflow> {
  const names = ["factory-image.yml", "factory-pr.yml", "factory-deploy.yml", "factory-pr-cleanup.yml", "factory-issue.yml", "factory-unblock.yml", "factory-triage.yml", "factory-pr-feedback.yml", "factory-update-branches.yml", "factory-retro.yml", "factory-skills-update.yml"];
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
  const deploy = workflows["factory-deploy.yml"]!;
  const allJobs = Object.entries(workflows).flatMap(([file, workflow]) => Object.entries(workflow.jobs).map(([id, job]) => ({ file, id, job })));
  return { workflows, image, pr, deploy, allJobs };
}

describe.each([[WORKFLOWS_DIR]])("CI workflows in %s", (dir) => {
  const { image, pr, deploy, allJobs } = checkWorkflows(dir);
  const build = pr.jobs.build!;

  it("only `build` and `work` take vars.FACTORY_RUNNER, always in a container; `claim` and `publish` never do", () => {
    const takers = allJobs.filter(({ job }) => runsOn(job).includes("vars.FACTORY_RUNNER")).map(({ file, id }) => `${file} ${id}`);
    expect(takers.sort()).toEqual(["factory-deploy.yml build", "factory-issue.yml work", "factory-pr-feedback.yml work", "factory-pr.yml build", "factory-retro.yml work", "factory-triage.yml work", "factory-update-branches.yml work"]);
    for (const { file, id, job } of allJobs.filter(({ job }) => runsOn(job).includes("vars.FACTORY_RUNNER"))) {
      expect(job.container?.image, `${file} ${id}`).toBe("${{ needs.image.outputs.image }}");
      expect(runsOn(job), `${file} ${id}`).toContain("ubuntu-latest");
    }
    expect(runsOn(deploy.jobs.build!)).toContain("ubuntu-latest");
    expect(runsOn(build)).toContain("ubuntu-latest");
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

  // The jobs that run the PR's code (or the base's, for the image): no secret, no write besides the image's packages.
  const PR_CODE = ["image", "plan", "build", "skills-check", "ci-probe", "verify"];

  it("no job that runs the PR's code holds a secret or a write permission besides the image", () => {
    expect(pr.on).toHaveProperty("pull_request_target");
    expect(pr.permissions).toEqual({});
    for (const id of PR_CODE) {
      const job = pr.jobs[id]!;
      expect(textOf(job), id).not.toMatch(/secrets[.[]/);
      const writes = Object.entries(job.permissions ?? {}).filter(([, level]) => level === "write");
      expect(writes, id).toEqual(id === "image" ? [["packages", "write"]] : []);
    }
    for (const [id, job] of Object.entries(pr.jobs)) {
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

  it("`skills-check` restores with the pinned CLI, judges only what the PR changed and checks the symlinks", () => {
    const job = pr.jobs["skills-check"]!;
    const script = runs(job).join("\n");
    expect(script).toMatch(/skills@\d+\.\d+\.\d+ experimental_install/);
    expect(script).toContain('node .factory/src/ci/skills.ts check --base "$BASE_SHA"');
    expect(script).toContain("node .factory/src/ci/skills.ts links");
    expect(script).not.toContain("git diff --exit-code");
    expect(steps(job).find((s) => s.name === "skills")?.env).toEqual({ BASE_SHA: "${{ github.event.pull_request.base.sha }}" });
    expect(steps(job).find((s) => s.uses?.startsWith("actions/checkout@"))?.with).toMatchObject({ "fetch-depth": 0, "persist-credentials": false });
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

describe.each([[WORKFLOWS_DIR]])("deploy workflow in %s", (dir) => {
  const { deploy, allJobs } = checkWorkflows(dir);
  const jobs = deploy.jobs;
  const mine = allJobs.filter(({ file }) => file === "factory-deploy.yml");

  it("runs on pushes to the default branch and by hand, and is off until DEPLOY_ENABLED", () => {
    expect(Object.keys(deploy.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(deploy.permissions).toEqual({});
    expect(jobs.image!.if).toContain("vars.DEPLOY_ENABLED == 'true'");
    // Every other job needs `image`, directly or through `plan`, so one skipped job skips the rest.
    expect(jobs.plan!.needs).toBe("image");
    expect(jobs.build!.needs).toEqual(["image", "plan"]);
    expect(jobs.deploy!.needs).toEqual(["plan", "build"]);
    expect(jobs.smoke!.needs).toEqual(["plan", "deploy"]);
  });

  it("`deploy` is the only job with Cloudflare or production secrets; `preview-base` holds the preview Neon key only", () => {
    const withSecrets = mine.filter(({ id, job }) => id !== "smoke" && /secrets[.[]/.test(textOf(job))).map(({ id }) => id);
    expect(withSecrets).toEqual(["deploy", "preview-base"]);
    expect(textOf(jobs.deploy!)).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(textOf(jobs.deploy!)).toContain("DATABASE_URL");
    const base = jobs["preview-base"]!;
    expect(textOf(base).match(/secrets\[[^\]]*\]|secrets\.\w+/g)).toEqual(["secrets[format('{0}PREVIEW_NEON_API_KEY', matrix.prefix)]"]);
    expect(textOf(base)).not.toMatch(/CLOUDFLARE|DATABASE_URL|BETTER_AUTH|wrangler|ACCOUNT_PASSWORD/);
  });

  it("`preview-base` migrates the `base` branch of the preview database from the same artifact, after the checks, and is off until PREVIEWS_ENABLED", () => {
    const job = jobs["preview-base"]!;
    expect(job.if).toContain("vars.PREVIEWS_ENABLED == 'true'");
    expect(job.needs).toEqual(["plan", "build"]);
    expect(String(job.environment)).toContain("-preview");
    expect(job.container).toBeUndefined();
    expect(job.permissions).toEqual({ contents: "read" });
    const script = runs(job).join("\n");
    expect(script).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(script.indexOf("verify-bundle")).toBeGreaterThan(-1);
    expect(script.indexOf("verify-bundle")).toBeLessThan(script.indexOf("previews.ts base"));
    expect(steps(job).find((step) => step.uses?.startsWith("actions/checkout@"))?.with).toMatchObject({ ref: "${{ github.sha }}", "persist-credentials": false });
    expect(runsOn(job)).not.toContain("FACTORY_RUNNER");
  });

  it("`build` has no secrets, runs in the image, is read-only and keeps no token or cache", () => {
    const build = jobs.build!;
    expect(textOf(build)).not.toMatch(/secrets|wrangler|CLOUDFLARE|cache/i);
    expect(build.permissions).toEqual({ contents: "read", packages: "read" });
    expect(build.container?.image).toBe("${{ needs.image.outputs.image }}");
    expect(steps(build).find((step) => step.uses?.startsWith("actions/checkout@"))?.with).toMatchObject({ "persist-credentials": false });
    expect(build.strategy?.["fail-fast"]).toBe(false);
  });

  it("`deploy` is a fresh VM: no container, no FACTORY_RUNNER, read-only token, the lockfile without scripts, the artifact checked", () => {
    const job = jobs.deploy!;
    expect(String(job["runs-on"])).toBe("ubuntu-latest");
    expect(job.container).toBeUndefined();
    expect(job.permissions).toEqual({ contents: "read" });
    const script = runs(job).join("\n");
    expect(script).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(script.indexOf("verify-bundle")).toBeGreaterThan(-1);
    expect(script.indexOf("verify-bundle")).toBeLessThan(script.indexOf("wrangler deploy"));
    expect(script.indexOf("migrate")).toBeLessThan(script.indexOf("wrangler deploy"));
    expect(script).toContain("--name \"$PRODUCT\"");
    expect(job.env?.CLOUDFLARE_API_BASE_URL).toBe("https://api.cloudflare.com/client/v4");
    const checkout = steps(job).find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toMatchObject({ ref: "${{ github.sha }}", "persist-credentials": false });
  });

  it("`deploy` uses the Product's environment unless FACTORY_USE_ENVIRONMENTS is false", () => {
    expect(String(jobs.deploy!.environment)).toContain("vars.FACTORY_USE_ENVIRONMENTS != 'false'");
    expect(String(jobs.deploy!.environment)).toContain("-production");
  });

  it("`smoke` holds only the account's password, in the Product's environment, and waits for the deploy", () => {
    const text = textOf(jobs.smoke!);
    // Every `secrets` reference of the job: exactly one, the `<ID>_ACCOUNT_PASSWORD` (the email is a variable).
    expect(text.match(/secrets\[[^\]]*\]|secrets\.\w+/g)).toEqual(["secrets[format('{0}ACCOUNT_PASSWORD', matrix.prefix)]"]);
    expect(text).toContain("vars[format('{0}ACCOUNT_EMAIL', matrix.prefix)]");
    expect(text).not.toMatch(/CLOUDFLARE|DATABASE_URL|BETTER_AUTH|RESEND|wrangler|GITHUB_TOKEN|github\.token/);
    expect(String(jobs.smoke!.environment)).toBe(String(jobs.deploy!.environment));
    expect(jobs.smoke!.permissions).toEqual({ contents: "read" });
    expect(runs(jobs.smoke!).join("\n")).toContain(".factory/src/ci/smoke.ts");
  });

  it("only the build takes vars.FACTORY_RUNNER; the deploy and the smoke never run on it", () => {
    for (const id of ["plan", "deploy", "smoke"]) expect(runsOn(jobs[id]!), id).not.toContain("FACTORY_RUNNER");
  });

  it("never runs concurrent deploys of one branch into each other", () => {
    expect(deploy).toMatchObject({ concurrency: { "cancel-in-progress": false } });
  });

  it("calls wrangler from the package that depends on it, not from the root (where it is not installed)", () => {
    const script = runs(jobs.deploy!).join("\n");
    expect(script).not.toMatch(/(^|\s)pnpm exec wrangler/m);
    expect(script).toMatch(/pnpm --filter @factory\/harness exec wrangler deploy/);
    expect(JSON.parse(readFileSync(join(repo, ".factory/package.json"), "utf8")).devDependencies.wrangler).toBeDefined();
  });
});

describe.each([[WORKFLOWS_DIR]])("PR previews in %s", (dir) => {
  const { pr, workflows } = checkWorkflows(dir);
  const cleanup = workflows["factory-pr-cleanup.yml"]!;
  const jobs = pr.jobs;
  const PREVIEW_JOBS = ["preview-label", "preview-plan", "deploy", "smoke", "preview-comment"];
  const checkoutOf = (job: Job) => steps(job).find((step) => step.uses?.startsWith("actions/checkout@"));

  it("is off until PREVIEWS_ENABLED: every preview job needs the gate or tests the variable itself", () => {
    expect(jobs["preview-plan"]!.if).toContain("vars.PREVIEWS_ENABLED == 'true'");
    expect(jobs["preview-label"]!.if).toContain("vars.PREVIEWS_ENABLED == 'true'");
    expect(jobs.deploy!.needs).toEqual(["preview-plan", "build"]);
    expect(jobs.smoke!.needs).toEqual(["preview-plan", "deploy"]);
    expect(jobs["preview-comment"]!.needs).toEqual(["preview-plan", "deploy", "smoke"]);
    expect(steps(jobs.build!).filter((step) => step.name === "bundle for the preview" || step.uses?.startsWith("actions/upload-artifact@")).every((step) => JSON.stringify(step).includes("vars.PREVIEWS_ENABLED == 'true'") || JSON.stringify(step).includes("matrix.kind == 'product'"))).toBe(true);
  });

  it("only the preview `deploy` holds the Cloudflare and Neon preview secrets; nothing else in the PR workflow holds one", () => {
    const withSecrets = Object.entries(jobs).filter(([, job]) => /secrets[.[]/.test(textOf(job))).map(([id]) => id);
    expect(withSecrets).toEqual(["deploy"]);
    const text = textOf(jobs.deploy!);
    expect(text.match(/secrets\[[^\]]*\]|secrets\.\w+/g)?.sort()).toEqual(["secrets.CLOUDFLARE_ACCOUNT_ID", "secrets.CLOUDFLARE_API_TOKEN", "secrets[format('{0}PREVIEW_NEON_API_KEY', matrix.prefix)]"].sort());
    expect(Object.entries(jobs).filter(([, job]) => /CLOUDFLARE|NEON_API_KEY|wrangler/.test(textOf(job))).map(([id]) => id)).toEqual(["deploy"]);
  });

  it("`smoke` has no secret, no environment and a read-only token, and tests the URL it was handed through the environment", () => {
    const job = jobs.smoke!;
    expect(textOf(job)).not.toMatch(/secrets|CLOUDFLARE|NEON|DATABASE_URL|github\.token/);
    expect(job.environment).toBeUndefined();
    expect(job.permissions).toEqual({ contents: "read" });
    expect(runs(job).join("\n")).toContain('node .factory/src/ci/smoke.ts "$PREVIEW_URL" --preview');
    expect(runsOn(job)).not.toContain("FACTORY_RUNNER");
  });

  it("`deploy` is a fresh VM on `main`: no container, a read-only token, the lockfile without scripts, the artifact checked first", () => {
    const job = jobs.deploy!;
    expect(String(job["runs-on"])).toBe("ubuntu-latest");
    expect(job.container).toBeUndefined();
    expect(job.permissions).toEqual({ contents: "read" });
    expect(checkoutOf(job)?.with).toMatchObject({ ref: "${{ github.sha }}", "persist-credentials": false });
    const script = runs(job).join("\n");
    expect(script).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    const order = ["verify-bundle", "previews.ts bindings", "previews.ts database", "previews.ts config", "deploy.ts migrate", "wrangler preview"].map((word) => script.indexOf(word));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(job.env?.CLOUDFLARE_API_BASE_URL).toBe("https://api.cloudflare.com/client/v4");
    expect(String(job.environment)).toContain("vars.FACTORY_USE_ENVIRONMENTS != 'false'");
    expect(String(job.environment)).toContain("-preview");
  });

  it("`deploy` runs the preview with `main`'s config path and wrangler, from the package that depends on it, named for the PR from the event", () => {
    const job = jobs.deploy!;
    const script = runs(job).join("\n");
    expect(script).not.toMatch(/(^|\s)pnpm exec wrangler/m);
    expect(script).toMatch(/pnpm --filter @factory\/harness exec wrangler preview --config "\$WRANGLER_CONFIG" --name "pr-\$PR_NUMBER" --worker-name "\$PRODUCT" --secrets-file/);
    expect(script).toContain("--ignore-base-config");
    expect(job.env?.PR_NUMBER).toBe("${{ github.event.pull_request.number }}");
    expect(steps(job).find((step) => step.name === "wrangler preview")?.env?.WRANGLER_CONFIG).toBe("${{ steps.config.outputs.path }}");
    // The artifact is extracted outside the checkout, in the runner's temp folder.
    expect(JSON.stringify(steps(job).find((step) => step.uses?.startsWith("actions/download-artifact@")))).toContain("runner.temp");
  });

  it("no `run` script of the PR workflows interpolates an expression: everything goes through `env`", () => {
    for (const [file, workflow] of [["factory-pr.yml", pr], ["factory-pr-cleanup.yml", cleanup]] as const) {
      for (const [id, job] of Object.entries(workflow.jobs)) {
        for (const script of runs(job)) expect(script, `${file} ${id}`).not.toContain("${{");
      }
    }
  });

  it("no preview job checks out or runs the PR's head: the checkout is `main`'s and the PR's number comes from the event", () => {
    for (const id of PREVIEW_JOBS.filter((job) => jobs[job]!.steps?.some((step) => step.uses?.startsWith("actions/checkout@")))) {
      expect(checkoutOf(jobs[id]!)?.with?.ref, id).toBe("${{ github.sha }}");
    }
    for (const id of PREVIEW_JOBS) expect(textOf(jobs[id]!), id).not.toMatch(/pull_request\.head\.(ref|repo)|pull_request\.(title|body)|head_ref/);
  });

  it("labels and permissions are minimal: only the label job and the comment job may write, and only pull requests", () => {
    expect(pr.on).toMatchObject({ pull_request_target: { types: ["opened", "synchronize", "reopened", "ready_for_review", "labeled"] } });
    for (const id of PREVIEW_JOBS) {
      const writes = Object.entries(jobs[id]!.permissions ?? {}).filter(([, level]) => level === "write");
      expect(writes, id).toEqual(id === "preview-label" || id === "preview-comment" ? [["pull-requests", "write"]] : []);
    }
    const label = jobs["preview-label"]!;
    expect(label.if).toContain("github.event.action == 'synchronize'");
    expect(label.steps?.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(false);
    expect(runs(label).join("\n")).toContain("--method DELETE");
    expect(JSON.stringify(label)).toContain("vars.FACTORY_LABELS_PREVIEW || 'preview'");
  });

  it("a label event has its own concurrency group, so it never cancels a push's run", () => {
    expect(String((pr as unknown as { concurrency: { group: string } }).concurrency.group)).toContain("github.event.action == 'labeled'");
  });

  it("the comment job edits one comment through the previews script, with the token of the run", () => {
    const job = jobs["preview-comment"]!;
    expect(job.if).toContain("always()");
    expect(runs(job).join("\n")).toContain("previews.ts comment");
    expect(JSON.stringify(job)).toContain("github.token");
    expect(JSON.stringify(job)).not.toMatch(/secrets[.[]/);
  });

  it("the cleanup runs on `closed` only, from `main`, and deletes the Worker Preview and the Neon branch", () => {
    expect(cleanup.on).toEqual({ pull_request_target: { types: ["closed"] } });
    expect(cleanup.permissions).toEqual({});
    expect(cleanup.jobs.plan!.if).toContain("vars.PREVIEWS_ENABLED == 'true'");
    const job = cleanup.jobs.cleanup!;
    const script = runs(job).join("\n");
    expect(script).toMatch(/pnpm --filter @factory\/harness exec wrangler preview delete --name "pr-\$PR_NUMBER" --worker-name "\$PRODUCT" --skip-confirmation/);
    expect(script).toContain("previews.ts cleanup");
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job.env?.CLOUDFLARE_API_BASE_URL).toBe("https://api.cloudflare.com/client/v4");
    for (const j of Object.values(cleanup.jobs)) {
      expect(steps(j).find((step) => step.uses?.startsWith("actions/checkout@"))?.with).toMatchObject({ ref: "${{ github.sha }}", "persist-credentials": false });
      expect(textOf(j)).not.toMatch(/pull_request\.head/);
    }
    expect(Object.entries(cleanup.jobs).filter(([, j]) => /secrets[.[]/.test(textOf(j))).map(([id]) => id)).toEqual(["cleanup"]);
  });

  it("every preview step the YAML calls exists as a subcommand of the previews script", () => {
    const source = readFileSync(join(repo, ".factory/src/ci/previews.ts"), "utf8");
    const called = new Set<string>();
    for (const workflow of [pr, cleanup, checkWorkflows(dir).deploy]) {
      for (const job of Object.values(workflow.jobs)) for (const script of runs(job)) for (const m of script.matchAll(/previews\.ts (\S+)/g)) called.add(m[1]!);
    }
    expect([...called].sort()).toEqual(["base", "bindings", "cleanup", "cleanup-plan", "comment", "config", "database", "gate", "result", "smoke-result", "status", "url"]);
    for (const command of called) expect(source, command).toContain(`command === "${command}"`);
  });
});

describe.each([[WORKFLOWS_DIR]])("binaries the workflows in %s run", (dir) => {
  const { allJobs } = checkWorkflows(dir);
  // `pnpm exec <bin>` at the root only finds binaries the root package depends on: a bin of a workspace
  // package must be run with `pnpm --filter <package> exec <bin>`.
  it("every root `pnpm exec <bin>` is a dependency of the root package", () => {
    const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    const rootDeps = new Set(Object.keys({ ...root.dependencies, ...root.devDependencies }));
    const offenders: string[] = [];
    for (const { file, id, job } of allJobs) {
      for (const line of runs(job).join("\n").split("\n")) {
        const match = /(?:^|[\s;&|(])pnpm exec ([\w@/.-]+)/.exec(line);
        if (match && !rootDeps.has(match[1]!)) offenders.push(`${file} ${id}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe.each([[WORKFLOWS_DIR]])("Factory issue workflow in %s", (dir) => {
  const { workflows } = checkWorkflows(dir);
  const issue = workflows["factory-issue.yml"]!;
  const { claim, work, publish } = issue.jobs;
  const checkoutOf = (job: Job) => steps(job).find((step) => step.uses?.startsWith("actions/checkout@"));
  /** Every `secrets.X` / `secrets[...]` a job mentions. */
  const secretsOf = (job: Job) => [...new Set(textOf(job).match(/secrets\.\w+|secrets\[[^\]]*\]/g) ?? [])].sort();

  it("starts on the label event and by hand, is off until FACTORY_ENABLED and runs one issue at a time", () => {
    expect(Object.keys(issue.on).sort()).toEqual(["issues", "workflow_dispatch"]);
    expect(issue.on.issues).toEqual({ types: ["labeled"] });
    expect(issue.permissions).toEqual({});
    expect(claim!.if).toContain("vars.FACTORY_ENABLED == 'true'");
    expect(Object.keys(issue.jobs)).toEqual(["claim", "image", "work", "publish", "notify"]);
    expect(issue.jobs.image!.needs).toBe("claim");
    expect(work!.needs).toEqual(["claim", "image"]);
    expect(publish!.needs).toEqual(["claim", "work"]);
    expect(issue).toMatchObject({ concurrency: { "cancel-in-progress": false, queue: "max" } });
    expect(String((issue as unknown as { concurrency: { group: string } }).concurrency.group)).toMatch(/^factory-\$\{\{ github\.event\.issue\.number \|\| inputs\.issue \}\}$/);
  });

  it("`work` never receives FACTORY_TOKEN and holds only Claude's auth", () => {
    expect(textOf(work!)).not.toContain("FACTORY_TOKEN");
    expect(secretsOf(work!)).toEqual(["secrets.ANTHROPIC_API_KEY", "secrets.CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(textOf(work!)).not.toMatch(/GH_TOKEN|CLOUDFLARE|NEON|RESEND/);
  });

  it("`work` runs only in the image, read-only, without keeping the checkout token, for at most 350 minutes", () => {
    expect(work!.container?.image).toBe("${{ needs.image.outputs.image }}");
    expect(work!["runs-on"]).toBe("${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}");
    expect(work!.permissions).toEqual({ contents: "read", issues: "read", packages: "read" });
    expect(checkoutOf(work!)?.with).toMatchObject({ "persist-credentials": false });
    expect(work!["timeout-minutes"]).toBe(350);
    expect(work!.defaults?.run?.shell).toBe("bash");
    expect(Object.keys(work!.services ?? {})).toEqual(["postgres"]);
    expect(work!.if).toContain("needs.claim.outputs.claimed == 'true'");
  });

  it("`claim` writes with the job token and nothing else, on a fresh VM, never on FACTORY_RUNNER", () => {
    expect(claim!["runs-on"]).toBe("ubuntu-latest");
    expect(claim!.container).toBeUndefined();
    // `actions: write` dispatches factory-triage.yml after a missing-seams refusal: the job token's label swap starts none.
    expect(claim!.permissions).toEqual({ contents: "read", issues: "write", "pull-requests": "read", actions: "write" });
    expect(secretsOf(claim!)).toEqual([]);
    expect(textOf(claim!)).not.toContain("FACTORY_TOKEN");
    expect(runs(claim!).join("\n")).toContain("pnpm factory claim");
    expect(checkoutOf(claim!)?.with).toMatchObject({ "persist-credentials": false });
  });

  it("`publish` is a fresh VM with the owner's token, the harness from the default branch, and runs even when `work` failed", () => {
    expect(publish!["runs-on"]).toBe("ubuntu-latest");
    expect(publish!.container).toBeUndefined();
    expect(publish!.if).toContain("always()");
    expect(publish!.if).toContain("needs.claim.outputs.claimed == 'true'");
    expect(secretsOf(publish!)).toEqual(["secrets.FACTORY_TOKEN"]);
    expect(publish!.permissions).toEqual({ contents: "read" });
    expect(checkoutOf(publish!)?.with).toMatchObject({ ref: "${{ github.event.repository.default_branch }}", "persist-credentials": false });
    expect(runs(publish!).join("\n")).toContain("pnpm factory publish");
    expect(publish!["timeout-minutes"]!).toBeLessThan(60);
  });

  it("the jobs hand over the branch bundle, result.json and prints as one artifact kept 14 days", () => {
    const upload = steps(work!).find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    const download = steps(publish!).find((step) => step.uses?.startsWith("actions/download-artifact@"));
    expect(upload?.with).toMatchObject({ name: "work-out", "retention-days": 14 });
    expect(upload?.if).toBe("always()");
    expect(download?.with).toMatchObject({ name: "work-out" });
    expect(download?.["continue-on-error"]).toBe(true);
    expect(runs(work!).join("\n")).toMatch(/pnpm factory work "\$ISSUE" --out/);
    expect(runs(publish!).join("\n")).toMatch(/--in /);
  });

  it("only `claim` may dispatch a workflow", () => {
    const dispatchers = Object.entries(issue.jobs).filter(([, job]) => (job.permissions as Record<string, string> | undefined)?.actions === "write");
    expect(dispatchers.map(([id]) => id)).toEqual(["claim"]);
  });

  it("the issue number and the actor never reach a script by interpolation", () => {
    for (const [id, job] of Object.entries(issue.jobs)) for (const script of runs(job)) expect(script, id).not.toContain("${{");
  });

  it("`notify` is the Merge Gate notice: it leaves through the job's GITHUB_TOKEN, never FACTORY_TOKEN, only after `publish`", () => {
    const notify = issue.jobs.notify!;
    expect(notify.needs).toEqual(["claim", "publish"]);
    expect(notify.if).toContain("needs.publish.outputs.outcome == 'ready'");
    expect(notify.if).toContain("needs.publish.outputs.outcome == 'escalated'");
    expect(notify.permissions).toEqual({ contents: "read", issues: "write" });
    expect(secretsOf(notify)).toEqual([]);
    expect(textOf(notify)).not.toContain("FACTORY_TOKEN");
    expect(steps(notify).find((step) => step.name === "notify")?.env?.GITHUB_TOKEN).toBe("${{ github.token }}");
    expect(runs(notify).join("\n")).toContain('pnpm factory notify "$ISSUE" --outcome "$OUTCOME" --url "$PR_URL" --to "$REQUESTER"');
    expect(steps(notify).find((step) => step.name === "notify")?.env?.REQUESTER).toBe("${{ needs.claim.outputs.requester }}");
    expect(publish!.permissions).toEqual({ contents: "read" });
  });

  it("every Factory command the YAML runs exists in the CLI", () => {
    const cli = readFileSync(join(repo, ".factory/src/cli.ts"), "utf8");
    const called = new Set<string>();
    for (const job of Object.values(issue.jobs)) for (const script of runs(job)) for (const m of script.matchAll(/pnpm factory (\w+)/g)) called.add(m[1]!);
    expect([...called].sort()).toEqual(["claim", "notify", "publish", "work"]);
    for (const command of called) expect(cli).toContain(`"${command}"`);
  });
});

describe.each([[WORKFLOWS_DIR]])("Factory triage and unblock workflows in %s", (dir) => {
  const { workflows } = checkWorkflows(dir);
  const triage = workflows["factory-triage.yml"]!;
  const unblock = workflows["factory-unblock.yml"]!;
  const { image, work, apply } = triage.jobs;
  const sweep = unblock.jobs.sweep!;
  const secretsOf = (job: Job) => [...new Set(textOf(job).match(/secrets\.\w+|secrets\[[^\]]*\]/g) ?? [])].sort();
  const concurrencyOf = (w: Workflow) => (w as unknown as { concurrency: { group: string; "cancel-in-progress": boolean } }).concurrency;

  it("triage starts on the label event and by hand, is off until FACTORY_ENABLED, with one global group that never cancels", () => {
    expect(triage.on.issues).toEqual({ types: ["labeled"] });
    expect(Object.keys(triage.on).sort()).toEqual(["issues", "workflow_dispatch"]);
    expect(triage.permissions).toEqual({});
    expect(image!.if).toContain("vars.FACTORY_ENABLED == 'true'");
    expect(image!.if).toContain("agent:explore");
    expect(Object.keys(triage.jobs)).toEqual(["image", "work", "apply"]);
    expect(work!.needs).toBe("image");
    expect(apply!.needs).toBe("work");
    expect(concurrencyOf(triage)).toEqual({ group: "factory-triage", "cancel-in-progress": false });
  });

  it("triage `work` never gets FACTORY_TOKEN, only Claude's auth, runs in the image read-only and may take FACTORY_RUNNER", () => {
    expect(textOf(work!)).not.toContain("FACTORY_TOKEN");
    expect(secretsOf(work!)).toEqual(["secrets.ANTHROPIC_API_KEY", "secrets.CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(work!.container?.image).toBe("${{ needs.image.outputs.image }}");
    expect(work!["runs-on"]).toBe("${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}");
    expect(work!.permissions).toEqual({ contents: "read", issues: "read", packages: "read" });
    expect(steps(work!).find((step) => step.uses?.startsWith("actions/checkout@"))?.with).toMatchObject({ "persist-credentials": false });
    expect(runs(work!).join("\n")).toMatch(/pnpm factory triage --out/);
  });

  it("triage `apply` is a fresh VM with the owner's token and the default branch's harness; the agent is nowhere near it", () => {
    expect(apply!["runs-on"]).toBe("ubuntu-latest");
    expect(apply!.container).toBeUndefined();
    expect(apply!.permissions).toEqual({ contents: "read" });
    expect(secretsOf(apply!)).toEqual(["secrets.FACTORY_TOKEN"]);
    expect(textOf(apply!)).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY/);
    expect(runs(apply!).join("\n")).toContain("pnpm factory apply");
    expect(runs(apply!).join("\n")).toContain("--filter @factory/harness");
  });

  it("the jobs meet only through the triage-out artifact", () => {
    const upload = steps(work!).find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    const download = steps(apply!).find((step) => step.uses?.startsWith("actions/download-artifact@"));
    expect(upload?.with).toMatchObject({ name: "triage-out", "retention-days": 14 });
    expect(download?.with).toMatchObject({ name: "triage-out" });
  });

  it("unblock starts when an issue closes and by hand, with no cron, off until FACTORY_ENABLED", () => {
    expect(unblock.on.issues).toEqual({ types: ["closed"] });
    expect(Object.keys(unblock.on).sort()).toEqual(["issues", "workflow_dispatch"]);
    expect(sweep.if).toContain("vars.FACTORY_ENABLED == 'true'");
    expect(unblock.permissions).toEqual({});
    expect(concurrencyOf(unblock)).toEqual({ group: "factory-unblock", "cancel-in-progress": false });
    expect(runs(sweep).join("\n")).toContain("pnpm factory unblock");
  });

  it("unblock holds no secret, never takes FACTORY_RUNNER and dispatches with the job token", () => {
    expect(secretsOf(sweep)).toEqual([]);
    expect(runsOn(sweep)).toBe('"ubuntu-latest"');
    expect(sweep.container).toBeUndefined();
    expect(sweep.permissions).toEqual({ contents: "read", issues: "write", "pull-requests": "read", actions: "write" });
  });

  it("unblock releases in-progress from the issue that closed, taking only its number from the event, through an env var", () => {
    const step = steps(sweep).find((s) => s.name === "unblock")!;
    expect(step.env).toMatchObject({ CLOSED_ISSUE: "${{ github.event.issue.number }}" });
    expect(step.run).toContain('--issue "$CLOSED_ISSUE"');
    expect(step.run).not.toContain("${{");
  });

  it("nothing interpolates an expression into a script, and every command the YAML runs exists in the CLI", () => {
    const cli = readFileSync(join(repo, ".factory/src/cli.ts"), "utf8");
    const called = new Set<string>();
    for (const job of [...Object.values(triage.jobs), ...Object.values(unblock.jobs)]) {
      for (const script of runs(job)) {
        expect(script).not.toContain("${{");
        for (const m of script.matchAll(/pnpm factory (\w+)/g)) called.add(m[1]!);
      }
    }
    expect([...called].sort()).toEqual(["apply", "triage", "unblock"]);
    for (const command of called) expect(cli).toContain(`"${command}"`);
  });
});

describe.each([[WORKFLOWS_DIR]])("Factory retro workflow in %s", (dir) => {
  const { workflows } = checkWorkflows(dir);
  const retro = workflows["factory-retro.yml"]!;
  const { collect, image, work, publish } = retro.jobs;
  const secretsOf = (job: Job) => [...new Set(textOf(job).match(/secrets\.\w+|secrets\[[^\]]*\]/g) ?? [])].sort();
  const checkouts = (job: Job) => steps(job).filter((step) => step.uses?.startsWith("actions/checkout@"));

  it("starts when a PR closes and by hand (the Escalation dispatches it), off until FACTORY_ENABLED and with FACTORY_RETRO_ENABLED=false", () => {
    expect(retro.on.pull_request_target).toEqual({ types: ["closed"] });
    expect(Object.keys(retro.on).sort()).toEqual(["pull_request_target", "workflow_dispatch"]);
    expect(retro.permissions).toEqual({});
    expect(Object.keys(retro.jobs)).toEqual(["collect", "image", "work", "publish"]);
    expect(collect!.if).toContain("vars.FACTORY_ENABLED == 'true'");
    expect(collect!.if).toContain("vars.FACTORY_RETRO_ENABLED != 'false'");
  });

  it("a closed PR counts only on a Factory branch of this repository", () => {
    expect(collect!.if).toContain("startsWith(github.event.pull_request.head.ref, 'factory/issue-')");
    expect(collect!.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  });

  it("never runs the PR's code: every job checks out the default branch without keeping the token", () => {
    for (const [id, job] of Object.entries(retro.jobs)) {
      for (const step of checkouts(job)) {
        expect(step.with?.ref, id).toBe("${{ github.event.repository.default_branch }}");
        expect(step.with?.["persist-credentials"], id).toBe(false);
      }
    }
    expect(image!.with).toEqual({ ref: "${{ github.event.repository.default_branch }}" });
  });

  it("`collect` is read-only and holds no secret; the rest waits for what it collected", () => {
    expect(collect!.permissions).toEqual({ contents: "read", issues: "read", "pull-requests": "read", actions: "read" });
    expect(secretsOf(collect!)).toEqual([]);
    expect(runsOn(collect!)).toBe('"ubuntu-latest"');
    expect(runs(collect!).join("\n")).toContain("pnpm factory retro-collect");
    expect(image!.if).toBe("${{ needs.collect.outputs.collected == 'true' }}");
    expect(work!.needs).toEqual(["collect", "image"]);
    expect(publish!.needs).toBe("work");
  });

  it("`work` never gets FACTORY_TOKEN, only Claude's auth, runs in the image read-only and may take FACTORY_RUNNER", () => {
    expect(textOf(work!)).not.toContain("FACTORY_TOKEN");
    expect(secretsOf(work!)).toEqual(["secrets.ANTHROPIC_API_KEY", "secrets.CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(work!.container?.image).toBe("${{ needs.image.outputs.image }}");
    expect(work!["runs-on"]).toBe("${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}");
    expect(work!.permissions).toEqual({ contents: "read", packages: "read" });
    expect(runs(work!).join("\n")).toMatch(/pnpm factory retro --in/);
  });

  it("`publish` is a fresh VM with the owner's token and the default branch's harness; the agent is nowhere near it", () => {
    expect(publish!["runs-on"]).toBe("ubuntu-latest");
    expect(publish!.container).toBeUndefined();
    expect(publish!.permissions).toEqual({ contents: "read" });
    expect(secretsOf(publish!)).toEqual(["secrets.FACTORY_TOKEN"]);
    expect(textOf(publish!)).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY/);
    expect(runs(publish!).join("\n")).toContain("pnpm factory retro-publish");
    expect(runs(publish!).join("\n")).toContain("--filter @factory/harness");
  });

  it("the jobs meet only through the retro-in and retro-out artifacts", () => {
    const upload = (job: Job) => steps(job).find((step) => step.uses?.startsWith("actions/upload-artifact@"))?.with;
    const download = (job: Job) => steps(job).find((step) => step.uses?.startsWith("actions/download-artifact@"))?.with;
    expect(upload(collect!)).toMatchObject({ name: "retro-in", "retention-days": 14 });
    expect(download(work!)).toMatchObject({ name: "retro-in" });
    expect(upload(work!)).toMatchObject({ name: "retro-out", "retention-days": 14 });
    expect(download(publish!)).toMatchObject({ name: "retro-out" });
  });

  it("nothing interpolates an expression into a script, and every command the YAML runs exists in the CLI", () => {
    const cli = readFileSync(join(repo, ".factory/src/cli.ts"), "utf8");
    const called = new Set<string>();
    for (const job of Object.values(retro.jobs)) {
      for (const script of runs(job)) {
        expect(script).not.toContain("${{");
        for (const m of script.matchAll(/pnpm factory ([\w-]+)/g)) called.add(m[1]!);
      }
    }
    expect([...called].sort()).toEqual(["retro", "retro-collect", "retro-publish"]);
    for (const command of called) expect(cli).toContain(`"${command}"`);
  });

  it("the Factory workflows put `#N` in their run titles, which is how the Retro finds an issue's runs", () => {
    const runName = (file: string) => (workflows[file] as unknown as { "run-name"?: string })["run-name"] ?? "";
    expect(runName("factory-issue.yml")).toContain("#${{ github.event.issue.number || inputs.issue }}");
    expect(runName("factory-update-branches.yml")).toContain("format('#{0} update branch', inputs.issue)");
  });
});

describe.each([[WORKFLOWS_DIR]])("skills update workflow in %s", (dir) => {
  const { workflows } = checkWorkflows(dir);
  const update = workflows["factory-skills-update.yml"]!;
  const { fetch, publish } = update.jobs;
  const secretsOf = (job: Job) => [...new Set(textOf(job).match(/secrets\.\w+|secrets\[[^\]]*\]/g) ?? [])].sort();

  it("runs on pushes to the default branch, daily and by hand, off until FACTORY_ENABLED", () => {
    expect(Object.keys(update.on).sort()).toEqual(["push", "schedule", "workflow_dispatch"]);
    expect(update.on.push).toEqual({ branches: ["main"] });
    expect(update.permissions).toEqual({});
    expect(fetch!.if).toContain("vars.FACTORY_ENABLED == 'true'");
    expect(publish!.needs).toBe("fetch");
    expect(publish!.if).toBe("${{ needs.fetch.outputs.changed == 'true' }}");
  });

  it("the third-party CLI runs only in `fetch`, which holds no secret and cannot write", () => {
    expect(secretsOf(fetch!)).toEqual([]);
    expect(fetch!.permissions).toEqual({ contents: "read" });
    expect(runs(fetch!).join("\n")).toMatch(/skills@\d+\.\d+\.\d+ experimental_install/);
    expect(runs(publish!).join("\n")).not.toContain("npx");
    expect(runs(publish!).join("\n")).not.toContain("pnpm install");
  });

  it("`publish` holds only FACTORY_TOKEN, on a fresh VM with the default branch's harness", () => {
    expect(secretsOf(publish!)).toEqual(["secrets.FACTORY_TOKEN"]);
    expect(publish!.permissions).toEqual({ contents: "read" });
    expect(publish!.container).toBeUndefined();
    expect(runsOn(publish!)).toBe('"ubuntu-latest"');
    for (const job of [fetch!, publish!]) {
      const checkout = steps(job).find((s) => s.uses?.startsWith("actions/checkout@"));
      expect(checkout?.with).toMatchObject({ ref: "${{ github.event.repository.default_branch }}", "persist-credentials": false });
      for (const script of runs(job)) expect(script).not.toContain("${{");
    }
    expect(runs(publish!).join("\n")).toContain('node .factory/src/ci/skills.ts publish --in "$RUNNER_TEMP/skills"');
  });
});

describe("workflow files", () => {
  // A ` #` in an unquoted YAML value starts a comment: the parser silently cuts the line, and GitHub then refuses the
  // workflow ("The expression is not closed"). Checked on the raw text, since the parsed value is already cut.
  it("every `${{` in a workflow is closed on the same line", () => {
    for (const name of readdirSync(join(repo, WORKFLOWS_DIR)).filter((f) => f.endsWith(".yml"))) {
      const doc = parse(readFileSync(join(repo, WORKFLOWS_DIR, name), "utf8"));
      const values: string[] = [];
      const walk = (node: unknown) => {
        if (typeof node === "string") values.push(node);
        else if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
      };
      walk(doc);
      for (const value of values) {
        const opened = value.split("${{").length - 1;
        const closed = value.split("}}").length - 1;
        expect(closed, `${name}: ${value}`).toBeGreaterThanOrEqual(opened);
      }
    }
  });

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

describe.each([["factory-pr-feedback.yml", "pr-feedback"], ["factory-update-branches.yml", "update-branch"]] as const)("PR flow workflow %s", (file, flow) => {
  const workflow = checkWorkflows(WORKFLOWS_DIR).workflows[file]!;
  const { claim, work, publish } = workflow.jobs;
  const secretsOf = (job: Job) => [...new Set(textOf(job).match(/secrets\.\w+|secrets\[[^\]]*\]/g) ?? [])].sort();
  const concurrencyOf = (job: Job) => (job as unknown as { concurrency?: { group: string; "cancel-in-progress": boolean } }).concurrency;

  it("`work` has no FACTORY_TOKEN, only Claude's auth, runs in the image and is the only job on vars.FACTORY_RUNNER", () => {
    expect(textOf(work!)).not.toContain("FACTORY_TOKEN");
    expect(secretsOf(work!)).toEqual(["secrets.ANTHROPIC_API_KEY", "secrets.CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(work!.container?.image).toBe("${{ needs.image.outputs.image }}");
    expect(work!["runs-on"]).toBe("${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}");
    // `actions: read` lets pr-feedback's `work` read the failed Actions jobs of the PR's head and their logs.
    expect(work!.permissions).toEqual({ contents: "read", issues: "read", "pull-requests": "read", packages: "read", ...(flow === "pr-feedback" ? { actions: "read" } : {}) });
    expect(work!["timeout-minutes"]).toBe(350);
    const takers = Object.entries(workflow.jobs).filter(([, job]) => runsOn(job).includes("vars.FACTORY_RUNNER"));
    expect(takers.map(([id]) => id)).toEqual(["work"]);
    const checkout = steps(work!).find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toMatchObject({ "persist-credentials": false });
  });

  it("`work` shares the issue flow's factory-N group without cancelling a running job (a PR-keyed update: factory-pr-N)", () => {
    const group = flow === "update-branch"
      ? "${{ needs.claim.outputs.issue && format('factory-{0}', needs.claim.outputs.issue) || format('factory-pr-{0}', needs.claim.outputs.pr) }}"
      : "factory-${{ needs.claim.outputs.issue }}";
    expect(concurrencyOf(work!)).toEqual({ group, "cancel-in-progress": false, queue: "max" });
  });

  it("`claim` is read-only on a fresh VM; only `publish` holds FACTORY_TOKEN, and runs even when `work` failed", () => {
    expect(claim!["runs-on"]).toBe("ubuntu-latest");
    expect(claim!.permissions).toEqual({ contents: "read", issues: "read", "pull-requests": "read" });
    expect(secretsOf(claim!)).toEqual([]);
    expect(publish!["runs-on"]).toBe("ubuntu-latest");
    expect(publish!.container).toBeUndefined();
    expect(publish!.if).toContain("always()");
    expect(secretsOf(publish!)).toEqual(["secrets.FACTORY_TOKEN"]);
    const issueArg = flow === "update-branch" ? String.raw`\$\{ISSUE:\+"\$ISSUE"\}` : String.raw`"\$ISSUE"`;
    expect(runs(publish!).join("\n")).toMatch(new RegExp(String.raw`pnpm factory publish ${issueArg} .*--pr "\$PR" --start-sha`));
    expect(runs(work!).join("\n")).toMatch(new RegExp(String.raw`pnpm factory work ${issueArg} --flow ${flow} --pr "\$PR"`));
  });

  it("is off until FACTORY_ENABLED and never interpolates event data into a script", () => {
    expect(workflow.permissions).toEqual({});
    expect(JSON.stringify(workflow.jobs)).toContain("vars.FACTORY_ENABLED == 'true'");
    for (const [id, job] of Object.entries(workflow.jobs)) for (const script of runs(job)) expect(script, id).not.toContain("${{");
  });

  it("every Factory command it runs exists in the CLI", () => {
    const cli = readFileSync(join(repo, ".factory/src/cli.ts"), "utf8");
    for (const job of Object.values(workflow.jobs)) {
      for (const script of runs(job)) for (const m of script.matchAll(/pnpm factory (\S+)/g)) expect(cli, m[1]).toContain(`"${m[1]}"`);
    }
  });
});

describe("Factory PR feedback workflow", () => {
  const feedback = checkWorkflows(WORKFLOWS_DIR).workflows["factory-pr-feedback.yml"]!;

  it("only `work` gains `actions: read` (the failed checks' logs), through the job token in the harness step alone", () => {
    const permissions = Object.fromEntries(Object.entries(feedback.jobs).map(([id, job]) => [id, job.permissions]));
    expect(permissions).toEqual({
      wait: undefined,
      claim: { contents: "read", issues: "read", "pull-requests": "read" },
      image: { contents: "read", packages: "write" },
      work: { contents: "read", issues: "read", "pull-requests": "read", packages: "read", actions: "read" },
      publish: { contents: "read" },
      notify: { contents: "read", issues: "write" },
    });
    const work = feedback.jobs.work!;
    expect(textOf(work)).not.toContain("FACTORY_TOKEN");
    expect(steps(work).find((step) => step.name === "work")?.env?.GITHUB_TOKEN).toBe("${{ github.token }}");
  });

  it("listens to submitted reviews, review comments and PR comments", () => {
    expect(feedback.on).toEqual({
      pull_request_review: { types: ["submitted"] },
      pull_request_review_comment: { types: ["created"] },
      issue_comment: { types: ["created"] },
    });
    expect(Object.keys(feedback.jobs)).toEqual(["wait", "claim", "image", "work", "publish", "notify"]);
  });

  it("`notify` tells the commenter through the job's GITHUB_TOKEN once `publish` has pushed the answers", () => {
    const notify = feedback.jobs.notify!;
    expect(notify.needs).toEqual(["claim", "publish"]);
    expect(notify.permissions).toEqual({ contents: "read", issues: "write" });
    expect(textOf(notify)).not.toContain("FACTORY_TOKEN");
    expect(steps(notify).find((step) => step.name === "notify")?.env?.GITHUB_TOKEN).toBe("${{ github.token }}");
    expect(steps(notify).find((step) => step.name === "notify")?.env?.REQUESTER).toBe("${{ github.actor }}");
    expect(runs(notify).join("\n")).toContain("pnpm factory notify");
    expect(runs(notify).join("\n")).toContain("--updated");
  });

  it("debounces: `wait` sleeps 180 s under a cancelling group per PR, a submitted review skips the sleep", () => {
    const wait = feedback.jobs.wait!;
    expect((wait as unknown as { concurrency: unknown }).concurrency).toEqual({
      group: "factory-feedback-${{ github.event.pull_request.number || github.event.issue.number }}",
      "cancel-in-progress": true,
    });
    const sleep = steps(wait).find((step) => step.run === "sleep 180");
    expect(sleep?.if).toContain("github.event_name != 'pull_request_review'");
    expect(feedback.jobs.claim!.needs).toBe("wait");
  });

  it("filters the Factory's own texts (by marker, not by author) and non-Factory branches before spending a runner", () => {
    const filter = feedback.jobs.wait!.if!;
    expect(filter).toContain("!contains(github.event.comment.body, '<!-- factory -->')");
    expect(filter).toContain("!contains(github.event.review.body, '<!-- factory -->')");
    expect(filter).not.toContain("MACHINE_USER");
    expect(filter).toContain("startsWith(github.event.pull_request.head.ref, 'factory/issue-')");
    // A Conversation comment has no head ref in its event: it goes through on being a PR's, and `claim` checks the branch.
    expect(filter).toContain("github.event_name == 'issue_comment' && github.event.issue.pull_request");
    expect(feedback.jobs.claim!.steps!.map((s) => s.run).join("\n")).toContain('pnpm factory pr-feedback --pr "$PR" --actor "$ACTOR"');
  });
});

describe("Factory update branches workflow", () => {
  const update = checkWorkflows(WORKFLOWS_DIR).workflows["factory-update-branches.yml"]!;

  it("scans on a push to main and works on one dispatched issue", () => {
    expect(Object.keys(update.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(update.on.push).toEqual({ branches: ["main"] });
    expect(Object.keys(update.jobs)).toEqual(["scan", "claim", "image", "work", "publish"]);
    expect(update.jobs.scan!.if).toContain("github.event_name == 'push'");
    expect(update.jobs.claim!.if).toContain("github.event_name == 'workflow_dispatch'");
  });

  it("`scan` dispatches with the job token and holds no secret; it may write only a fork PR's comment", () => {
    const scan = update.jobs.scan!;
    expect(scan.permissions).toEqual({ contents: "read", issues: "read", "pull-requests": "write", actions: "write" });
    expect(textOf(scan)).not.toMatch(/secrets\./);
    expect(runs(scan).join("\n")).toContain("pnpm factory update-branch --scan");
  });

  it("`scan` fetches every PR head only as data, after installing the default branch's harness without scripts", () => {
    const scan = update.jobs.scan!;
    const scripts = runs(scan);
    const install = scripts.findIndex((s) => s.includes("pnpm install"));
    const fetch = scripts.findIndex((s) => s.includes("refs/pull/*/head"));
    expect(scripts[install]).toContain("--ignore-scripts");
    expect(fetch).toBeGreaterThan(install);
    expect(steps(scan).filter((s) => s.uses?.startsWith("actions/checkout@")).map((s) => s.with?.ref)).toEqual(["${{ github.event.repository.default_branch }}"]);
  });

  it("is dispatched for one issue or one PR, and names the run `#N` or `PR #N`", () => {
    const inputs = (update.on.workflow_dispatch as { inputs: Record<string, { required: boolean }> }).inputs;
    expect(Object.keys(inputs).sort()).toEqual(["issue", "pr"]);
    expect(inputs.issue!.required).toBe(false);
    expect(inputs.pr!.required).toBe(false);
    const runName = (update as unknown as { "run-name": string })["run-name"];
    expect(runName).toContain("format('#{0} update branch', inputs.issue)");
    expect(runName).toContain("format('PR #{0} update branch', inputs.pr)");
    expect(runs(update.jobs.claim!).join("\n")).toMatch(/pnpm factory update-branch "\$ISSUE"[\s\S]*pnpm factory update-branch --pr "\$PR"/);
  });

  it("the update jobs never run a fork's code: the default branch's checkout, and only the claimed branch of this repository", () => {
    for (const id of ["claim", "work", "publish"]) {
      const job = update.jobs[id]!;
      const checkouts = steps(job).filter((s) => s.uses?.startsWith("actions/checkout@"));
      expect(checkouts.map((s) => s.with), id).toEqual([expect.objectContaining({ ref: "${{ github.event.repository.default_branch }}", "persist-credentials": false })]);
      expect(textOf(job), id).not.toMatch(/refs\/pull|head\.repo|head\.sha|head\.ref/);
    }
    const fetch = steps(update.jobs.work!).find((s) => s.run?.includes("git fetch"))!;
    expect(fetch.env?.BRANCH).toBe("${{ needs.claim.outputs.branch }}");
    expect(fetch.run).toContain('git fetch --no-tags origin "+refs/heads/$BRANCH:refs/heads/$BRANCH"');
  });
});
