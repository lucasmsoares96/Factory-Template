import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleProblems, deployConfig, deployedUrl, planDeploy, workerSecrets } from "../src/ci/deploy.ts";
import { smoke, smokeWithRetry } from "../src/ci/smoke.ts";
import { imageOutputs } from "../src/ci/image.ts";
import { buildMatrix, HARNESS_PACKAGE } from "../src/ci/matrix.ts";
import { isSkillPath, patchPaths, skillLinkProblems, skillsVerdict } from "../src/ci/skills.ts";
import { IMAGE_DIR } from "../src/local/image.ts";
import { tempDir } from "./helpers.ts";

const packages = [
  { name: "//", path: "" },
  { name: HARNESS_PACKAGE, path: ".factory" },
  { name: "@workspace/skeleton", path: "packages/skeleton" },
  { name: "example", path: "apps/example" },
];

describe("PR matrix", () => {
  it("has one entry per affected package, Products told apart, and never the root", () => {
    const matrix = buildMatrix({ affected: [packages[0]!, packages[3]!, packages[2]!], changedFiles: ["package.json"], packages });

    expect(matrix.include).toEqual([
      { name: "@workspace/skeleton", kind: "package" },
      { name: "example", kind: "product" },
    ]);
  });

  it("is empty when only docs changed", () => {
    expect(buildMatrix({ affected: [], changedFiles: ["docs/agents/mcp.md", ".scratch/x.md"], packages }).include).toEqual([]);
  });

  it("runs the harness tests when only .github/ changed, and once when .factory/ did too", () => {
    const onlyGithub = buildMatrix({ affected: [], changedFiles: [".github/workflows/factory-pr.yml"], packages });
    expect(onlyGithub.include).toEqual([{ name: HARNESS_PACKAGE, kind: "package" }]);

    const both = buildMatrix({ affected: [packages[1]!], changedFiles: [".github/workflows/a.yml", ".factory/src/cli.ts"], packages });
    expect(both.include).toEqual([{ name: HARNESS_PACKAGE, kind: "package" }]);
  });
});

describe("CI image", () => {
  async function repo() {
    const dir = await tempDir("factory-ci-image-");
    await writeFile(join(dir, ".node-version"), "24.22.0\n");
    await writeFile(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@12.14.0" }));
    await writeFile(join(dir, "pnpm-lock.yaml"), "packages:\n\n  playwright@1.64.1:\n    resolution: {}\n");
    await mkdir(join(dir, ".factory"), { recursive: true });
    await cp(IMAGE_DIR, join(dir, ".factory/image"), { recursive: true });
    return dir;
  }

  it("names the GHCR package after the repository and tags it with the hash", async () => {
    const dir = await repo();
    const out = await imageOutputs(dir, { GITHUB_REPOSITORY: "Acme/Widgets" });

    expect(out.name).toBe("ghcr.io/acme/widgets/factory");
    expect(out.tag).toMatch(/^[0-9a-f]{16}$/);
    expect(out.ref).toBe(`${out.name}:${out.tag}`);
    expect(out.buildArgs.split("\n")).toEqual(["NODE_VERSION=24.22.0", "PNPM_VERSION=12.14.0", "PLAYWRIGHT_VERSION=1.64.1", expect.stringMatching(/^CLAUDE_CODE_VERSION=\d+\.\d+\.\d+$/)]);
  });

  it("changes the tag with any input and not with the repository", async () => {
    const dir = await repo();
    const before = await imageOutputs(dir, { GITHUB_REPOSITORY: "acme/widgets" });
    expect((await imageOutputs(dir, { GITHUB_REPOSITORY: "acme/other" })).tag).toBe(before.tag);

    await writeFile(join(dir, ".node-version"), "24.23.0\n");
    expect((await imageOutputs(dir, { GITHUB_REPOSITORY: "acme/widgets" })).tag).not.toBe(before.tag);
    expect((await imageOutputs(dir, { GITHUB_REPOSITORY: "acme/widgets", FACTORY_CLAUDE_CODE_VERSION: "9.9.9" })).buildArgs).toContain("CLAUDE_CODE_VERSION=9.9.9");
  });

  it("honours FACTORY_IMAGE_NAME over the repository", async () => {
    const out = await imageOutputs(await repo(), { GITHUB_REPOSITORY: "acme/widgets", FACTORY_IMAGE_NAME: "registry.test/me/img" });
    expect(out.name).toBe("registry.test/me/img");
  });
});

describe("skill links", () => {
  async function skills(links: Record<string, string | null>) {
    const dir = await tempDir("factory-skills-");
    await mkdir(join(dir, ".claude/skills"), { recursive: true });
    for (const name of ["a", "b"]) {
      await mkdir(join(dir, ".agents/skills", name), { recursive: true });
      await writeFile(join(dir, ".agents/skills", name, "SKILL.md"), name);
    }
    for (const [name, target] of Object.entries(links)) {
      if (target === null) await mkdir(join(dir, ".claude/skills", name));
      else await symlink(target, join(dir, ".claude/skills", name));
    }
    return dir;
  }

  it("is clean when each skill has its relative symlink", async () => {
    expect(skillLinkProblems(await skills({ a: "../../.agents/skills/a", b: "../../.agents/skills/b" }))).toEqual([]);
  });

  it("reports a missing link, a copy, a wrong target and a stray link", async () => {
    const problems = skillLinkProblems(await skills({ a: null, c: "../../.agents/skills/c" }));
    expect(problems).toEqual([
      ".claude/skills/a is not a symlink",
      ".claude/skills/b is missing",
      ".claude/skills/c has no .agents/skills/c",
    ]);
    expect(skillLinkProblems(await skills({ a: "../elsewhere", b: "../../.agents/skills/b" }))).toEqual([".claude/skills/a points to ../elsewhere"]);
  });
});

describe("deploy plan (main)", () => {
  const all = [...packages];

  it("deploys the affected Products that are listed, and only them", () => {
    const plan = planDeploy({ affected: [packages[3]!], packages: all, deployProducts: "example, other", all: false });
    expect(plan.include).toEqual([{ id: "example", prefix: "EXAMPLE_" }]);
  });

  it("deploys nothing for a Product that is not listed, or when only the harness changed", () => {
    expect(planDeploy({ affected: [packages[3]!], packages: all, deployProducts: "", all: false }).include).toEqual([]);
    expect(planDeploy({ affected: [packages[1]!], packages: all, deployProducts: "example", all: false }).include).toEqual([]);
  });

  it("deploys every listed Product on a manual run, and ignores ids that are not Products", () => {
    const plan = planDeploy({ affected: [], packages: all, deployProducts: "example,../evil,ghost", all: true });
    expect(plan.include.map((e) => e.id)).toEqual(["example"]);
  });

  it("turns a dashed id into an underscored secret prefix", () => {
    const packagesWithDash = [...packages, { name: "my-app", path: "apps/my-app" }];
    expect(planDeploy({ affected: [], packages: packagesWithDash, deployProducts: "my-app", all: true }).include).toEqual([{ id: "my-app", prefix: "MY_APP_" }]);
  });
});

describe("deploy artifact", () => {
  async function artifact(files: Record<string, string>) {
    const dir = await tempDir("factory-artifact-");
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(dir, name, ".."), { recursive: true });
      await writeFile(join(dir, name), content);
    }
    return dir;
  }
  const good = {
    "worker/example/wrangler.json": "{}",
    "worker/example/index.js": "x",
    "worker/client/a.js": "x",
    "migrations/product/20260101_init/migration.sql": "select 1",
    "migrations/product/meta/_journal.json": "{}",
    "migrations/skeleton/20260101_init/migration.sql": "select 1",
    "migrations/skeleton/20260101_init/snapshot.json": "{}",
  };

  it("accepts the Worker, its assets and migrations", async () => {
    expect(bundleProblems(await artifact(good))).toEqual([]);
  });

  it("refuses files outside the allowlist, scripts among migrations, symlinks and a missing config", async () => {
    const dir = await artifact({ ...good, "evil.sh": "x", "migrations/product/run.sh": "x" });
    await symlink("/etc/passwd", join(dir, "worker/example/link"));
    const problems = bundleProblems(dir);
    expect(problems).toEqual(expect.arrayContaining(["evil.sh: outside worker, migrations", "migrations/product/run.sh: not a migration file", "worker/example/link: not a regular file or folder"]));
    expect(bundleProblems(await artifact({ "worker/index.js": "x" }))).toEqual(["worker/<name>/wrangler.json must exist exactly once"]);
  });

  it("refuses a non-migration file, a symlink or a stray folder among the migrations", async () => {
    const dir = await artifact({ ...good, "migrations/skeleton/20260101_init/run.sh": "x", "migrations/other/20260101_init/migration.sql": "select 1", "migrations/loose.sql": "select 1" });
    await symlink("/etc/passwd", join(dir, "migrations/skeleton/link.sql"));
    expect(bundleProblems(dir).sort()).toEqual([
      "migrations/loose.sql: outside migrations/product, migrations/skeleton",
      "migrations/other: outside migrations/product, migrations/skeleton",
      "migrations/skeleton/20260101_init/run.sh: not a migration file",
      "migrations/skeleton/link.sql: not a regular file or folder",
    ]);
  });
});

describe("deploy config and secrets", () => {
  it("names the Worker with the id and drops the build-time fields, keeping bindings", () => {
    const built = { name: "example", configPath: "/ci/x.jsonc", userConfigPath: "/ci/x.jsonc", main: "index.js", secrets: { required: ["X"] }, kv_namespaces: [{ binding: "OAUTH_KV" }], durable_objects: { bindings: [] } };
    expect(deployConfig(built, "shop")).toEqual({ name: "shop", main: "index.js", kv_namespaces: [{ binding: "OAUTH_KV" }], durable_objects: { bindings: [] } });
  });

  it("maps the job's env to the Worker's secrets, and requires the two it cannot run without", () => {
    expect(workerSecrets({ POOLED_DATABASE_URL: "p", AUTH_SECRET: "a" })).toEqual({ DATABASE_URL: "p", BETTER_AUTH_SECRET: "a" });
    expect(workerSecrets({ POOLED_DATABASE_URL: "p", AUTH_SECRET: "a", RESEND_KEY: "r" }).RESEND_API_KEY).toBe("r");
    expect(() => workerSecrets({ AUTH_SECRET: "a" })).toThrow(/DATABASE_URL/);
  });

  it("reads the deployed URL from wrangler's output file", () => {
    const file = [{ type: "wrangler-session", version: 1 }, { type: "deploy", targets: ["https://example.me.workers.dev"] }].map((l) => JSON.stringify(l)).join("\n");
    expect(deployedUrl(file)).toBe("https://example.me.workers.dev");
    expect(deployedUrl("")).toBeUndefined();
  });
});

describe("smoke", () => {
  const account = { email: "admin@example.com", password: "account-secret-password-9" };
  const challenge = () => new Response("", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"' } });
  interface Routes {
    health?: Response;
    mcp?: Response;
    signIn?: Response;
    me?: Response;
  }
  /** A fake Worker; `seen` records what the smoke sent. */
  function worker(routes: Routes = {}) {
    const seen: { path: string; method: string; cookie: string | null; body: string }[] = [];
    const fetchFn = (async (input: URL | string, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      seen.push({ path, method: init.method ?? "GET", cookie: new Headers(init.headers).get("cookie"), body: String(init.body ?? "") });
      const response =
        path === "/api/health" ? (routes.health ?? Response.json({ status: "ok" }))
        : path === "/mcp" ? (routes.mcp ?? challenge())
        : path === "/api/auth/sign-in/email" ? (routes.signIn ?? new Response("{}", { status: 200, headers: { "set-cookie": "session=abc; Path=/; HttpOnly" } }))
        : (routes.me ?? Response.json({ email: account.email }));
      return response;
    }) as typeof fetch;
    return { fetchFn, seen };
  }

  it("passes with a healthy Worker, a real sign-in, GET /api/me with the session cookie, and a challenged /mcp", async () => {
    const w = worker();

    expect(await smoke("https://x", { account, fetchFn: w.fetchFn })).toEqual({ ok: true, problems: [] });

    const signIn = w.seen.find((r) => r.path === "/api/auth/sign-in/email")!;
    expect(signIn.method).toBe("POST");
    expect(JSON.parse(signIn.body)).toEqual(account);
    expect(w.seen.find((r) => r.path === "/api/me")!.cookie).toBe("session=abc");
  });

  it("fails on a 500 health, an open /mcp and a 401 with no challenge", async () => {
    expect((await smoke("https://x", { account, fetchFn: worker({ health: new Response("", { status: 500 }) }).fetchFn })).problems).toEqual(["/api/health answered 500"]);
    expect((await smoke("https://x", { account, fetchFn: worker({ mcp: new Response("{}", { status: 200 }) }).fetchFn })).problems[0]).toContain("answered 200");
    expect((await smoke("https://x", { account, fetchFn: worker({ mcp: new Response("", { status: 401 }) }).fetchFn })).problems[0]).toContain("WWW-Authenticate");
  });

  it("fails when the sign-in is refused, answers no cookie, or /api/me names another user, and never prints the password", async () => {
    const refused = await smoke("https://x", { account, fetchFn: worker({ signIn: Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }) }).fetchFn });
    expect(refused.problems).toEqual(["sign-in answered 401"]);
    const noCookie = await smoke("https://x", { account, fetchFn: worker({ signIn: new Response("{}", { status: 200 }) }).fetchFn });
    expect(noCookie.problems).toEqual(["sign-in answered no session cookie"]);
    const other = await smoke("https://x", { account, fetchFn: worker({ me: Response.json({ email: "someone@else.com" }) }).fetchFn });
    expect(other.problems).toEqual(["/api/me answered another user than the account"]);
    const down = await smoke("https://x", { account, fetchFn: worker({ me: new Response("", { status: 500 }) }).fetchFn });
    expect(down.problems).toEqual(["/api/me answered 500"]);
    expect(JSON.stringify([refused, noCookie, other, down])).not.toContain(account.password);
  });

  it("fails, saying what to run, when the account is not configured", async () => {
    const result = await smoke("https://x", { account: undefined, fetchFn: worker().fetchFn });
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain("pnpm bootstrap product");
  });

  it("retries while the deploy propagates, then gives up with the last problem", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      throw new Error("connect refused");
    }) as typeof fetch;
    const result = await smokeWithRetry("https://x", { account, attempts: 3, waitMs: 1, fetchFn: flaky, sleep: async () => {} });
    expect(result).toEqual({ ok: false, problems: ["connect refused"] });
    expect(calls).toBe(3);
  });
});

describe("skills follow upstream (ADR 0013)", () => {
  it("passes when the restore changes nothing", () => {
    expect(skillsVerdict({ restored: [], prChanged: ["src/a.ts"] })).toEqual({ ok: true, notice: null });
  });

  it("an upstream change the PR did not make is a notice, never a failure", () => {
    const verdict = skillsVerdict({ restored: [".agents/skills/tdd/SKILL.md", "skills-lock.json"], prChanged: ["apps/example/src/x.ts"] });
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.ok && verdict.notice).toMatch(/factory-skills-update\.yml/);
  });

  it("a PR that edits a skill or the lock must commit exactly what the restore gives", () => {
    expect(skillsVerdict({ restored: [".agents/skills/tdd/SKILL.md"], prChanged: [".agents/skills/tdd/SKILL.md"] })).toMatchObject({ ok: false });
    expect(skillsVerdict({ restored: [".agents/skills/tdd/SKILL.md"], prChanged: ["skills-lock.json"] })).toMatchObject({ ok: false });
    expect(skillsVerdict({ restored: [], prChanged: [".agents/skills/tdd/SKILL.md"] })).toEqual({ ok: true, notice: null });
  });

  it("a restore that writes outside the skills fails", () => {
    expect(skillsVerdict({ restored: ["package.json"], prChanged: [] })).toMatchObject({ ok: false });
  });

  it("only `.agents/skills/` and the lock are skill paths", () => {
    expect([".agents/skills/a/SKILL.md", "skills-lock.json"].every(isSkillPath)).toBe(true);
    expect([".agents/skillsX", ".claude/skills/a", ".github/workflows/x.yml", "skills-lock.json.bak"].some(isSkillPath)).toBe(false);
  });

  it("reads every path a patch touches, so the publish job can refuse one outside the skills", () => {
    const patch = ["diff --git a/.agents/skills/a/SKILL.md b/.agents/skills/a/SKILL.md", "--- a/x", "+++ b/x", "diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml"].join("\n");
    expect(patchPaths(patch).sort()).toEqual([".agents/skills/a/SKILL.md", ".github/workflows/x.yml"]);
  });
});
