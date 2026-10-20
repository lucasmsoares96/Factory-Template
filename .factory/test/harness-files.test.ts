import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { PROTECTED_PATHS, isHarnessPath } from "../src/paths.ts";

// Seam 2: the harness files are read as data and checked against the config.
const repo = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(join(repo, file)));

const AGENTS_FILES = ["AGENTS.md", "packages/skeleton/AGENTS.md", "packages/skeleton/template/AGENTS.md", ".factory/AGENTS.md", "apps/example/AGENTS.md"];

describe("AGENTS.md", () => {
  it.each(AGENTS_FILES)("%s is under 200 lines", (file) => {
    expect(read(file).split("\n").length).toBeLessThan(200);
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
    for (const file of [...AGENTS_FILES, "docs/agents/issue-tracker.md", "docs/agents/triage-labels.md", "docs/agents/domain.md", "docs/agents/mcp.md"]) {
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
    expect(firstColumn(section("Factory labels"))).toEqual([labels.inProgress, labels.agentExplore, labels.harnessChange, labels.preview, `${labels.productPrefix}<id>`]);
  });

  it("who sets each Factory label is stated, and `preview` is set by a human and removed by CI", () => {
    const rows = new Map([...section("Factory labels").matchAll(/^\| `([^`]+)`\s*\| ([^|]+)\|/gm)].map((m) => [m[1]!, m[2]!.trim()]));
    expect(rows.get(defaultConfig.labels.preview)).toMatch(/^a human with `write`\+ access/);
    expect(rows.get(defaultConfig.labels.preview)).toMatch(/CI removes it/);
    expect(rows.get(defaultConfig.labels.inProgress)).toMatch(/^the Factory/);
    expect(rows.get(defaultConfig.labels.agentExplore)).toMatch(/^a human/);
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
    "git-guardrails-claude-code",
  ];
  const VENDOR = ["playwright-cli", "workers-best-practices"];
  const OWN = ["skeleton-add-endpoint", "skeleton-add-migration", "skeleton-add-feature", "skeleton-evidence-test"];
  const dirs = (path: string) => readdirSync(join(repo, path)).sort();

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
  const settings = JSON.parse(read(".claude/settings.json")) as {
    permissions: { deny: string[]; allow?: unknown; ask?: unknown };
    hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string }[] }[] };
    [key: string]: unknown;
  };
  const deny = settings.permissions.deny;

  // `Edit(/dir/**)` anchors at the project root and gitignore-like globs.
  const covers = (rule: string, path: string) => {
    const pattern = /^Edit\(\/(.+)\)$/.exec(rule)?.[1];
    if (!pattern) return false;
    const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "@@").replace(/\*/g, "[^/]*").replace(/@@/g, ".*")}$`);
    return regex.test(path) || regex.test(`${path.replace(/\/$/, "")}/x`);
  };

  it("denies Edit on every protected path the publish command refuses", () => {
    for (const path of PROTECTED_PATHS) {
      expect(
        deny.some((rule) => covers(rule, path)),
        `no Edit deny rule covers ${path}`,
      ).toBe(true);
    }
  });

  it("denies the destroy command", () => {
    expect(deny).toContain("Bash(pnpm bootstrap destroy:*)");
  });

  it("has no allow, ask, env or subagents", () => {
    expect(Object.keys(settings.permissions)).toEqual(["deny"]);
    expect(Object.keys(settings).sort()).toEqual(["$schema", "hooks", "permissions"]);
  });

  it("runs the git guardrails hook on Bash from the project dir", () => {
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    const entry = settings.hooks.PreToolUse[0]!;
    expect(entry.matcher).toBe("Bash");
    expect(entry.hooks).toHaveLength(1);
    const { type, command } = entry.hooks[0]!;
    expect(type).toBe("command");
    expect(command).toContain('"$CLAUDE_PROJECT_DIR/.claude/hooks/block-dangerous-git.mjs"');
    expect(() => accessSync(join(repo, ".claude/hooks/block-dangerous-git.mjs"), constants.X_OK)).not.toThrow();
  });
});

describe("git guardrails hook", () => {
  const hook = join(repo, ".claude/hooks/block-dangerous-git.mjs");
  const run = (command: string) => spawnSync("node", [hook], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });

  const BLOCKED = [
    "git push",
    "git push origin main",
    "git push --force",
    "git -C ../other push",
    "git reset --hard",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git clean -n",
    "git clean",
    "git branch -D old",
    "git branch -fd old",
    "git branch --delete --force old",
    "git checkout main",
    "git checkout origin/main",
    "git checkout -",
    "git checkout -b feature",
    "git checkout -B feature",
    "git checkout --orphan x",
    "git checkout --detach",
    "git checkout -f",
    "git checkout .",
    "git checkout -- .",
    "git checkout HEAD -- .",
    "git switch main",
    "git switch -c feature",
    "git switch -",
    "git restore .",
    "git restore --staged .",
    "cd apps/example && git push",
    "pnpm test; git push",
    "echo done | git push",
    "(git push)",
    "echo $(git push)",
    "echo `git push`",
    'bash -c "git reset --hard"',
    "sh -c 'cd x && git clean -f'",
    'eval "git push"',
    "FOO=1 git push",
    "/usr/bin/git push",
    "env GIT_TERMINAL_PROMPT=0 git push",
    "xargs -n1 git push",
    "if true; then git push; fi",
    "cat <<EOF\n$(git push)\nEOF",
    "git commit -m ok &&\n git push",
  ];

  const ALLOWED = [
    "git status",
    "git log --oneline -5",
    "git diff",
    "git diff --stat main",
    "git add -A",
    "git add .",
    "git commit -m 'feat: add notes #4'",
    'git commit -m "fix: stop running git push in tests"',
    "git commit -m \"$(cat <<'EOF'\nfix: the agent ran git push\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nEOF\n)\"",
    "git merge factory-base",
    "git merge --no-ff factory-base",
    "git worktree add ../w -b ticket-99",
    "git worktree add ../w ticket-99",
    "git worktree list",
    "git worktree remove ../w",
    "git branch",
    "git branch -d merged",
    "git branch --list",
    "git branch --show-current",
    "git branch new-name",
    "git checkout -- src/a.ts",
    "git checkout HEAD -- src/a.ts",
    "git checkout factory-base -- apps/example/drizzle/0001/migration.sql",
    "git restore src/a.ts",
    "git restore --staged src/a.ts",
    "git restore --source=HEAD~1 src/a.ts",
    "git checkout",
    "git stash",
    "git show HEAD",
    "git rebase factory-base",
    "git fetch origin",
    "git remote -v",
    "git rev-parse HEAD",
    "git -C ../w status",
    "echo git push",
    "echo 'git reset --hard' > notes.txt",
    "grep -rn 'git checkout main' docs",
    "pnpm factory:verify",
    "ls -la",
    "# git push",
  ];

  it.each(BLOCKED)("blocks %j (exit 2, with a message)", (command) => {
    const result = run(command);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("BLOCKED");
  });

  it.each(ALLOWED)("allows %j (exit 0)", (command) => {
    const result = run(command);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("ignores input that is not a Bash command", () => {
    expect(spawnSync("node", [hook], { input: "not json", encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("node", [hook], { input: JSON.stringify({ tool_input: { file_path: "a" } }), encoding: "utf8" }).status).toBe(0);
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
