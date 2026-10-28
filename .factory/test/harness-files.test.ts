import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { isHarnessPath } from "../src/paths.ts";

// Seam 2: the harness files are read as data and checked against the config.
const repo = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(join(repo, file)));

const FACTORY_DOCS = ["docs/factory-flows.md", "docs/factory-bootstrap.md"];
const AGENTS_FILES = ["AGENTS.md", "packages/skeleton/AGENTS.md", "packages/skeleton/template/AGENTS.md", ".factory/AGENTS.md", "apps/example/AGENTS.md"];

describe("AGENTS.md", () => {
  it.each(AGENTS_FILES)("%s is under 200 lines", (file) => {
    expect(read(file).split("\n").length).toBeLessThan(200);
  });

  it("keeps the Factory's file to short bullets: no line over 600 characters", () => {
    const long = read(".factory/AGENTS.md").split("\n").map((line, i) => ({ line: i + 1, length: line.length })).filter((l) => l.length > 600);
    expect(long).toEqual([]);
  });

  it("points the Factory's file to the docs that hold its detail", () => {
    for (const doc of FACTORY_DOCS) {
      expect(read(".factory/AGENTS.md"), doc).toContain(`(../${doc})`);
      expect(read("docs/README.md"), doc).toContain(`\`${doc.replace("docs/", "")}\``);
    }
  });

  it("exists at every level and nowhere else but in a Product", () => {
    const found = tracked.filter((file) => file.endsWith("AGENTS.md"));
    for (const file of found) {
      expect(AGENTS_FILES.includes(file) || /^apps\/[^/]+\/AGENTS\.md$/.test(file), file).toBe(true);
    }
    expect(found).toEqual(expect.arrayContaining(AGENTS_FILES));
  });

  it("never has a CLAUDE.md, anywhere", () => {
    expect(tracked.filter((file) => /(^|\/)claude\.md$/i.test(file))).toEqual([]);
  });

  it("names no fixed repository", () => {
    for (const file of [...AGENTS_FILES, "docs/agents/issue-tracker.md", "docs/agents/triage-labels.md", "docs/agents/domain.md", "docs/agents/mcp.md", ...FACTORY_DOCS]) {
      expect(read(file), file).not.toMatch(/lucasmsoares96|Factory-Template/);
    }
  });

  it("links the root file to the glossary and lists the hard rules", () => {
    const root = read("AGENTS.md");
    expect(root).toContain("[GLOSSARY.md](GLOSSARY.md)");
    for (const rule of ["Conventional Commits", "Never create a `CLAUDE.md`", ".github/workflows/", "published migration", "official documentation", "bootstrap destroy"]) {
      expect(root).toContain(rule);
    }
    for (const heading of ["## Building a product on the Skeleton", "## Agent skills"]) expect(root).toContain(heading);
  });

  it("the Product's file is the template's output", () => {
    expect(read("apps/example/AGENTS.md")).toBe(read("packages/skeleton/template/AGENTS.md").replaceAll("{{title}}", "Example").replaceAll("{{id}}", "example"));
  });
});

describe("label tables", () => {
  const section = (heading: string) => {
    const body = read("docs/agents/triage-labels.md").split(/^## /m).find((part) => part.startsWith(heading));
    expect(body, `section "${heading}"`).toBeDefined();
    return body!;
  };
  const firstColumn = (markdown: string) =>
    [...markdown.matchAll(/^\| `([^`]+)`/gm)].map((match) => match[1]);

  it("the Factory labels table is the config's labels", () => {
    const { labels } = defaultConfig;
    expect(firstColumn(section("Factory labels"))).toEqual([labels.inProgress, labels.working, labels.agentExplore, labels.harnessChange, labels.preview, labels.retro, `${labels.productPrefix}<id>`]);
  });

  it("who sets each Factory label is stated, and `preview` is set by a human and removed by CI", () => {
    const rows = new Map([...section("Factory labels").matchAll(/^\| `([^`]+)`\s*\| ([^|]+)\|/gm)].map((m) => [m[1]!, m[2]!.trim()]));
    expect(rows.get(defaultConfig.labels.preview)).toMatch(/^a human with `write`\+ access/);
    expect(rows.get(defaultConfig.labels.preview)).toMatch(/CI removes it/);
    expect(rows.get(defaultConfig.labels.inProgress)).toMatch(/^the Factory/);
    expect(rows.get(defaultConfig.labels.agentExplore)).toMatch(/^a human/);
    expect(rows.get(defaultConfig.labels.working)).toMatch(/^the Factory/);
  });

  it("`factory:working` says when it comes off, and how it differs from `in-progress`", () => {
    const row = section("Factory labels").split("\n").find((line) => line.startsWith(`| \`${defaultConfig.labels.working}\``));
    expect(row).toMatch(/end of every run/);
    expect(row).toContain("update-branch --scan");
    expect(row).toContain(`\`${defaultConfig.labels.inProgress}\``);
  });

  it("the triage table maps the five roles to the config's labels", () => {
    const { labels } = defaultConfig;
    const rows = [...read("docs/agents/triage-labels.md").matchAll(/^\| `([^`]+)`\s*\| `([^`]+)`/gm)].map((m) => [m[1], m[2]]);
    expect(rows).toEqual([
      ["needs-triage", labels.needsTriage],
      ["needs-info", labels.needsInfo],
      ["ready-for-agent", labels.readyForAgent],
      ["ready-for-human", labels.readyForHuman],
      ["wontfix", labels.wontfix],
    ]);
  });
});

describe("skills", () => {
  const MATT = [
    "tdd", "code-review", "triage", "implement", "diagnosing-bugs", "codebase-design", "domain-modeling", "grilling", "wayfinder",
    "research", "prototype", "to-spec", "to-tickets", "setup-matt-pocock-skills", "wizard", "pr", "writing-for-agents", "handoff",
    "git-guardrails-claude-code", "retro",
  ];
  const VENDOR = ["playwright-cli", "workers-best-practices"];
  const OWN = ["skeleton-add-endpoint", "skeleton-add-migration", "skeleton-add-feature", "skeleton-evidence-test"];
  const dirs = (path: string) => readdirSync(join(repo, path)).sort();

  it("documents where /retro finds the primary sources of a run", () => {
    const doc = read("docs/agents/retro-sources.md");
    for (const source of ["stream-json", "gh run download", ".jsonl", "evidence/NN/sessions", "Escalation", "Merge Gate", "threads", "reviews"]) {
      expect(doc, source).toContain(source);
    }
  });

  it("ships exactly the decided skills", () => {
    expect(dirs(".agents/skills")).toEqual([...MATT, ...VENDOR, ...OWN].sort());
  });

  it("links every .claude/skills entry to its .agents/skills folder", () => {
    expect(dirs(".claude/skills")).toEqual(dirs(".agents/skills"));
    for (const name of dirs(".claude/skills")) {
      const path = join(repo, ".claude/skills", name);
      expect(lstatSync(path).isSymbolicLink(), name).toBe(true);
      expect(readlinkSync(path), name).toBe(`../../.agents/skills/${name}`);
      expect(existsSync(join(path, "SKILL.md")), name).toBe(true);
    }
  });

  it("pins the Matt and vendor skills in the lock, and keeps ours out", () => {
    const lock = JSON.parse(read("skills-lock.json")) as { skills: Record<string, { source: string; computedHash: string }> };
    expect(Object.keys(lock.skills).sort()).toEqual([...MATT, ...VENDOR].sort());
    for (const [name, skill] of Object.entries(lock.skills)) {
      expect(skill.computedHash, name).toMatch(/^[0-9a-f]{64}$/);
      expect(skill.source, name).toBe(VENDOR.includes(name) ? (name === "playwright-cli" ? "microsoft/playwright-cli" : "cloudflare/skills") : "mattpocock/skills");
    }
  });

  it.each(OWN)("%s has a name that matches its folder", (name) => {
    expect(read(`.agents/skills/${name}/SKILL.md`)).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---`));
  });

  it("the evidence skill says to locate by role plus the i18n key", () => {
    const text = read(".agents/skills/skeleton-evidence-test/SKILL.md");
    expect(text).toMatch(/role plus the i18n key/);
    expect(text).toContain("test-results/evidence/<product>/<name>.png");
  });
});

describe(".mcp.json", () => {
  const mcp = JSON.parse(read(".mcp.json")) as { mcpServers: Record<string, Record<string, unknown>> };

  it("has the two servers that need no secret", () => {
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["cloudflare-docs", "shadcn"]);
  });

  it("holds no credential", () => {
    const text = read(".mcp.json");
    expect(text).not.toMatch(/token|secret|key|authorization|bearer|\benv\b|headers/i);
  });

  it("documents the read-only servers as local-scope additions", () => {
    const doc = read("docs/agents/mcp.md");
    expect(doc).toMatch(/claude mcp add --scope local --transport http cloudflare-api/);
    expect(doc).toMatch(/claude mcp add --scope local --transport http neon .*readonly=true/);
  });
});

describe(".claude/settings.json", () => {
  const settings = JSON.parse(read(".claude/settings.json")) as { permissions: { deny: string[] }; [key: string]: unknown };

  it("only denies the destroy command: sensitive paths and git commands are flagged on the PR, never blocked (ADR 0012)", () => {
    expect(settings.permissions.deny).toEqual(["Bash(pnpm bootstrap destroy:*)"]);
    expect(Object.keys(settings.permissions)).toEqual(["deny"]);
    expect(Object.keys(settings).sort()).toEqual(["$schema", "permissions"]);
  });
});

describe("CODING_STANDARDS.md", () => {
  it("exists at the root with the header comment and the three empty sections", () => {
    const text = read("CODING_STANDARDS.md");
    expect(text).toMatch(/^# Coding Standards\n/);
    expect(text).toMatch(/Review/);
    expect(text).toMatch(/not (by )?(the )?Development/i);
    expect(text).toContain("/retro");
    const sections = text.split(/^## /m).slice(1);
    expect(sections.map((s) => s.split("\n")[0])).toEqual(["Style", "Testing", "Architecture"]);
    for (const section of sections) expect(section.split("\n").slice(1).join("\n").trim(), section).toBe("");
    expect(text).not.toMatch(/Example/);
  });

  it("is a harness path", () => {
    expect(isHarnessPath("CODING_STANDARDS.md")).toBe(true);
  });

  it("is not pointed to by any AGENTS.md", () => {
    for (const file of AGENTS_FILES) expect(read(file), file).not.toContain("CODING_STANDARDS");
  });
});

describe("docs/forgejo-install-prompt.md", () => {
  const prompt = () => read("docs/forgejo-install-prompt.md");

  it("exists and opens with a title", () => {
    expect(prompt()).toMatch(/^# /);
  });

  it.each([
    "`Tracker`",
    "`CodeHost`",
    "`Verify`",
    "--ephemeral",
    "one-job",
    "block_on_outdated_branch",
    "status_check_contexts",
    ".forgejo/workflows/",
    "pull_request_target",
    "write:repository",
    "`WIP:`",
    "factory-retro.yml",
    "merge_when_checks_succeed",
    "agent:explore",
    "Conversation",
    "` #`",
    "end to end",
  ])("mentions %s", (term) => {
    expect(prompt()).toContain(term);
  });

  it("leaves the Skeleton and the Products out", () => {
    const leaveOut = prompt().split("\n").find((line) => line.startsWith("Leave out:"));
    expect(leaveOut).toBeDefined();
    for (const path of ["packages/skeleton/", "apps/", ".factory/src/bootstrap/"]) expect(leaveOut).toContain(path);
  });

  it("keeps the review events that carry pull request feedback among the Forgejo events", () => {
    const workflows = prompt().split(/^## /m).find((section) => section.startsWith("2. "));
    expect(workflows).toBeDefined();
    for (const event of ["issue_comment", "pull_request_review", "pull_request_review_comment"]) {
      expect(workflows).toContain(`\`${event}\``);
    }
  });

  it("ends by driving a test issue end to end to the Merge Gate", () => {
    const last = prompt().split(/^## /m).at(-1)!;
    expect(last).toMatch(/test issue/);
    expect(last).toContain("Merge Gate");
  });

  it("is linked from docs/forgejo.md and the docs index", () => {
    expect(read("docs/forgejo.md")).toContain("(forgejo-install-prompt.md)");
    expect(read("docs/README.md")).toContain("forgejo-install-prompt.md");
  });
});

describe(".factory/image/setup.sh", () => {
  const setup = read(".factory/image/setup.sh");

  it("installs python3 with the apt packages, for agents' support scripts", () => {
    const installs = setup.match(/^apt-get install .*$/gm) ?? [];
    expect(installs, "apt-get install lines").not.toHaveLength(0);
    expect(installs.flatMap((line) => line.split(/\s+/))).toContain("python3");
  });

  it("runs python3 during the build, so a broken install fails the image", () => {
    expect(setup).toMatch(/^python3 --version$/m);
  });
});
