import { describe, expect, it } from "vitest";
import { labelSpecs } from "../../src/bootstrap/labels.ts";
import type { FakeGitHub } from "../../src/bootstrap/fake/fakes.ts";
import { world } from "./helpers.ts";

// The example issue at the end of `pnpm bootstrap factory`, against the fake GitHub. The fake plays the Factory through `onPoll`.
const PAT = "github_pat_owner_token";

function exampleWorld(answer: boolean | undefined = true, extra: Record<string, string | boolean | string[]> = {}) {
  const w = world({ "factory-token": PAT, ...(answer === undefined ? {} : { "example-issue": answer }), ...extra }, { CLAUDE_CODE_OAUTH_TOKEN: "x" });
  w.deps.interactive = true;
  w.deps.example = { pollMs: 30_000, timeoutMs: 120_000 };
  w.tokens.add(PAT, { push: true });
  w.github.secrets.set("CLOUDFLARE_API_TOKEN", "x");
  w.github.secrets.set("CLOUDFLARE_ACCOUNT_ID", "acc-1");
  return w;
}

type World = ReturnType<typeof exampleWorld>;

/** The Factory opens `factory/issue-N` on its second poll, with a preview comment. */
function opensReadyPr(github: FakeGitHub, poll: number) {
  if (poll !== 2) return;
  const child = [...github.subIssues][0]!.child;
  github.addRun("factory-issue.yml", { status: "in_progress", conclusion: null });
  github.branches.add(`factory/issue-${child}`);
  github.pulls.set(50, { number: 50, url: "https://github.com/owner/repo/pull/50", state: "open", head: `factory/issue-${child}` });
  github.previewComments.set(50, "<!-- factory-previews -->\nPreview: https://pr-50.example.workers.dev");
}

const nothingLeft = (w: World) => {
  expect([...w.github.issues.keys()]).toEqual([]);
  expect([...w.github.branches]).toEqual([]);
};

describe("bootstrap factory: the optional example issue", () => {
  it("asks once, defaults to No, and creates nothing when declined", async () => {
    const w = exampleWorld(false);
    const before = () => w.github.writes;

    const { code } = await w.run("factory");
    const writes = before();

    expect(code).toBe(0);
    expect(w.prompter.asked).toContain("example-issue");
    expect(w.prompter.asked.filter((id) => id === "example-issue")).toHaveLength(1);
    expect(w.github.issues.size).toBe(0);
    expect(w.github.labelEvents).toEqual([]);
    // The question says what it costs and that all is deleted.
    expect(writes).toBeGreaterThan(0);
  });

  it("asks the question with default No", async () => {
    const w = exampleWorld(false);
    let seen: { id: string; message?: string; initial?: boolean } | undefined;
    const confirm = w.prompter.confirm.bind(w.prompter);
    w.prompter.confirm = async (input: { id: string; message?: string; initial?: boolean }) => {
      seen = input;
      return confirm(input);
    };

    await w.run("factory");

    expect(seen).toMatchObject({ id: "example-issue", initial: false });
    expect(seen?.message).toMatch(/15 minutes.*Claude credits.*deleted/);
  });

  it("asks again on a repeat run: it is not a credential", async () => {
    const w = exampleWorld(false);
    await w.run("factory");
    await w.run("factory");

    expect(w.prompter.asked.filter((id) => id === "example-issue")).toHaveLength(2);
  });

  it("never asks without a terminal", async () => {
    const w = exampleWorld(undefined);
    w.deps.interactive = false;
    w.deps.env.FACTORY_TOKEN = PAT;

    const { code } = await w.run("factory");

    expect(code).toBe(0);
    expect(w.prompter.asked).not.toContain("example-issue");
  });

  it("does not ask when the doctor failed", async () => {
    const w = exampleWorld(undefined);
    w.deps.env.CLAUDE_CODE_OAUTH_TOKEN = undefined;

    const { code } = await w.run("factory");

    expect(code).toBe(1);
    expect(w.prompter.asked).not.toContain("example-issue");
  });

  it("skips and says so when there is no Product", async () => {
    const w = exampleWorld(true);
    w.products.clear();

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(output).toMatch(/no Product in apps\//);
    expect(w.github.issues.size).toBe(0);
  });

  it("asks which Product when there are several", async () => {
    const w = exampleWorld(true, { "example-product": "second" });
    w.products.set("second", { id: "second", title: "Second", emailFrom: "a <a@b.c>", domain: "b.c" });
    w.github.onPoll = (poll, github) => {
      if (poll === 1) github.issues.get([...github.subIssues][0]!.child)!.labels.push("ready-for-human");
    };

    await w.run("factory");

    expect(w.prompter.asked).toContain("example-product");
    expect(w.github.labelEvents[0]?.labels).toContain("product:second");
  });

  it("creates the parent spec and the linked child with the right sections and labels, and starts nothing itself", async () => {
    const w = exampleWorld(true);
    let snapshot: { issues: [number, { title: string; body: string; labels: string[] }][]; links: unknown; events: unknown } | undefined;
    w.github.onPoll = (poll, github) => {
      if (poll === 1) {
        snapshot = { issues: [...github.issues.entries()].map(([n, i]) => [n, { title: i.title, body: i.body, labels: [...i.labels] }]), links: [...github.subIssues], events: [...github.labelEvents] };
        github.issues.get([...github.subIssues][0]!.child)!.labels.push("ready-for-human");
      }
    };

    await w.run("factory");

    const [[parentId, parent], [childId, child]] = snapshot!.issues as unknown as [[number, { body: string; labels: string[] }], [number, { body: string; labels: string[] }]];
    expect(parent.body).toContain("## Testing Decisions");
    expect(parent.body).toContain("apps/example/e2e/");
    expect(parent.body).toContain("@evidence");
    expect(parent.body).toMatch(/Never change `packages\/skeleton`/);
    expect(child.body).toContain("## Acceptance criteria");
    expect(child.body).toContain("Part of #" + parentId);
    expect(child.body).toMatch(/Nothing under `packages\/skeleton\/` changes/);
    expect(snapshot!.links).toEqual([{ parent: parentId, child: childId }]);
    expect(child.labels).toEqual(["product:example", "ready-for-agent"]);
    expect(parent.labels).toEqual([]);
    // The label event is the only trigger, and it comes after the link.
    expect(snapshot!.events).toEqual([{ issue: childId, labels: ["product:example", "ready-for-agent"] }]);
  });

  it("writes the issues in FACTORY_LANGUAGE, with the contract headings in English", async () => {
    const w = exampleWorld(true);
    w.github.variables.set("FACTORY_LANGUAGE", "pt-BR");
    let issues: { title: string; body: string }[] = [];
    w.github.onPoll = (poll, github) => {
      if (poll === 1) {
        issues = [...github.issues.values()].map((i) => ({ title: i.title, body: i.body }));
        github.issues.get([...github.subIssues][0]!.child)!.labels.push("ready-for-human");
      }
    };

    await w.run("factory");

    const [parent, child] = issues;
    expect(parent!.title).toBe("Exemplo: mudar o título de login de Example");
    expect(parent!.body).toMatch(/^## Testing Decisions$/m);
    expect(parent!.body).toContain("Um exemplo descartável criado por `pnpm bootstrap factory`");
    expect(parent!.body).toMatch(/Nunca altere `packages\/skeleton`/);
    expect(child!.title).toBe("Exemplo: texto de boas-vindas na tela de login de Example");
    expect(child!.body).toMatch(/^## Acceptance criteria$/m);
    expect(child!.body).toContain("## O que construir");
    expect(child!.body).toMatch(/Nada em `packages\/skeleton\/` muda/);
    // The texts the issue asks for stay the same in every language: they are the Product's own messages.
    expect(child!.body).toContain('"Welcome to Example" em `en` e "Bem-vindo ao Example" em `pt-BR`');
    for (const { title, body } of issues) expect(`${title}\n${body}`).not.toMatch(/throwaway|Override|sign-in|What to build|## Goal/);
  });

  it("creates the product label when it is missing and uses the existing one otherwise", async () => {
    const w = exampleWorld(true);
    for (const l of labelSpecs(w.deps.config)) w.github.labels.set(l.name, l);
    w.github.labels.set("product:example", { name: "product:example", color: "123456", description: "mine" });
    w.github.onPoll = (poll, github) => {
      if (poll === 1) github.issues.get([...github.subIssues][0]!.child)!.labels.push("ready-for-human");
    };

    await w.run("factory");

    expect(w.github.labels.get("product:example")?.color).toBe("123456");
  });

  it("a ready PR: prints the URLs, asks, deletes everything by default and exits 0", async () => {
    const w = exampleWorld(true);
    w.github.onPoll = (poll, github) => opensReadyPr(github, poll);

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(output).toContain("https://github.com/owner/repo/pull/50");
    expect(output).toContain("https://pr-50.example.workers.dev");
    expect(w.prompter.chosen).toEqual(["example-delete"]);
    expect(w.github.pulls.get(50)?.state).toBe("closed");
    expect(output).toMatch(/Closed pull request #50 without merging/);
    expect(output).toMatch(/preview cleanup finished/);
    nothingLeft(w);
    expect(w.prompter.spun.length).toBeGreaterThan(0);
  });

  it("a ready PR kept on request: nothing is deleted, and the commands to delete it later are printed", async () => {
    const w = exampleWorld(true, { "example-delete": "keep" });
    w.github.onPoll = (poll, github) => opensReadyPr(github, poll);

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    const child = [...w.github.subIssues][0]!.child;
    expect(w.github.pulls.get(50)?.state).toBe("open");
    expect([...w.github.branches]).toEqual([`factory/issue-${child}`]);
    expect(w.github.issues.size).toBe(2);
    expect(output).toContain("The example stays.");
    expect(output).toContain("gh pr close 50 --delete-branch");
    expect(output).toContain(`gh issue delete ${child} --yes`);
  });

  it("Ctrl-C on the question deletes the example, like the default", async () => {
    const w = exampleWorld(true, { "example-delete": "cancel" });
    w.github.onPoll = (poll, github) => opensReadyPr(github, poll);

    await w.run("factory");

    expect(w.github.pulls.get(50)?.state).toBe("closed");
    nothingLeft(w);
  });

  it("an Escalation cleans up and exits non-zero", async () => {
    const w = exampleWorld(true);
    w.github.onPoll = (poll, github) => {
      if (poll === 2) github.issues.get([...github.subIssues][0]!.child)!.labels.push("ready-for-human");
    };

    const { code, output } = await w.run("factory");

    expect(code).toBe(1);
    expect(output).toMatch(/escalated/);
    expect(output).toMatch(/Factory setup itself is fine|setup itself is fine/);
    expect(w.prompter.chosen).toEqual([]);
    nothingLeft(w);
  });

  it("a failed factory-issue.yml run cleans up and exits non-zero", async () => {
    const w = exampleWorld(true);
    w.github.onPoll = (poll, github) => {
      if (poll === 2) github.addRun("factory-issue.yml", { conclusion: "failure" });
    };

    const { code, output } = await w.run("factory");

    expect(code).toBe(1);
    expect(output).toMatch(/run failure: https:\/\/github.com\/owner\/repo\/actions\/runs\//);
    nothingLeft(w);
  });

  it("a timeout cleans up, cancels the run still going and exits non-zero", async () => {
    const w = exampleWorld(true);
    w.deps.example = { pollMs: 60_000, timeoutMs: 180_000 };
    w.github.onPoll = (poll, github) => {
      if (poll === 1) github.addRun("factory-issue.yml", { status: "in_progress", conclusion: null });
    };

    const { code, output } = await w.run("factory");

    expect(code).toBe(1);
    expect(output).toMatch(/No result after 3 minutes/);
    expect(w.github.polls).toBe(4);
    expect(w.github.cancelled).toHaveLength(1);
    nothingLeft(w);
  });

  it("cleans up when the wait throws", async () => {
    const w = exampleWorld(true);
    w.github.failStatus = true;
    w.github.onPoll = (poll, github) => opensReadyPr(github, poll);

    const { code, output } = await w.run("factory");

    expect(code).toBe(1);
    expect(output).toMatch(/stopped on an error: gh pr view failed: boom/);
    expect(w.github.pulls.get(50)?.state).toBe("closed");
    nothingLeft(w);
  });

  it("Ctrl-C stops the wait and still cleans up, without the Enter prompt", async () => {
    const w = exampleWorld(true);
    const controller = new AbortController();
    const holds: boolean[] = [];
    w.deps.example = { pollMs: 30_000, timeoutMs: 120_000, interrupt: { signal: controller.signal, hold: (on) => void holds.push(on) } };
    w.github.onPoll = (poll, github) => {
      opensReadyPr(github, poll === 2 ? 2 : 0);
      if (poll === 1) controller.abort();
    };

    const { code, output } = await w.run("factory");

    expect(code).toBe(1);
    expect(output).toMatch(/Interrupted/);
    expect(w.prompter.chosen).toEqual([]);
    expect(holds).toEqual([true, false]);
    nothingLeft(w);
  });

  it("deletes the Skeleton follow-up the run opened", async () => {
    const w = exampleWorld(true);
    w.github.onPoll = (poll, github) => {
      opensReadyPr(github, poll);
      if (poll === 2) github.openSkeletonFollowUp([...github.subIssues][0]!.child);
    };
    // An unrelated issue of the repo stays.
    const other = (await w.github.createIssue({ title: "The Skeleton must grow: other", body: "needs #999", labels: [] })).number;

    await w.run("factory");

    expect([...w.github.issues.keys()]).toEqual([other]);
  });

  it("reports exactly what is left, with the command, when a deletion fails, and still deletes the rest", async () => {
    const w = exampleWorld(true);
    w.github.onPoll = (poll, github) => opensReadyPr(github, poll);
    w.github.failDeletes.add("branch:factory/issue-2");
    w.github.failDeletes.add("issue:1");

    const { code, output } = await w.run("factory");

    expect(code).toBe(0);
    expect(output).toMatch(/Some of the example is still there/);
    expect(output).toContain("the branch factory/issue-2: gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/factory/issue-2");
    expect(output).toContain("issue #1: gh issue delete 1 --yes");
    expect([...w.github.issues.keys()]).toEqual([1]);
    expect([...w.github.branches]).toEqual(["factory/issue-2"]);
    expect(w.github.pulls.get(50)?.state).toBe("closed");
  });

  it("reports a failed preview cleanup run instead of claiming everything is gone", async () => {
    const w = exampleWorld(true);
    w.github.onPoll = (poll, github) => opensReadyPr(github, poll);
    w.github.cleanupRunOnClose = false;
    const close = w.github.closePullRequest.bind(w.github);
    w.github.closePullRequest = async (pr) => {
      await close(pr);
      w.github.addRun("factory-pr-cleanup.yml", { conclusion: "failure" });
    };

    const { output } = await w.run("factory");

    expect(output).toMatch(/preview cleanup run failure/);
    expect(output).toMatch(/Neon branch preview\/pr-50 may remain/);
    nothingLeft(w);
  });

  it("never touches main", async () => {
    const w = exampleWorld(true);
    w.github.onPoll = (poll, github) => opensReadyPr(github, poll);
    await expect(w.github.deleteBranch("main")).rejects.toThrow();
    await w.run("factory");
    expect(w.github.info.defaultBranch).toBe("main");
  });
});
