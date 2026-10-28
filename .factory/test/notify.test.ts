import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { GitHubTracker } from "../src/adapters/github/github-tracker.ts";
import { FACTORY_MARKER } from "../src/marker.ts";
import { HUMAN, lastJson, tempDir, unmarked, world } from "./helpers.ts";
import { FakeGitHubServer } from "./github/fake-github.ts";

// The Merge Gate notice: GitHub notifies nobody of the Actions' own comments, and the Factory writes as the owner, so the
// short comment that tells the requester the PR is ready leaves through the job's GITHUB_TOKEN (github-actions[bot]).
describe("factory notify", () => {
  it("comments on the issue, mentioning the requester and linking the opened PR", async () => {
    const w = world();

    expect(await w.factory("notify", "7", "--outcome", "ready", "--url", "https://github.com/o/r/pull/9", "--to", HUMAN)).toBe(0);

    const [comment] = w.tracker.commentsOn(7);
    expect(unmarked(comment!.body)).toBe(`@${HUMAN} the Factory opened a pull request for this issue and it is ready for review: https://github.com/o/r/pull/9`);
    expect(comment!.body).toContain(FACTORY_MARKER);
    expect(lastJson(w.logs)).toEqual({ issue: 7, notified: true });
  });

  it("tells an update of the PR and an Escalation apart", async () => {
    const w = world();

    await w.factory("notify", "7", "--outcome", "ready", "--updated", "--url", "https://github.com/o/r/pull/9", "--to", HUMAN);
    await w.factory("notify", "7", "--outcome", "escalated", "--url", "https://github.com/o/r/pull/9", "--to", HUMAN);

    const [updated, escalated] = w.tracker.commentsOn(7).map((c) => unmarked(c.body));
    expect(updated).toContain("pushed the answers to your comments");
    expect(escalated).toContain("could not finish");
    expect(escalated).toContain("https://github.com/o/r/pull/9");
  });

  it("mentions nobody when the requester is unknown, and refuses a login that is not a login", async () => {
    const w = world();

    await w.factory("notify", "7", "--outcome", "ready", "--url", "https://github.com/o/r/pull/9");
    expect(unmarked(w.tracker.commentsOn(7)[0]!.body)).not.toContain("@");

    await expect(w.factory("notify", "7", "--outcome", "ready", "--url", "u", "--to", "x\n@everyone")).rejects.toThrow(/login/);
    expect(w.tracker.commentsOn(7)).toHaveLength(1);
  });

  it("follows FACTORY_LANGUAGE=pt-BR for every outcome, keeping the mention and the link", async () => {
    const w = world({ env: { FACTORY_LANGUAGE: "pt-BR" } });
    const url = "https://github.com/o/r/pull/9";

    await w.factory("notify", "7", "--outcome", "ready", "--url", url, "--to", HUMAN);
    await w.factory("notify", "7", "--outcome", "ready", "--updated", "--url", url, "--to", HUMAN);
    await w.factory("notify", "7", "--outcome", "escalated", "--url", url, "--to", HUMAN);
    await w.factory("notify", "7", "--outcome", "escalated");

    const comments = w.tracker.commentsOn(7);
    expect(comments.map((c) => unmarked(c.body))).toEqual([
      `@${HUMAN} a Factory abriu um pull request para esta issue e ele está pronto para revisão: ${url}`,
      `@${HUMAN} a Factory enviou ao pull request as respostas aos seus comentários: ${url}`,
      `@${HUMAN} a Factory não conseguiu concluir esta issue e deixou o que tem em um pull request rascunho: ${url}`,
      "a Factory não conseguiu concluir esta issue e deixou o que tem (veja o comentário da Escalation).",
    ]);
    for (const c of comments) expect(c.body).toContain(FACTORY_MARKER);
  });

  it("is English without FACTORY_LANGUAGE, for every outcome", async () => {
    const w = world();
    const url = "https://github.com/o/r/pull/9";

    await w.factory("notify", "7", "--outcome", "ready", "--updated", "--url", url, "--to", HUMAN);
    await w.factory("notify", "7", "--outcome", "escalated", "--url", url, "--to", HUMAN);
    await w.factory("notify", "7", "--outcome", "escalated");

    expect(w.tracker.commentsOn(7).map((c) => unmarked(c.body))).toEqual([
      `@${HUMAN} the Factory pushed the answers to your comments to the pull request: ${url}`,
      `@${HUMAN} the Factory could not finish this issue and left what it has in a draft pull request: ${url}`,
      "the Factory could not finish this issue and left what it has (see the Escalation comment).",
    ]);
  });

  it("says nothing for a discarded run", async () => {
    const w = world();

    expect(await w.factory("notify", "7", "--outcome", "discarded", "--to", HUMAN)).toBe(0);

    expect(w.tracker.commentsOn(7)).toEqual([]);
    expect(lastJson(w.logs)).toEqual({ issue: 7, notified: false });
  });

  it("the GitHub adapter posts it as a plain issue comment with the job token, which fires no workflow", async () => {
    const s = new FakeGitHubServer();
    s.on("POST", "/repos/o/r/issues/7/comments", () => ({ status: 201, json: {} }));
    const { notify } = await import("../src/commands/notify.ts");
    const tracker = new GitHubTracker({ repo: "o/r", token: "job-token", fetch: s.fetch });

    await notify({ tracker, config: loadConfig({}) }, 7, { outcome: "ready", updated: false, url: "https://github.com/o/r/pull/9", to: "alice" });

    expect(s.writes()).toEqual(["POST /repos/o/r/issues/7/comments"]);
    expect(s.calls[0]!.headers.get("authorization")).toBe("Bearer job-token");
    expect(String((s.calls[0]!.body as { body: string }).body)).toContain("@alice");
  });

  it("the claim step writes who applied ready-for-agent, before the lock removes the label", async () => {
    const w = world();
    const out = join(await tempDir("factory-output-"), "output");
    await writeFile(out, "");
    w.env.GITHUB_OUTPUT = out;

    await w.factory("claim", "7");

    expect(await readFile(out, "utf8")).toContain(`requester=${HUMAN}\n`);
  });
});
