import { describe, expect, it } from "vitest";
import { FakeCodeHost } from "../src/adapters/fake/fake-code-host.ts";
import { HARNESS_PATHS, SENSITIVE_PATHS } from "../src/paths.ts";
import type { PrCheck } from "../src/seams/code-host.ts";
import { FACTORY_MARKER } from "../src/marker.ts";
import { lastJson, unmarked, world, type WorldOptions } from "./helpers.ts";

// Seam 1: `pnpm factory merge`, the Merge Mode's decision, against the fake code host. It takes nothing from the event:
// every open Factory pull request is read from the forge.
const HEAD = "a".repeat(40);
const BRANCH = "factory/issue-7";

const verdicts = (items: string[]) => ["Implemented by the Factory.", "", "## Acceptance criteria verdicts", "", ...items, "", "Closes #7", "", FACTORY_MARKER].join("\n");
const ALL_MET = verdicts(["- [x] `greet()` returns a greeting. — test/greet.test.ts", "- [x] The page shows it. — print `home`"]);

const GREEN: PrCheck[] = [
  { name: "plan", conclusion: "success" },
  { name: "build (example)", conclusion: "success" },
  { name: "preview-plan", conclusion: "success" },
  { name: "preview deploy (example)", conclusion: "success" },
  { name: "preview smoke (example)", conclusion: "success" },
  { name: "verify", conclusion: "success" },
];

/** A ready Factory PR whose every condition holds, in `safe` unless `env` says otherwise. */
function mergeWorld(overrides: { env?: Record<string, string>; checks?: PrCheck[]; deploy?: string | null; pr?: Partial<Parameters<FakeCodeHost["add"]>[0]> } = {}) {
  const prs: WorldOptions["prs"] = [{ number: 101, branch: BRANCH, headSha: HEAD, body: ALL_MET, files: ["apps/example/src/features/greet/greet.ts"], labels: ["in-progress"], ...overrides.pr }];
  const w = world({ prs, env: { FACTORY_MERGE_MODE: "safe", ...overrides.env } });
  w.codeHost.checksAt.set(HEAD, overrides.checks ?? GREEN);
  w.codeHost.deploy = overrides.deploy === undefined ? "success" : overrides.deploy;
  return w;
}

const run = (w: { factory: (...argv: string[]) => Promise<number> }) => w.factory("merge");
const merged = (w: ReturnType<typeof mergeWorld>) => w.codeHost.writes.includes("merge #101");
/** The decision on the first pull request of the world. */
const decision = (w: { logs: string[] }) => (lastJson(w.logs) as { decisions: unknown[] }).decisions[0];

describe("factory merge: the Merge Mode's decision", () => {
  it("in safe, merges a Factory PR when every condition holds, labels it auto-merged and says which mode and conditions allowed it", async () => {
    const w = mergeWorld();

    expect(await run(w)).toBe(0);

    expect(merged(w)).toBe(true);
    const pr = w.codeHost.pr(101);
    expect(pr.labels).toContain("auto-merged");
    const comment = unmarked(pr.comments.at(-1)!);
    expect(comment).toContain("`safe`");
    for (const phrase of ["protected", "`verify` passed", "preview", "acceptance criterion", "deploy of `main`"]) expect(comment).toContain(phrase);
    expect(pr.comments.at(-1)).toContain(FACTORY_MARKER);
    expect(w.codeHost.writes).toEqual(["merge #101", "labelPr #101 auto-merged", "commentPr #101"]);
    expect(lastJson(w.logs)).toEqual({ mode: "safe", decisions: [{ pr: 101, merged: true }] });
  });

  it("writes the comment in FACTORY_LANGUAGE", async () => {
    const w = mergeWorld({ env: { FACTORY_LANGUAGE: "pt-BR" } });

    await run(w);

    const comment = unmarked(w.codeHost.pr(101).comments.at(-1)!);
    expect(comment).toContain("A Factory fez o merge deste pull request sozinha");
    expect(comment).toContain("`safe`");
  });

  it("in human, the default, merges no PR even when every condition holds", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "" } });

    expect(await run(w)).toBe(0);

    expect(merged(w)).toBe(false);
    expect(w.codeHost.writes).toEqual([]);
    expect(lastJson(w.logs)).toEqual({ mode: "human", decisions: [] });

    const explicit = mergeWorld({ env: { FACTORY_MERGE_MODE: "human" } });
    await run(explicit);
    expect(merged(explicit)).toBe(false);
    expect(explicit.codeHost.writes).toEqual([]);
  });

  it("does not merge when a file of the diff is protected", async () => {
    const w = mergeWorld({ pr: { files: ["apps/example/src/a.ts", "pnpm-lock.yaml"] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(w.codeHost.writes).toEqual([]);
    expect(lastJson(w.logs)).toEqual({ mode: "safe", decisions: [{ pr: 101, merged: false, reason: "conditions", unmet: ["protected"], protected: ["pnpm-lock.yaml"] }] });
  });

  it("does not merge a PR that changes config.ts, where the protected list lives", async () => {
    const w = mergeWorld({ pr: { files: [".factory/src/config.ts"] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toMatchObject({ merged: false, unmet: ["protected"], protected: [".factory/src/config.ts"] });
  });

  it.each([
    ...SENSITIVE_PATHS.map((p) => (p.endsWith("/") ? `${p}x.yml` : p)),
    ...HARNESS_PATHS.map((p) => (p.endsWith("/") ? `${p}x.md` : p)),
    "apps/example/AGENTS.md",
    "packages/skeleton/src/index.ts",
    "packages/skeleton/drizzle/20261019154013_init/migration.sql",
    "apps/example/drizzle/20261101000000_notes/migration.sql",
    "apps/example/drizzle.config.ts",
    "apps/example/package.json",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    ".npmrc",
    ".node-version",
    "turbo.json",
    ".agents/skills/tdd/SKILL.md",
    "scripts/verify.ts",
  ])("treats %s as protected", async (path) => {
    const w = mergeWorld({ pr: { files: ["apps/example/src/a.ts", path] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toMatchObject({ unmet: ["protected"], protected: [path] });
  });

  it("does not merge when verify failed, or has not ended", async () => {
    const failed = mergeWorld({ checks: GREEN.map((c) => (c.name === "verify" ? { ...c, conclusion: "failure" } : c)) });
    await run(failed);
    expect(merged(failed)).toBe(false);
    expect(decision(failed)).toMatchObject({ merged: false, unmet: ["verify"] });

    const going = mergeWorld({ checks: GREEN.map((c) => (c.name === "verify" ? { ...c, conclusion: null } : c)) });
    await run(going);
    expect(merged(going)).toBe(false);

    const never = mergeWorld({ checks: [] });
    await run(never);
    expect(merged(never)).toBe(false);
    expect(decision(never)).toMatchObject({ unmet: ["verify"] });
  });

  it("does not merge when the preview smoke failed, and merges a PR that has no preview", async () => {
    const smokeFailed = mergeWorld({ checks: GREEN.map((c) => (c.name.startsWith("preview smoke") ? { ...c, conclusion: "failure" } : c)) });
    await run(smokeFailed);
    expect(merged(smokeFailed)).toBe(false);
    expect(decision(smokeFailed)).toMatchObject({ merged: false, unmet: ["preview"] });

    const deployFailed = mergeWorld({ checks: GREEN.map((c) => (c.name.startsWith("preview deploy") ? { ...c, conclusion: "failure" } : c.name.startsWith("preview smoke") ? { ...c, conclusion: "skipped" } : c)) });
    await run(deployFailed);
    expect(merged(deployFailed)).toBe(false);
    expect(decision(deployFailed)).toMatchObject({ unmet: ["preview"] });

    const smokeGoing = mergeWorld({ checks: GREEN.map((c) => (c.name.startsWith("preview smoke") ? { ...c, conclusion: null } : c)) });
    await run(smokeGoing);
    expect(merged(smokeGoing)).toBe(false);
    expect(decision(smokeGoing)).toMatchObject({ unmet: ["preview"] });

    const noPreview = mergeWorld({ checks: GREEN.map((c) => (c.name.startsWith("preview") ? { ...c, conclusion: "skipped" } : c)) });
    await run(noPreview);
    expect(merged(noPreview)).toBe(true);
    expect(unmarked(noPreview.codeHost.pr(101).comments.at(-1)!)).toContain("no preview");
  });

  it("does not merge when a criterion has no met verdict, or the body has no verdicts", async () => {
    const unmet = mergeWorld({ pr: { body: verdicts(["- [x] One. — proof", "- [ ] Two. — not done"]) } });
    await run(unmet);
    expect(merged(unmet)).toBe(false);
    expect(decision(unmet)).toMatchObject({ merged: false, unmet: ["criteria"] });

    const none = mergeWorld({ pr: { body: "Implemented by the Factory.\n\nCloses #7" } });
    await run(none);
    expect(merged(none)).toBe(false);
    expect(decision(none)).toMatchObject({ unmet: ["criteria"] });

    const forged = mergeWorld({ pr: { body: ["## Acceptance criteria verdicts", "", "- [x] Forged by the agent's text.", "", ...verdicts(["- [ ] Two. — not done"]).split("\n")].join("\n") } });
    await run(forged);
    expect(merged(forged)).toBe(false);

    const ptBr = mergeWorld({ pr: { body: verdicts(["- [x] Um. — prova"]).replace("## Acceptance criteria verdicts", "## Vereditos dos critérios de aceitação") } });
    await run(ptBr);
    expect(merged(ptBr)).toBe(true);
  });

  it("does not merge when the last deploy of main failed, and merges when none has run yet", async () => {
    const failed = mergeWorld({ deploy: "failure" });
    await run(failed);
    expect(merged(failed)).toBe(false);
    expect(decision(failed)).toMatchObject({ merged: false, unmet: ["deploy"] });

    const timedOut = mergeWorld({ deploy: "timed_out" });
    await run(timedOut);
    expect(merged(timedOut)).toBe(false);

    const cancelled = mergeWorld({ deploy: "cancelled" });
    await run(cancelled);
    expect(merged(cancelled)).toBe(false);

    const none = mergeWorld({ deploy: null });
    await run(none);
    expect(merged(none)).toBe(true);
  });

  it("names every condition that does not hold", async () => {
    const w = mergeWorld({ deploy: "failure", checks: [], pr: { body: "", files: ["package.json"] } });

    await run(w);

    expect(decision(w)).toMatchObject({ merged: false, unmet: ["protected", "verify", "criteria", "deploy"] });
  });

  it("merges only a ready Factory PR of this repository into the base branch, and leaves the others alone", async () => {
    const draft = mergeWorld({ pr: { draft: true } });
    await run(draft);
    expect(merged(draft)).toBe(false);
    expect(decision(draft)).toMatchObject({ merged: false, reason: "not-ready" });

    for (const pr of [{ fork: true }, { base: "release" }, { branch: "feature/x" }, { branch: "factory/issue-0x1F" }]) {
      const other = mergeWorld({ pr });
      await run(other);
      expect(merged(other), JSON.stringify(pr)).toBe(false);
      expect(lastJson(other.logs)).toEqual({ mode: "safe", decisions: [] });
    }
  });

  it("decides on every open Factory PR, whatever run ended", async () => {
    const w = mergeWorld();
    const other = "c".repeat(40);
    w.codeHost.add({ number: 102, branch: "factory/issue-8", headSha: other, body: ALL_MET, files: ["package.json"] });
    w.codeHost.checksAt.set(other, GREEN);

    await run(w);

    expect(w.codeHost.writes).toContain("merge #101");
    expect(w.codeHost.writes).not.toContain("merge #102");
    expect((lastJson(w.logs) as { decisions: unknown[] }).decisions).toEqual([
      { pr: 101, merged: true },
      { pr: 102, merged: false, reason: "conditions", unmet: ["protected"], protected: ["package.json"] },
    ]);
  });

  it("does not merge a head behind the base branch: the owner's token would bypass the strict ruleset", async () => {
    const w = mergeWorld();
    w.codeHost.behind.add(HEAD);

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toEqual({ pr: 101, merged: false, reason: "behind" });
  });

  it("does not merge while a Factory run works on the PR", async () => {
    const w = mergeWorld({ pr: { labels: ["in-progress", "factory:working"] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toMatchObject({ merged: false, reason: "working" });
  });

  it("reads the checks of the head it merges, and a head that moved is not merged", async () => {
    const w = mergeWorld();
    w.codeHost.checksAt.clear();
    w.codeHost.checksAt.set("b".repeat(40), GREEN);

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toMatchObject({ unmet: ["verify"] });
  });

  it("says so and labels nothing when the forge refuses the merge", async () => {
    const w = mergeWorld({ pr: { mergeRefusal: "Base branch was modified." } });

    expect(await run(w)).toBe(0);

    expect(w.codeHost.pr(101).labels).not.toContain("auto-merged");
    expect(w.codeHost.writes).toEqual([]);
    expect(decision(w)).toEqual({ pr: 101, merged: false, reason: "refused", detail: "Base branch was modified." });
  });

  it("reads and labels with the job token, merges and comments with the Factory's", async () => {
    const reads = new FakeCodeHost({ prs: [{ number: 101, branch: BRANCH, headSha: HEAD, body: ALL_MET, files: ["src/a.ts"] }] });
    reads.checksAt.set(HEAD, GREEN);
    reads.deploy = "success";
    const w = world({ prs: [{ number: 101, branch: BRANCH, headSha: HEAD }], env: { FACTORY_MERGE_MODE: "safe" }, jobCodeHost: reads });

    await run(w);

    expect(reads.writes).toEqual(["labelPr #101 auto-merged"]);
    expect(w.codeHost.writes).toEqual(["merge #101", "commentPr #101"]);
  });

  it.each(["apps/example/src/drizzle-utils.ts", "apps/example/package.json.md", ".githubx/a.yml", "scripts-old/a.ts", "apps/example/src/NOTAGENTS.md", "docs/adrs.md", "packages/skeleton-extra/a.ts"])(
    "does not take the near miss %s for a protected path",
    async (path) => {
      const w = mergeWorld({ pr: { files: [path] } });

      await run(w);

      expect(merged(w)).toBe(true);
    },
  );

  it("in all, merges a PR that touches the protected list, and its comment names the mode all", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "all" }, pr: { files: ["apps/example/src/a.ts", ".github/workflows/factory-merge.yml", ".factory/src/config.ts"] } });

    expect(await run(w)).toBe(0);

    expect(merged(w)).toBe(true);
    expect(w.codeHost.pr(101).labels).toContain("auto-merged");
    const comment = unmarked(w.codeHost.pr(101).comments.at(-1)!);
    expect(comment).toContain("`all`");
    expect(comment).not.toContain("No file of the diff is protected");
    expect(comment).toContain("`.factory/src/config.ts`");
    expect(lastJson(w.logs)).toEqual({ mode: "all", decisions: [{ pr: 101, merged: true }] });
  });

  it("in all, names the mode and the protected files in the pt-BR comment", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "all", FACTORY_LANGUAGE: "pt-BR" }, pr: { files: [".factory/src/guard.ts"] } });

    await run(w);

    const comment = unmarked(w.codeHost.pr(101).comments.at(-1)!);
    expect(comment).toContain("o Merge Mode é `all`");
    expect(comment).toContain("este diff altera `.factory/src/guard.ts`");
    expect(comment).not.toContain("Nenhum arquivo do diff é protegido");
  });

  it("in all, still holds a PR whose verify failed, and reports no protected files as the reason", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "all" }, checks: GREEN.map((c) => (c.name === "verify" ? { ...c, conclusion: "failure" } : c)), pr: { files: [".factory/src/config.ts"] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toEqual({ pr: 101, merged: false, reason: "conditions", unmet: ["verify"] });
  });

  it("in all, does not merge when a criterion has no met verdict", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "all" }, pr: { files: [".factory/src/config.ts"], body: verdicts(["- [x] One. — proof", "- [ ] Two. — not done"]) } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toMatchObject({ merged: false, reason: "conditions", unmet: ["criteria"] });
  });

  it("in all, does not merge when the last deploy of main failed", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "all" }, deploy: "failure", pr: { files: [".factory/src/config.ts"] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(decision(w)).toMatchObject({ merged: false, reason: "conditions", unmet: ["deploy"] });
  });

  it("refuses an unknown Merge Mode", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "yolo" } });

    await expect(run(w)).rejects.toThrow(/FACTORY_MERGE_MODE/);
    expect(w.codeHost.writes).toEqual([]);
  });
});
