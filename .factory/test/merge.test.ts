import { describe, expect, it } from "vitest";
import { FakeCodeHost } from "../src/adapters/fake/fake-code-host.ts";
import { HARNESS_PATHS, SENSITIVE_PATHS } from "../src/paths.ts";
import type { PrCheck } from "../src/seams/code-host.ts";
import { FACTORY_MARKER } from "../src/marker.ts";
import { lastJson, unmarked, world, type WorldOptions } from "./helpers.ts";

// Seam 1: `pnpm factory merge --branch <b>`, the Merge Mode's decision, against the fake code host. The workflow passes
// only the branch of the run that ended; everything else is read from the forge.
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

const run = (w: ReturnType<typeof mergeWorld>, branch = BRANCH) => w.factory("merge", "--branch", branch);
const merged = (w: ReturnType<typeof mergeWorld>) => w.codeHost.writes.includes("merge #101");

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
    expect(lastJson(w.logs)).toEqual({ pr: 101, mode: "safe", merged: true });
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
    expect(lastJson(w.logs)).toEqual({ mode: "human", merged: false, reason: "mode" });

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
    expect(lastJson(w.logs)).toEqual({ pr: 101, mode: "safe", merged: false, reason: "conditions", unmet: ["protected"], protected: ["pnpm-lock.yaml"] });
  });

  it("does not merge a PR that changes config.ts, where the protected list lives", async () => {
    const w = mergeWorld({ pr: { files: [".factory/src/config.ts"] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(lastJson(w.logs)).toMatchObject({ merged: false, unmet: ["protected"], protected: [".factory/src/config.ts"] });
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
    ".node-version",
    "scripts/verify.ts",
  ])("treats %s as protected", async (path) => {
    const w = mergeWorld({ pr: { files: ["apps/example/src/a.ts", path] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(lastJson(w.logs)).toMatchObject({ unmet: ["protected"], protected: [path] });
  });

  it("does not merge when verify failed, or has not ended", async () => {
    const failed = mergeWorld({ checks: GREEN.map((c) => (c.name === "verify" ? { ...c, conclusion: "failure" } : c)) });
    await run(failed);
    expect(merged(failed)).toBe(false);
    expect(lastJson(failed.logs)).toMatchObject({ merged: false, unmet: ["verify"] });

    const going = mergeWorld({ checks: GREEN.map((c) => (c.name === "verify" ? { ...c, conclusion: null } : c)) });
    await run(going);
    expect(merged(going)).toBe(false);

    const never = mergeWorld({ checks: [] });
    await run(never);
    expect(merged(never)).toBe(false);
    expect(lastJson(never.logs)).toMatchObject({ unmet: ["verify"] });
  });

  it("does not merge when the preview smoke failed, and merges a PR that has no preview", async () => {
    const smokeFailed = mergeWorld({ checks: GREEN.map((c) => (c.name.startsWith("preview smoke") ? { ...c, conclusion: "failure" } : c)) });
    await run(smokeFailed);
    expect(merged(smokeFailed)).toBe(false);
    expect(lastJson(smokeFailed.logs)).toMatchObject({ merged: false, unmet: ["preview"] });

    const deployFailed = mergeWorld({ checks: GREEN.map((c) => (c.name.startsWith("preview deploy") ? { ...c, conclusion: "failure" } : c.name.startsWith("preview smoke") ? { ...c, conclusion: "skipped" } : c)) });
    await run(deployFailed);
    expect(merged(deployFailed)).toBe(false);
    expect(lastJson(deployFailed.logs)).toMatchObject({ unmet: ["preview"] });

    const noPreview = mergeWorld({ checks: GREEN.map((c) => (c.name.startsWith("preview") ? { ...c, conclusion: "skipped" } : c)) });
    await run(noPreview);
    expect(merged(noPreview)).toBe(true);
    expect(unmarked(noPreview.codeHost.pr(101).comments.at(-1)!)).toContain("no preview");
  });

  it("does not merge when a criterion has no met verdict, or the body has no verdicts", async () => {
    const unmet = mergeWorld({ pr: { body: verdicts(["- [x] One. — proof", "- [ ] Two. — not done"]) } });
    await run(unmet);
    expect(merged(unmet)).toBe(false);
    expect(lastJson(unmet.logs)).toMatchObject({ merged: false, unmet: ["criteria"] });

    const none = mergeWorld({ pr: { body: "Implemented by the Factory.\n\nCloses #7" } });
    await run(none);
    expect(merged(none)).toBe(false);
    expect(lastJson(none.logs)).toMatchObject({ unmet: ["criteria"] });

    const ptBr = mergeWorld({ pr: { body: verdicts(["- [x] Um. — prova"]).replace("## Acceptance criteria verdicts", "## Vereditos dos critérios de aceitação") } });
    await run(ptBr);
    expect(merged(ptBr)).toBe(true);
  });

  it("does not merge when the last deploy of main failed, and merges when none has run yet", async () => {
    const failed = mergeWorld({ deploy: "failure" });
    await run(failed);
    expect(merged(failed)).toBe(false);
    expect(lastJson(failed.logs)).toMatchObject({ merged: false, unmet: ["deploy"] });

    const timedOut = mergeWorld({ deploy: "timed_out" });
    await run(timedOut);
    expect(merged(timedOut)).toBe(false);

    const none = mergeWorld({ deploy: null });
    await run(none);
    expect(merged(none)).toBe(true);
  });

  it("names every condition that does not hold", async () => {
    const w = mergeWorld({ deploy: "failure", checks: [], pr: { body: "", files: ["package.json"] } });

    await run(w);

    expect(lastJson(w.logs)).toMatchObject({ merged: false, unmet: ["protected", "verify", "criteria", "deploy"] });
  });

  it("merges only a ready, open Factory PR of this repository into the base branch", async () => {
    const draft = mergeWorld({ pr: { draft: true } });
    await run(draft);
    expect(merged(draft)).toBe(false);
    expect(lastJson(draft.logs)).toMatchObject({ merged: false, reason: "not-ready" });

    const fork = mergeWorld({ pr: { fork: true } });
    await run(fork);
    expect(merged(fork)).toBe(false);

    const other = mergeWorld({ pr: { base: "release" } });
    await run(other);
    expect(merged(other)).toBe(false);

    const person = mergeWorld({ pr: { branch: "feature/x" } });
    await run(person, "feature/x");
    expect(merged(person)).toBe(false);
    expect(lastJson(person.logs)).toMatchObject({ merged: false, reason: "not-factory" });

    const missing = mergeWorld();
    await run(missing, "factory/issue-8");
    expect(lastJson(missing.logs)).toMatchObject({ merged: false, reason: "no-pr" });
  });

  it("does not merge while a Factory run works on the PR", async () => {
    const w = mergeWorld({ pr: { labels: ["in-progress", "factory:working"] } });

    await run(w);

    expect(merged(w)).toBe(false);
    expect(lastJson(w.logs)).toMatchObject({ merged: false, reason: "working" });
  });

  it("reads the checks of the head it merges, and a head that moved is not merged", async () => {
    const w = mergeWorld();
    w.codeHost.checksAt.clear();
    w.codeHost.checksAt.set("b".repeat(40), GREEN);

    await run(w);

    expect(merged(w)).toBe(false);
    expect(lastJson(w.logs)).toMatchObject({ unmet: ["verify"] });
  });

  it("says so and labels nothing when the forge refuses the merge", async () => {
    const w = mergeWorld({ pr: { mergeRefusal: "Base branch was modified." } });

    expect(await run(w)).toBe(0);

    expect(w.codeHost.pr(101).labels).not.toContain("auto-merged");
    expect(w.codeHost.writes).toEqual([]);
    expect(lastJson(w.logs)).toEqual({ pr: 101, mode: "safe", merged: false, reason: "refused", detail: "Base branch was modified." });
  });

  it("reads with the job token and writes with the Factory's", async () => {
    const reads = new FakeCodeHost({ prs: [{ number: 101, branch: BRANCH, headSha: HEAD, body: ALL_MET, files: ["src/a.ts"] }] });
    reads.checksAt.set(HEAD, GREEN);
    reads.deploy = "success";
    const w = world({ prs: [{ number: 101, branch: BRANCH, headSha: HEAD }], env: { FACTORY_MERGE_MODE: "safe" }, jobCodeHost: reads });

    await w.factory("merge", "--branch", BRANCH);

    expect(reads.writes).toEqual([]);
    expect(w.codeHost.writes).toEqual(["merge #101", "labelPr #101 auto-merged", "commentPr #101"]);
  });

  it("refuses an unknown Merge Mode", async () => {
    const w = mergeWorld({ env: { FACTORY_MERGE_MODE: "yolo" } });

    await expect(run(w)).rejects.toThrow(/FACTORY_MERGE_MODE/);
    expect(w.codeHost.writes).toEqual([]);
  });
});
