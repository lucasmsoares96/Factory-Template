import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The self-hosted runner is the private repo owner's choice (docs/self-hosted-runner.md):
// the public template must never define it or create one.
const repo = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(join(repo, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(repo, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });
}

describe("self-hosted runner: the public template never defines or creates one", () => {
  const workflows = filesUnder(".github/workflows").filter((file) => file.endsWith(".yml"));

  it("every FACTORY_RUNNER in a workflow is read with the ubuntu-latest fallback, never given a value", () => {
    for (const file of workflows) {
      const text = read(file);
      const mentions = text.match(/FACTORY_RUNNER[^\n]*/g) ?? [];
      for (const line of mentions) expect(line, `${file}: ${line}`).toMatch(/^FACTORY_RUNNER \|\| 'ubuntu-latest' \}\}$/);
      expect(text, file).not.toMatch(/^\s*FACTORY_RUNNER\s*:/m);
    }
    expect(workflows.map(read).join("\n")).toContain("vars.FACTORY_RUNNER");
  });

  it("no config, script or bootstrap source sets FACTORY_RUNNER or registers a runner", () => {
    const sources = [...filesUnder(".factory/src"), ...filesUnder("scripts"), "docker-compose.yml", "package.json", "turbo.json"].filter((file) => /\.(ts|sh|json|ya?ml)$/.test(file));
    for (const file of sources) {
      const text = read(file);
      expect(text, file).not.toMatch(/FACTORY_RUNNER/);
      expect(text, file).not.toMatch(/generate-jitconfig|actions\/runners|config\.sh/);
    }
  });
});

describe("docs/self-hosted-runner.md", () => {
  it("exists and names the required settings", () => {
    expect(existsSync(join(repo, "docs/self-hosted-runner.md"))).toBe(true);
    const doc = read("docs/self-hosted-runner.md");
    for (const needle of ["uid 1001", "v2.329.0", "ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true", "generate-jitconfig", "--jitconfig", "vars.FACTORY_RUNNER", "FACTORY_RUNNER", "Docker Engine", "No secrets", "local network", "docker system prune", "_work", "`factory`", "postgres"]) {
      expect(doc, needle).toContain(needle);
    }
    for (const never of ["claim", "publish", "deploy", "image", "preview deploy"]) expect(doc, never).toContain(never);
  });

  it("writes no secret", () => {
    expect(read("docs/self-hosted-runner.md")).not.toMatch(/ghp_|github_pat_|AAAA[A-Za-z0-9+/]{20}/);
  });

  it("is linked from the root AGENTS.md, which stays under 200 lines", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("docs/self-hosted-runner.md");
    expect(agents.split("\n").length).toBeLessThan(200);
  });
});
