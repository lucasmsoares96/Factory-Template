import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStep } from "../src/adapters/fake/fake-agent.ts";
import { TRIAGE_MARKER } from "../src/guard.ts";
import { HUMAN, OWNER, ISSUE_BODY, checkout, lastJson, tempDir, world, type World, type WorldOptions } from "./helpers.ts";

// Seam 1: the Triage and `apply` through the CLI against the fakes.

const explore = { "agent:explore": HUMAN };

function verdict(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    tag: "easy-call",
    difficulty: "small",
    files: ["src/greet.ts"],
    claims: ["`greet()` does not exist yet: verified"],
    questions: [],
    approach: "Add greet() and export it.",
    door: { kind: "two-way", blastRadius: "one module" },
    seams: [{ seam: "The CLI against the fakes", catches: "wrong labels", misses: "real GitHub behaviour" }],
    product: null,
    duplicateOf: null,
    ...over,
  };
}
const block = (...issues: object[]) => `Done.\n<triage>${JSON.stringify({ issues })}</triage>`;
const says = (...issues: object[]): AgentStep => () => ({ output: block(...issues) });

async function setup(opts: { issues?: NonNullable<WorldOptions["issues"]>; triage: AgentStep[]; products?: string[] }) {
  const repo = await checkout();
  for (const id of opts.products ?? ["example"]) await mkdir(join(repo, "apps", id), { recursive: true });
  const out = await tempDir("factory-triage-out-");
  const w = world({
    repo,
    issues: opts.issues ?? [{ number: 5, title: "Greet", body: ISSUE_BODY, labels: explore }],
    agent: { triage: opts.triage },
  });
  return { w, repo, out };
}
const triage = (s: Awaited<ReturnType<typeof setup>>, ...extra: string[]) => s.w.factory("triage", ...extra, "--out", s.out, "--repo", s.repo);
const apply = (s: Awaited<ReturnType<typeof setup>>) => s.w.factory("apply", "--in", s.out, "--repo", s.repo);
const triageComments = (w: World, n: number) => w.tracker.commentsOn(n).filter((c) => c.body.includes(TRIAGE_MARKER));

describe("factory triage + apply", () => {
  it("easy-call: one marked comment with the seams and the door, then ready-for-agent", async () => {
    const s = await setup({ triage: [says(verdict(5))] });

    expect(await triage(s)).toBe(0);
    // `work` is read-only: nothing changed on the forge yet.
    expect(s.w.tracker.labelsOf(5)).toEqual(["agent:explore"]);
    expect(s.w.tracker.commentsOn(5)).toEqual([]);

    expect(await apply(s)).toBe(0);
    expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
    const comments = triageComments(s.w, 5);
    expect(comments).toHaveLength(1);
    expect(comments[0]!).toMatchObject({ author: OWNER });
    expect(comments[0]!.body).toContain("easy-call");
    expect(comments[0]!.body).toContain("The CLI against the fakes");
    expect(comments[0]!.body).toContain("real GitHub behaviour");
    expect(comments[0]!.body).toMatch(/two-way/);
  });

  it("the comment makes the guard accept the issue's seams", async () => {
    const s = await setup({ triage: [says(verdict(5))] });
    await triage(s);
    await apply(s);
    s.w.tracker.issues.get(5)!.labels.set("ready-for-agent", HUMAN);

    await s.w.factory("claim", "5");

    expect(lastJson(s.w.logs)).toMatchObject({ claimed: true });
  });

  it("needs-a-human becomes ready-for-human and blocked becomes needs-info", async () => {
    const s = await setup({
      issues: [
        { number: 5, body: ISSUE_BODY, labels: explore },
        { number: 6, body: ISSUE_BODY, labels: explore },
      ],
      triage: [says(verdict(5, { tag: "needs-a-human", questions: ["Which provider?"] }), verdict(6, { tag: "blocked", seams: [] }))],
    });

    await triage(s);
    await apply(s);

    expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-human"]);
    expect(s.w.tracker.labelsOf(6)).toEqual(["needs-info"]);
    expect(triageComments(s.w, 5)[0]!.body).toContain("Which provider?");
    expect(triageComments(s.w, 6)).toHaveLength(1);
  });

  it("triages the whole batch in one session", async () => {
    const s = await setup({
      issues: [
        { number: 5, title: "First", body: ISSUE_BODY, labels: explore },
        { number: 6, title: "Second", body: ISSUE_BODY, labels: explore },
        { number: 7, title: "Not explored", body: ISSUE_BODY, labels: { "ready-for-agent": HUMAN } },
      ],
      triage: [says(verdict(5), verdict(6))],
    });

    await triage(s);

    expect(s.w.agent.calls).toHaveLength(1);
    expect(s.w.agent.calls[0]!.prompt).toContain("First");
    expect(s.w.agent.calls[0]!.prompt).toContain("Second");
    expect(s.w.agent.calls[0]!.prompt).not.toContain("Not explored");
  });

  it("never reads an issue whose label was put by someone without write access", async () => {
    const s = await setup({
      issues: [{ number: 5, title: "Outsider", body: ISSUE_BODY, labels: { "agent:explore": "mallory" } }],
      triage: [],
    });

    expect(await triage(s)).toBe(0);

    expect(s.w.agent.calls).toEqual([]);
  });

  describe("an issue the Factory sent to Triage (its own swap, with the job token)", () => {
    const BOT = "github-actions[bot]";
    /** `agent:explore` put by the job token in the swap that removed a `ready-for-agent` put by `by`. */
    const sent = (number: number, by: string) => ({
      number,
      title: `Sent by ${by}`,
      body: ISSUE_BODY,
      labels: { "agent:explore": BOT },
      swapped: { "agent:explore": { from: "ready-for-agent", by } },
    });

    it("is read when the ready-for-agent it replaced was put by a writer, and apply posts its verdict", async () => {
      const s = await setup({ issues: [sent(5, HUMAN)], triage: [says(verdict(5))] });

      await triage(s);
      expect(lastJson(s.w.logs)).toMatchObject({ triaged: [5], skipped: [] });
      expect(await apply(s)).toBe(0);

      expect(lastJson(s.w.logs)).toMatchObject({ skipped: [] });
      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
      expect(triageComments(s.w, 5)).toHaveLength(1);
    });

    it("the whole path: a writer's ready-for-agent refused for missing seams reaches the Triage", async () => {
      const s = await setup({ issues: [{ number: 5, body: ISSUE_BODY, labels: { "ready-for-agent": HUMAN } }], triage: [says(verdict(5))] });
      s.w.tracker.actAs(BOT);
      await s.w.factory("claim", "5");
      expect(s.w.tracker.labelsOf(5)).toEqual(["agent:explore"]);
      s.w.tracker.actAs(OWNER);

      await triage(s);
      await apply(s);

      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
      expect(triageComments(s.w, 5)).toHaveLength(1);
    });

    it("is skipped when the ready-for-agent it replaced was put by a non-writer, by triage and by apply", async () => {
      const s = await setup({ issues: [sent(5, "mallory")], triage: [] });

      await triage(s);

      expect(s.w.agent.calls).toEqual([]);
      expect(lastJson(s.w.logs)).toMatchObject({ skipped: [5] });
    });

    it("apply skips a verdict for a swap of a non-writer's ready-for-agent", async () => {
      const s = await setup({ issues: [sent(5, HUMAN)], triage: [says(verdict(5))] });
      await triage(s);
      s.w.tracker.issues.get(5)!.swapped.set("agent:explore", { from: "ready-for-agent", by: "mallory" });

      await apply(s);

      expect(lastJson(s.w.logs)).toMatchObject({ skipped: [{ issue: 5, reason: "label not put by someone with write access" }] });
      expect(s.w.tracker.labelsOf(5)).toEqual(["agent:explore"]);
      expect(s.w.tracker.commentsOn(5)).toEqual([]);
    });

    it("the swap does not launder an agent:explore a non-writer had already put on the issue", async () => {
      const s = await setup({
        issues: [{ number: 5, body: ISSUE_BODY, labels: { "ready-for-agent": HUMAN, "agent:explore": "mallory" } }],
        triage: [],
      });
      s.w.tracker.actAs(BOT);
      await s.w.factory("claim", "5");
      s.w.tracker.actAs(OWNER);

      await triage(s);

      expect(s.w.agent.calls).toEqual([]);
      expect(lastJson(s.w.logs)).toMatchObject({ skipped: [5] });
    });

    it("a non-writer's agent:explore is still skipped, swap or not", async () => {
      const s = await setup({
        issues: [
          { number: 5, body: ISSUE_BODY, labels: { "agent:explore": "mallory" }, swapped: { "agent:explore": { from: "needs-info", by: HUMAN } } },
          { number: 6, body: ISSUE_BODY, labels: { "agent:explore": "mallory" } },
        ],
        triage: [],
      });

      await triage(s);

      expect(s.w.agent.calls).toEqual([]);
      expect(lastJson(s.w.logs)).toMatchObject({ skipped: [5, 6] });
    });

    it("a writer who removes and re-adds agent:explore by hand still gets it triaged", async () => {
      const s = await setup({ issues: [sent(5, "mallory")], triage: [says(verdict(5))] });
      await s.w.tracker.removeLabel(5, "agent:explore");
      s.w.tracker.actAs(HUMAN);
      await s.w.tracker.addLabel(5, "agent:explore");
      s.w.tracker.actAs(OWNER);

      await triage(s);
      await apply(s);

      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
    });
  });

  it("apply checks the forge again: an issue no longer in Triage is left alone", async () => {
    const s = await setup({ triage: [says(verdict(5))] });
    await triage(s);
    s.w.tracker.issues.get(5)!.labels.delete("agent:explore");

    await apply(s);

    expect(s.w.tracker.labelsOf(5)).toEqual([]);
    expect(s.w.tracker.commentsOn(5)).toEqual([]);
  });

  it("a duplicate is never queued: it goes to a human, naming the original", async () => {
    const s = await setup({ triage: [says(verdict(5, { duplicateOf: 3 }))] });
    await triage(s);
    await apply(s);

    expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-human"]);
    expect(triageComments(s.w, 5)[0]!.body).toContain("#3");
  });

  describe("product label", () => {
    it("is added before the issue becomes ready-for-agent, so no run starts without it", async () => {
      const s = await setup({ triage: [says(verdict(5, { product: "example" }))] });
      await triage(s);
      const order: string[] = [];
      const { addLabel, swapLabel } = s.w.tracker;
      s.w.tracker.addLabel = async (n, label) => (order.push(`add ${label}`), addLabel.call(s.w.tracker, n, label));
      s.w.tracker.swapLabel = async (n, from, to) => (order.push(`swap ${to}`), swapLabel.call(s.w.tracker, n, from, to));

      await apply(s);

      expect(order).toEqual(["add product:example", "swap ready-for-agent"]);
    });

    it("is added when the Triage names a Product that exists", async () => {
      const s = await setup({ triage: [says(verdict(5, { product: "example" }))] });
      await triage(s);
      await apply(s);

      expect(s.w.tracker.labelsOf(5).sort()).toEqual(["product:example", "ready-for-agent"]);
    });

    it("is not added for an unknown Product, nor when the issue already has one", async () => {
      const s = await setup({
        issues: [
          { number: 5, body: ISSUE_BODY, labels: explore },
          { number: 6, body: ISSUE_BODY, labels: { ...explore, "product:other": HUMAN } },
        ],
        triage: [says(verdict(5, { product: "nope" }), verdict(6, { product: "example" }))],
      });
      await triage(s);
      await apply(s);

      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
      expect(s.w.tracker.labelsOf(6).sort()).toEqual(["product:other", "ready-for-agent"]);
    });
  });

  describe("references the approach cites", () => {
    const cites = (...references: object[]) =>
      verdict(5, { approach: "Import `line7` from src/app.ts and `PASSWORD_MIN_LENGTH` from src/auth.ts.", references });
    const unchecked = "**Not found in the code (unchecked)**";

    it("a missing export is posted as unchecked, an existing one as checked with where it was found", async () => {
      const s = await setup({
        triage: [says(cites({ symbol: "line7", foundAt: "src/app.ts:7" }, { symbol: "PASSWORD_MIN_LENGTH", foundAt: "src/app.ts" }))],
      });

      await triage(s);
      await apply(s);

      const [comment] = triageComments(s.w, 5);
      const [found, notFound] = comment!.body.split(unchecked);
      expect(found).toContain("**References checked**");
      expect(found).toContain("`line7` at `src/app.ts:7`");
      expect(found).not.toContain("`PASSWORD_MIN_LENGTH` at");
      expect(notFound).toContain("`PASSWORD_MIN_LENGTH` at `src/app.ts`");
      expect(notFound).not.toContain("line7");
    });

    it("a file that does not exist, or lies outside the checkout, is unchecked", async () => {
      const s = await setup({
        triage: [says(cites({ symbol: "line7", foundAt: "src/auth.ts:3" }, { symbol: "root", foundAt: "../../../../../../etc/passwd" }))],
      });

      await triage(s);
      await apply(s);

      const [comment] = triageComments(s.w, 5);
      expect(comment!.body).not.toContain("**References checked**");
      expect(comment!.body).toContain(unchecked);
      expect(comment!.body).toContain("`line7` at `src/auth.ts:3`");
      expect(comment!.body).toContain("`root` at `../../../../../../etc/passwd`");
    });

    it("the agent cannot mark its own reference checked", async () => {
      const s = await setup({ triage: [says(cites({ symbol: "PASSWORD_MIN_LENGTH", foundAt: "src/app.ts", checked: true }))] });

      await triage(s);
      await apply(s);

      const [comment] = triageComments(s.w, 5);
      expect(comment!.body).not.toContain("**References checked**");
      expect(comment!.body).toContain(unchecked);
    });

    it("an old triage.json without references still applies", async () => {
      const s = await setup({ triage: [says(verdict(5))] });
      await triage(s);
      const file = join(s.out, "triage.json");
      const old = JSON.parse(await readFile(file, "utf8"));
      for (const v of old.issues) delete v.references;
      await writeFile(file, JSON.stringify(old));

      expect(await apply(s)).toBe(0);
      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
      expect(triageComments(s.w, 5)[0]!.body).not.toContain("References checked");
    });
  });

  describe("extraction", () => {
    it("a valid verdict needs no resume", async () => {
      const s = await setup({ triage: [() => ({ output: block(verdict(5)), usage: { inputTokens: 100, outputTokens: 10 } })] });

      await triage(s);

      expect(s.w.agent.calls[0]!.resumes).toHaveLength(0);
      const out = JSON.parse(await readFile(join(s.out, "triage.json"), "utf8"));
      expect(out.retries).toBe(0);
      expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
    });

    it("a verdict valid on the 1st resume stops there", async () => {
      const s = await setup({
        triage: [
          () => ({
            output: "no block",
            usage: { inputTokens: 100, outputTokens: 10 },
            resumes: [{ output: block(verdict(5)), usage: { inputTokens: 5, outputTokens: 1 } }, { output: "never asked" }],
          }),
        ],
      });

      await triage(s);
      await apply(s);

      expect(s.w.agent.calls[0]!.resumes).toHaveLength(1);
      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
      const out = JSON.parse(await readFile(join(s.out, "triage.json"), "utf8"));
      expect(out.usage).toEqual({ inputTokens: 105, outputTokens: 11 });
      expect(out.retries).toBe(1);
    });

    it("the tokens of failed resumes are summed too", async () => {
      const s = await setup({
        triage: [
          () => ({
            output: "no block",
            usage: { inputTokens: 100, outputTokens: 10 },
            resumes: [
              { output: "x", usage: { inputTokens: 5, outputTokens: 1 } },
              { output: "y", usage: { inputTokens: 7, outputTokens: 2 } },
            ],
          }),
        ],
      });

      await triage(s);

      const out = JSON.parse(await readFile(join(s.out, "triage.json"), "utf8"));
      expect(out.usage).toEqual({ inputTokens: 112, outputTokens: 13 });
    });

    it("resumes the session until the verdict is valid and adds the tokens", async () => {
      const s = await setup({
        triage: [
          () => ({
            output: "no block",
            usage: { inputTokens: 100, outputTokens: 10 },
            resumes: [
              { output: "<triage>not json</triage>", usage: { inputTokens: 5, outputTokens: 1 } },
              { output: block(verdict(5)), usage: { inputTokens: 7, outputTokens: 2 } },
            ],
          }),
        ],
      });

      await triage(s);
      await apply(s);

      expect(s.w.agent.calls[0]!.resumes).toHaveLength(2);
      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
      const out = JSON.parse(await readFile(join(s.out, "triage.json"), "utf8"));
      expect(out.usage).toEqual({ inputTokens: 112, outputTokens: 13 });
      expect(out.retries).toBe(2);
    });

    it("an easy-call without seams is not a valid verdict", async () => {
      const s = await setup({
        triage: [() => ({ output: block(verdict(5, { seams: [] })), resumes: [{ output: block(verdict(5)) }] })],
      });

      await triage(s);

      expect(s.w.agent.calls[0]!.resumes).toHaveLength(1);
    });

    it("after two failed resumes the fallback sends the issue to a human, never to the queue", async () => {
      const s = await setup({
        issues: [
          { number: 5, body: ISSUE_BODY, labels: explore },
          { number: 6, body: ISSUE_BODY, labels: explore },
        ],
        // The block answers #5 only; the resumes do not fix it.
        triage: [() => ({ output: block(verdict(5)), resumes: [{ output: "x" }, { output: "y" }] })],
      });
      await triage(s);
      await apply(s);

      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
      expect(s.w.tracker.labelsOf(6)).toEqual(["ready-for-human"]);
      const fallback = triageComments(s.w, 6);
      expect(fallback).toHaveLength(1);
      expect(fallback[0]!.body).toContain("no valid verdict");
    });

    it("with no block at all every issue falls back to ready-for-human, with the session's last words in the comment", async () => {
      const s = await setup({
        triage: [() => ({ output: "Seems fine to me", resumes: [{ output: "still nothing" }, { output: "nope" }] })],
      });

      await triage(s);
      await apply(s);

      expect(s.w.agent.calls[0]!.resumes).toHaveLength(2);
      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-human"]);
      const [comment] = triageComments(s.w, 5);
      expect(comment!.body).toContain("2 resumes");
      expect(comment!.body).toContain("Seems fine to me");
    });

    it("a timed-out session falls back the same way", async () => {
      const s = await setup({ triage: [() => ({ output: "", timedOut: true })] });

      await triage(s);
      await apply(s);

      expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-human"]);
      expect(triageComments(s.w, 5)[0]!.body).toContain("timed out");
    });
  });

  it("apply trusts nothing in the artifact: a bad triage.json changes nothing", async () => {
    const s = await setup({ triage: [says(verdict(5))] });
    await triage(s);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(s.out, "triage.json"), JSON.stringify({ issues: [{ number: 5, tag: "merge-it" }] }));

    await expect(apply(s)).rejects.toThrow();

    expect(s.w.tracker.labelsOf(5)).toEqual(["agent:explore"]);
  });
});

describe("factory working: the Triage", () => {
  it("marks each issue of the batch, hands the list to the end of the run, and the end clears them whatever the verdict", async () => {
    const s = await setup({
      issues: [
        { number: 5, title: "Greet", body: ISSUE_BODY, labels: explore },
        { number: 6, title: "Wave", body: ISSUE_BODY, labels: explore },
        { number: 8, title: "Untrusted", body: ISSUE_BODY, labels: { "agent:explore": "mallory" } },
      ],
      triage: [says(verdict(5), verdict(6, { tag: "blocked" }))],
    });
    const output = join(await tempDir("factory-output-"), "out");
    s.w.env.GITHUB_OUTPUT = output;

    expect(await s.w.factory("working", "on", "--triage")).toBe(0);
    expect(lastJson(s.w.logs)).toMatchObject({ working: "on", issues: [5, 6] });
    expect(await readFile(output, "utf8")).toBe("issues=5 6\n");
    expect(s.w.tracker.labelsOf(5)).toEqual(["agent:explore", "factory:working"]);
    expect(s.w.tracker.labelsOf(8)).toEqual(["agent:explore"]);

    await triage(s);
    await apply(s);
    expect(await s.w.factory("working", "off", "5", "6")).toBe(0);

    expect(s.w.tracker.labelsOf(5)).toEqual(["ready-for-agent"]);
    expect(s.w.tracker.labelsOf(6)).toEqual(["needs-info"]);
  });

  it("the end of the Triage keeps the label on an issue whose own run already started", async () => {
    const s = await setup({ triage: [says(verdict(5))] });
    await s.w.factory("working", "on", "--triage");
    await triage(s);
    await apply(s);
    // `ready-for-agent` from apply started the issue flow, which is queued.
    s.w.codeHost.runs.push({ id: 7, workflow: "factory-issue.yml", issue: 5, pr: null });

    await s.w.factory("working", "off", "5");

    expect(s.w.tracker.labelsOf(5)).toContain("factory:working");
  });
});
