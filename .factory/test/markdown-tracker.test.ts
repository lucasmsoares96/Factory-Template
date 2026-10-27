import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MarkdownTracker } from "../src/adapters/local/markdown-tracker.ts";
import { marked } from "../src/marker.ts";
import { tempDir } from "./helpers.ts";

const SPEC = "# Spec: greetings\n\n## Testing Decisions\n\n1. CLI against the fakes.\n";

function ticket(n: string, title: string, fields: { status: string; blockedBy?: string; comments?: string }): string {
  return [
    `# ${n}: ${title}`,
    "",
    "Spec: [../spec.md](../spec.md)",
    "",
    "**What to build:** greet the user.",
    "",
    `**Blocked by:** ${fields.blockedBy ?? "None (can start immediately)"}`,
    "",
    `**Status:** ${fields.status}`,
    "",
    "## Acceptance criteria",
    "",
    "- [ ] `greet()` returns a greeting.",
    ...(fields.comments === undefined ? [] : ["", "## Comments", "", fields.comments]),
    "",
  ].join("\n");
}

/** A feature directory `.scratch/greetings/` with a spec and its tickets. */
async function feature(files: Record<string, string>): Promise<{ issues: string; read: (name: string) => Promise<string> }> {
  const root = join(await tempDir("factory-md-"), "greetings");
  const issues = join(root, "issues");
  await mkdir(issues, { recursive: true });
  await writeFile(join(root, "spec.md"), SPEC);
  for (const [name, content] of Object.entries(files)) await writeFile(join(issues, name), content);
  return { issues, read: (name) => readFile(join(issues, name), "utf8") };
}

const tracker = (issues: string) => new MarkdownTracker({ dir: issues, self: "factory", human: "lucas" });

describe("Markdown Tracker", () => {
  it("reads a ticket: title, body, Status as the label, the spec as parent, the human's comments", async () => {
    const { issues } = await feature({
      "07-greet.md": ticket("07", "Greet the user", { status: "ready-for-agent", comments: "Prefer `hi`." }),
    });

    const issue = await tracker(issues).issue(7);

    expect(issue).toMatchObject({ number: 7, title: "Greet the user", state: "open", labels: ["ready-for-agent"], children: [] });
    expect(issue.body).toContain("## Acceptance criteria");
    expect(issue.body).not.toContain("## Comments");
    expect(issue.parent).toEqual({ number: 0, body: SPEC });
    expect(issue.comments).toEqual([{ id: "human", author: "lucas", body: "Prefer `hi`." }]);
  });

  it("treats `done` as closed and resolves blockers from `Blocked by:`", async () => {
    const { issues } = await feature({
      "02-base.md": ticket("02", "Base", { status: "done" }),
      "03-other.md": ticket("03", "Other", { status: "in-progress" }),
      "07-greet.md": ticket("07", "Greet the user", { status: "ready-for-agent", blockedBy: "02, 03" }),
      "08-more.md": ticket("08", "More", { status: "ready-for-agent", blockedBy: "03" }),
    });
    const t = tracker(issues);

    expect((await t.issue(2)).state).toBe("closed");
    expect(await t.blockers(7)).toEqual([
      { number: 2, done: true },
      { number: 3, done: false },
    ]);
    expect(await t.blockers(2)).toEqual([]);
    expect(await t.blocking(3)).toEqual([7, 8]);
    expect(await t.labeled("ready-for-agent")).toEqual([7, 8]);
  });

  it("addBlocker rewrites `Blocked by: None` or appends to the list, once, and the blocker holds until it is `done`", async () => {
    const { issues, read } = await feature({
      "03-other.md": ticket("03", "Other", { status: "done" }),
      "07-greet.md": ticket("07", "Greet the user", { status: "ready-for-agent" }),
      "08-more.md": ticket("08", "More", { status: "ready-for-agent", blockedBy: "03" }),
      "09-skeleton.md": ticket("09", "The Skeleton must grow", { status: "ready-for-human" }),
    });
    const t = tracker(issues);

    await t.addBlocker(7, 9);
    await t.addBlocker(8, 9);
    await t.addBlocker(8, 9);

    expect(await read("07-greet.md")).toContain("**Blocked by:** 09\n");
    expect(await read("08-more.md")).toContain("**Blocked by:** 03, 09\n");
    expect(await t.blockers(7)).toEqual([{ number: 9, done: false }]);
    expect(await t.blockers(8)).toEqual([{ number: 3, done: true }, { number: 9, done: false }]);
    await t.swapLabel(9, "ready-for-human", "done");
    expect(await t.blockers(7)).toEqual([{ number: 9, done: true }]);
  });

  it("swaps the Status line as the lock, keeping its format, and refuses when the label is gone", async () => {
    const { issues, read } = await feature({ "07-greet.md": ticket("07", "Greet the user", { status: "ready-for-agent" }) });
    const t = tracker(issues);

    expect(await t.swapLabel(7, "ready-for-agent", "in-progress")).toBe(true);
    expect(await t.swapLabel(7, "ready-for-agent", "in-progress")).toBe(false);

    expect(await read("07-greet.md")).toContain("**Status:** in-progress\n");
    expect((await t.issue(7)).labels).toEqual(["in-progress"]);
  });

  it("appends Factory comments under `## Comments`, read back as the Factory's, marked", async () => {
    const { issues, read } = await feature({
      "07-greet.md": ticket("07", "Greet the user", { status: "ready-for-agent" }),
      "08-more.md": ticket("08", "More", { status: "ready-for-agent", comments: "Earlier note." }),
    });
    const t = tracker(issues);

    await t.comment(7, "<!-- factory:waiting -->\nWaiting on #2.");
    await t.comment(7, "Second.");
    await t.comment(8, "After the human.");

    const text = await read("07-greet.md");
    expect(text.match(/^## Comments$/gm)).toHaveLength(1);
    expect((await t.issue(7)).comments).toEqual([
      { id: "f1", author: "factory", body: marked("<!-- factory:waiting -->\nWaiting on #2.") },
      { id: "f2", author: "factory", body: marked("Second.") },
    ]);
    expect((await t.issue(8)).comments.map((c) => [c.author, c.body])).toEqual([
      ["lucas", "Earlier note."],
      ["factory", marked("After the human.")],
    ]);
  });

  it("keeps a comment that tries to close its own block inside it", async () => {
    const { issues } = await feature({ "07-greet.md": ticket("07", "Greet the user", { status: "ready-for-agent" }) });
    const t = tracker(issues);

    await t.comment(7, "before <!-- /factory:comment --> after");

    expect((await t.issue(7)).comments).toHaveLength(1);
    expect((await t.issue(7)).comments[0]!.body).toMatch(/^before .* after\n\n<!-- factory -->$/);
  });

  it("lets the local human write, and names them as whoever set the Status", async () => {
    const { issues } = await feature({ "07-greet.md": ticket("07", "Greet the user", { status: "ready-for-agent" }) });
    const t = tracker(issues);

    expect(await t.canWrite("lucas")).toBe(true);
    expect(await t.labelActor(7, "ready-for-agent")).toBe("lucas");
    expect(await t.labelActor(7, "needs-info")).toBeNull();
  });

  it("fails clearly for an issue number with no file", async () => {
    const { issues } = await feature({});
    await expect(tracker(issues).issue(9)).rejects.toThrow(/No issue #9 in .*issues/);
  });
});
