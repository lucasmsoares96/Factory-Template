import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeAgent, type AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { FakeVerify, type VerifyStep } from "../src/adapters/fake/fake-verify.ts";
import { adaptersFromEnv } from "../src/adapters/index.ts";
import { runFactory } from "../src/cli.ts";
import { IN_BUNDLE, IN_TRACKER, type ContainerJob, type ContainerRunner } from "../src/local/container.ts";
import type { Stage } from "../src/seams/agent.ts";
import { checkout, commitFiles, git, lastJson, tempDir } from "./helpers.ts";

const SPEC = "# Spec: greetings\n\n## Testing Decisions\n\n1. CLI against the fakes.\n";
const TICKET = (status: string) =>
  [
    "# 07: Greet the user",
    "",
    "Spec: [../spec.md](../spec.md)",
    "",
    "**Blocked by:** None (can start immediately)",
    "",
    `**Status:** ${status}`,
    "",
    "## Acceptance criteria",
    "",
    "- [ ] `greet()` returns a greeting.",
    "",
  ].join("\n");

const develop: AgentStep = async ({ cwd }) => {
  await commitFiles(cwd, { "src/greet.ts": 'export const greet = () => "hi";\n', "apps/example/e2e/greet.spec.ts": 'await evidence("home");\n' }, "feat: greet the user #7");
};
const reviewSays: AgentStep = () => ({ output: '<review>{"summary": "Looks right.", "inline": []}</review>' });

const writesBody: AgentStep = () => ({ output: "<pull-request>## Summary\n\nGreets the user.\n\n## Merge Danger\n\n**Door:** two-way</pull-request>" });

/**
 * The container of `pnpm factory local`, without Docker: clones the bundle it
 * was given and runs the real `work` with FACTORY_ADAPTERS=local, swapping
 * only the Agent and Verify for the scripted fakes.
 */
function fakeContainer(script: { agent?: Partial<Record<Stage, AgentStep[]>>; verify?: VerifyStep[]; exitCode?: number } = {}) {
  const jobs: (ContainerJob & { spec: string; tickets: string[] })[] = [];
  const runner: ContainerRunner = {
    async run(job) {
      const tracker = join(job.inDir, IN_TRACKER);
      jobs.push({ ...job, spec: await readFile(join(tracker, "spec.md"), "utf8"), tickets: await readdir(join(tracker, "issues")) });
      if (script.exitCode !== undefined) return { exitCode: script.exitCode };
      const repo = join(await tempDir("factory-container-"), "repo");
      await git(job.inDir, "clone", "--quiet", "--branch", job.base, join(job.inDir, IN_BUNDLE), repo);
      const sessions = join(job.outDir, "sessions");
      await mkdir(sessions, { recursive: true });
      await writeFile(join(sessions, "01-development.jsonl"), '{"type":"result","result":"Done."}\n');
      const env = { ...job.env, FACTORY_ADAPTERS: "local", FACTORY_TRACKER_DIR: join(job.inDir, IN_TRACKER, "issues") };
      const exitCode = await runFactory([job.command ?? "work", String(job.issue), "--out", job.outDir, "--repo", repo], {
        env,
        log: () => {},
        adapters: (input) => ({
          ...adaptersFromEnv(env, input),
          agent: new FakeAgent(repo, script.agent ?? { development: [develop], review: [reviewSays], "pull-request": [writesBody] }),
          verify: new FakeVerify(repo, "test-results/evidence", script.verify ?? [{ ok: true, evidence: [{ product: "example", name: "home.png" }] }]),
        }),
      });
      return { exitCode };
    },
  };
  return { runner, jobs };
}

/** A host repo with the ticket in `.scratch/greetings/issues/`, not committed (as a human leaves it). */
async function host(status = "ready-for-agent") {
  const repo = await checkout();
  const feature = join(repo, ".scratch/greetings");
  await mkdir(join(feature, "issues"), { recursive: true });
  await writeFile(join(feature, "spec.md"), SPEC);
  await writeFile(join(feature, "issues/07-greet.md"), TICKET(status));
  return { repo, feature, ticket: () => readFile(join(feature, "issues/07-greet.md"), "utf8") };
}

async function local(repo: string, container: ContainerRunner, env: Record<string, string> = {}) {
  const logs: string[] = [];
  const code = await runFactory(["local", "7", "--repo", repo], {
    env: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret", FACTORY_TOKEN: "forge-secret", GITHUB_TOKEN: "gh-secret", USER: "lucas", ...env },
    log: (line) => logs.push(line),
    adapters: () => {
      throw new Error("local builds its own adapters");
    },
    container: () => container,
  });
  return { code, logs, json: () => lastJson(logs) as Record<string, unknown> };
}

describe("pnpm factory local", () => {
  it("takes a Markdown issue to a ready local branch, with the review, evidence and sessions in the ticket's folder", async () => {
    const h = await host();
    const container = fakeContainer();

    const run = await local(h.repo, container.runner);

    expect(run.code).toBe(0);
    expect(run.json()).toMatchObject({ issue: 7, outcome: "ready", branch: "factory/issue-7" });
    expect(await git(h.repo, "log", "--format=%s", "main..factory/issue-7")).toBe("feat: greet the user #7");
    const ticket = await h.ticket();
    expect(ticket).toContain("**Status:** in-progress");
    expect(ticket).toContain("**Pull request (local, ready):** `factory/issue-7` → `main`");
    expect(ticket).toContain("Greets the user.\n\n## Merge Danger");
    expect(ticket).toContain("Closes #7");
    expect(ticket).toContain("**Factory review**");
    expect(ticket).toContain("Looks right.");
    expect(ticket).toContain("![home.png](../evidence/07/example/home.png)");
    const evidence = join(h.feature, "evidence/07");
    expect(await readFile(join(evidence, "example/home.png"), "utf8")).toBe("png:example/home.png");
    expect(await readdir(join(evidence, "sessions"))).toEqual(["01-development.jsonl"]);
    // The host's working tree is untouched apart from the ticket's folder.
    expect(await git(h.repo, "status", "--porcelain")).toBe("?? .scratch/");
  });

  it("Triage: a ticket with Status agent:explore is triaged in the container and applied here (comment, new Status)", async () => {
    const h = await host("agent:explore");
    const verdict = {
      number: 7,
      tag: "easy-call",
      difficulty: "small",
      approach: "Add greet().",
      door: { kind: "two-way", blastRadius: "one module" },
      seams: [{ seam: "The CLI against the fakes", catches: "wrong output", misses: "nothing real" }],
    };
    const container = fakeContainer({ agent: { triage: [() => ({ output: `<triage>${JSON.stringify({ issues: [verdict] })}</triage>` })] } });

    const run = await local(h.repo, container.runner);

    expect(run.code).toBe(0);
    expect(container.jobs[0]).toMatchObject({ command: "triage", issue: 7 });
    expect(run.json()).toMatchObject({ triage: { applied: [{ issue: 7, tag: "easy-call", label: "ready-for-agent" }] } });
    const ticket = await h.ticket();
    expect(ticket).toContain("**Status:** ready-for-agent");
    expect(ticket).toContain("<!-- factory:triage -->");
    expect(ticket).toContain("The CLI against the fakes");
    expect(await git(h.repo, "branch", "--list", "factory/issue-7")).toBe("");
  });

  it("hands the container the base branch and the tickets, with Claude's auth and settings but no forge token", async () => {
    const h = await host();
    const container = fakeContainer();

    await local(h.repo, container.runner, { FACTORY_MAX_ATTEMPTS: "3" });

    const [job] = container.jobs;
    expect(job).toMatchObject({ issue: 7, base: "main" });
    expect(Object.keys(job!.env).sort()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "FACTORY_MAX_ATTEMPTS"]);
    expect(job!.spec).toBe(SPEC);
    expect(job!.tickets).toEqual(["07-greet.md"]);
    // The temporary in/out directories are gone after the run.
    await expect(readdir(job!.inDir)).rejects.toThrow();
  });

  it("escalates as infra in the ticket when the container leaves no result", async () => {
    const h = await host();

    const run = await local(h.repo, fakeContainer({ exitCode: 1 }).runner);

    expect(run.json()).toMatchObject({ outcome: "escalated", reason: "infra" });
    const ticket = await h.ticket();
    expect(ticket).toContain("**Status:** ready-for-human");
    expect(ticket).toContain("**Factory escalation (`infra`):**");
  });

  it("does nothing when the guard refuses the issue", async () => {
    const h = await host("needs-triage");
    const container = fakeContainer();

    const run = await local(h.repo, container.runner);

    expect(run.json()).toMatchObject({ claimed: false, reason: "not-ready" });
    expect(container.jobs).toEqual([]);
    expect(await h.ticket()).toBe(TICKET("needs-triage"));
  });

  it("refuses to start without Claude's auth, before touching the issue", async () => {
    const h = await host();
    const run = runFactory(["local", "7", "--repo", h.repo], {
      env: { USER: "lucas" },
      log: () => {},
      adapters: () => {
        throw new Error("unused");
      },
      container: () => fakeContainer().runner,
    });
    await expect(run).rejects.toThrow(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(await h.ticket()).toBe(TICKET("ready-for-agent"));
  });
});
