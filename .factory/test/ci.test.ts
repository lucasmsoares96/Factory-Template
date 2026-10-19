import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { imageOutputs } from "../src/ci/image.ts";
import { buildMatrix, HARNESS_PACKAGE } from "../src/ci/matrix.ts";
import { skillLinkProblems } from "../src/ci/skills.ts";
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
