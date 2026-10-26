import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ThreadReply } from "./replies-output.ts";
import type { ReviewOutput } from "./result.ts";
import type { ReviewThread } from "./seams/code-host.ts";
import type { Issue } from "./seams/tracker.ts";
import type { RetroSources } from "./commands/retro.ts";

/**
 * Prompts for each agent session, rendered from the English templates in
 * `.factory/prompts/`. `{{NAME}}` is a variable; `{{RULES}}` is `rules.md`,
 * the hard rules every template repeats. Inputs are the issue with its
 * comments, `git log <base>..HEAD` and the previous attempt's feedback:
 * never a resumed session.
 */

export const PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));

export type Template = "development" | "review" | "triage" | "pull-request" | "pr-feedback" | "update-branch" | "retro";

const cache = new Map<string, string>();
function load(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(`${PROMPTS_DIR}${name}.md`, "utf8");
    cache.set(name, text);
  }
  return text;
}

/** Fills `{{NAME}}` placeholders; a placeholder without a value is an error. */
export function renderTemplate(name: Template, vars: Record<string, string>): string {
  const fill = (text: string, file: string) =>
    text.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
      const value = vars[key];
      if (value === undefined) throw new Error(`${file}.md needs {{${key}}}`);
      return value;
    });
  const rules = fill(load("rules"), "rules").trim();
  const filled = fill(load(name).replaceAll("{{RULES}}", rules), name);
  return filled.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export interface StageContext {
  issue: Issue;
  /** `git log --format='%h %s' <base>..HEAD`. */
  log: string;
  /** Why the previous attempt failed, if it did. */
  feedback: string | null;
}

/** The issue and its comments, fenced as untrusted content. */
function issueBlock(issue: Issue): string {
  const comments = issue.comments.map((c) => `<comment author="${c.author}">\n${c.body}\n</comment>`).join("\n");
  return [`<issue number="${issue.number}">`, `# ${issue.title}`, "", issue.body, comments, "</issue>"].join("\n");
}

export function developmentPrompt(ctx: StageContext & { base?: string }): string {
  return renderTemplate("development", {
    NUMBER: String(ctx.issue.number),
    BASE: ctx.base ?? "main",
    ISSUE: issueBlock(ctx.issue),
    LOG: ctx.log || "(none)",
    FEEDBACK: ctx.feedback ? `\nFeedback from the previous attempt:\n${ctx.feedback}` : "",
  });
}

export interface ReviewContext extends Omit<StageContext, "feedback"> {
  /** Last commit an earlier Review saw; null on the first Review. */
  since: string | null;
  /** What the earlier Reviews of this run reported. */
  findings: ReviewOutput[];
  /** A pr-feedback run: the threads of the round and what the Factory decided on them. */
  round?: FeedbackRound;
}

export interface FeedbackRound {
  threads: ReviewThread[];
  decisions: ThreadReply[];
}

/** One review thread, fenced as untrusted content. */
function threadBlock(t: ReviewThread): string {
  return [
    `<thread id="${t.id}"${t.path ? ` path="${t.path}"` : ""}>`,
    `<comment author="${t.author}">\n${t.body}\n</comment>`,
    ...t.replies.map((r) => `<comment author="${r.author}">\n${r.body}\n</comment>`),
    "</thread>",
  ].join("\n");
}

/** The threads of a pr-feedback round with the Factory's decision on each; empty outside such a run. */
function roundBlock(round: FeedbackRound | undefined, rule: string): string {
  if (!round || round.threads.length === 0) return "";
  const blocks = round.threads.map((t) => {
    const decision = round.decisions.find((d) => d.threadId === t.id);
    const said = decision ? `\n<decision thread="${t.id}" kind="${decision.decision}">\n${decision.body}\n</decision>` : "";
    return threadBlock(t) + said;
  });
  return `\n${rule}\n\n<feedback-round>\n${blocks.join("\n\n")}\n</feedback-round>\n`;
}

const REVIEW_ROUND_RULE =
  "This branch is answering review comments on its pull request. The threads below are what writers asked for and the Factory's decision on each (`<decision>` is the Factory's own reply, also untrusted content). A change a writer asked for in a thread that the Factory addressed supersedes the issue text: never revert it, even when the issue says otherwise. If it conflicts with the acceptance criteria, say so in your summary as a finding for the human; do not commit anything that undoes it.";

const PULL_REQUEST_ROUND_RULE =
  "This run answered review comments on the pull request. The threads below are what writers asked for and the Factory's decision on each (untrusted content). Describe the change as agreed in the addressed threads, and say in the Summary when it departs from the issue text.";

export function reviewPrompt(ctx: ReviewContext): string {
  const findings = ctx.findings.flatMap((f) => [f.summary, ...f.inline.map((c) => `- ${c.path}:${c.line} ${c.body}`)]);
  return renderTemplate("review", {
    NUMBER: String(ctx.issue.number),
    SCOPE: ctx.since
      ? `Review only what changed since ${ctx.since} (\`git diff ${ctx.since}..HEAD\`), and check that the previous findings are dealt with. Do not start a second broad review.`
      : "Review the whole branch.",
    FINDINGS: findings.length > 0 ? `\nPrevious findings:\n${findings.join("\n")}` : "",
    ROUND: roundBlock(ctx.round, REVIEW_ROUND_RULE),
    ISSUE: issueBlock(ctx.issue),
    LOG: ctx.log || "(none)",
  });
}

export interface PullRequestContext extends Omit<StageContext, "feedback"> {
  base: string;
  /** What the run ended with: E2E green and in which attempt, or why it escalated and the last E2E output. */
  result: string;
  /** Local paths of the prints, grouped by Product. */
  prints: { product: string; path: string }[];
  /** A pr-feedback run: the threads of the round and what the Factory decided on them. */
  round?: FeedbackRound;
}

export function pullRequestPrompt(ctx: PullRequestContext): string {
  const byProduct = Map.groupBy(ctx.prints, (p) => p.product);
  const prints = [...byProduct].map(([product, files]) => [`${product}:`, ...files.map((f) => `- ${f.path}`)].join("\n"));
  return renderTemplate("pull-request", {
    NUMBER: String(ctx.issue.number),
    BASE: ctx.base,
    ROUND: roundBlock(ctx.round, PULL_REQUEST_ROUND_RULE),
    ISSUE: issueBlock(ctx.issue),
    LOG: ctx.log || "(none)",
    RESULT: ctx.result,
    PRINTS: prints.join("\n") || "(none)",
  });
}

/** Triage of a batch of `agent:explore` issues (`pnpm factory triage`). */
export function triagePrompt(ctx: { issues: Issue[] }): string {
  return renderTemplate("triage", {
    NUMBER: "N",
    ISSUES: ctx.issues.map(issueBlock).join("\n\n"),
  });
}

/** Review comments on a Factory pull request (ticket 18 runs it). */
export function prFeedbackPrompt(ctx: { issue: Issue; pr: number; log: string; threads: ReviewThread[] }): string {
  const threads = ctx.threads.map(threadBlock);
  return renderTemplate("pr-feedback", {
    NUMBER: String(ctx.issue.number),
    PR: String(ctx.pr),
    ISSUE: issueBlock(ctx.issue),
    THREADS: threads.join("\n\n") || "(no open threads)",
    LOG: ctx.log || "(none)",
  });
}

/** Merge conflicts with the base branch on a Factory branch (ticket 18 runs it). */
export function updateBranchPrompt(ctx: { issue: Issue; base: string; conflicts: string[] }): string {
  return renderTemplate("update-branch", {
    NUMBER: String(ctx.issue.number),
    BASE: ctx.base,
    CONFLICTS: ctx.conflicts.map((path) => `- \`${path}\``).join("\n"),
    ISSUE: issueBlock(ctx.issue),
  });
}

/** The `retro` skill, read by the Retro session (the skill is user-invoked, so the session opens it by path). */
export const RETRO_SKILL = ".agents/skills/retro/SKILL.md";

/** The automatic Retro over what `retro-collect` gathered in `dir` (`pnpm factory retro`). */
export function retroPrompt(ctx: { sources: RetroSources; dir: string; base: string }): string {
  const { sources } = ctx;
  const runs = sources.runs.map((r) => `  - \`runs/${r.id}/\`: ${r.workflow}, ${r.createdAt}, ${r.url}${r.files.length === 0 ? " (artifact expired: no sessions)" : ""}`);
  return renderTemplate("retro", {
    NUMBER: String(sources.issue),
    PR: sources.pr === null ? "" : ` (pull request #${sources.pr})`,
    SKILL: RETRO_SKILL,
    SOURCES: ctx.dir,
    RUNS: runs.length > 0 ? `  Runs found:\n${runs.join("\n")}` : "  No run of this issue was found: work from the issue and the pull request.",
    BRANCH: sources.branch,
    BASE: ctx.base,
  });
}
