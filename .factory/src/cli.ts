import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { adaptersFromEnv } from "./adapters/index.ts";
import { claim } from "./commands/claim.ts";
import type { Adapters, CommandContext } from "./commands/context.ts";
import { CLAUDE_AUTH, local } from "./commands/local.ts";
import { claimPrFeedback, claimPrUpdate, claimUpdateBranch, scanBranch, scanBranches, type PrClaim } from "./commands/pr-claim.ts";
import { merge } from "./commands/merge.ts";
import { notify } from "./commands/notify.ts";
import { publish, publishPrUpdate } from "./commands/publish.ts";
import { retro, retroCollect, retroPublish, type RunLogs } from "./commands/retro.ts";
import { GitHubRunLogs } from "./adapters/github/run-logs.ts";
import { apply, triage, triageBatch } from "./commands/triage.ts";
import { resume } from "./commands/resume.ts";
import { unblock } from "./commands/unblock.ts";
import { startWorking, stopWorking } from "./commands/working.ts";
import { resolveBase, work, type WorkFlow } from "./commands/work.ts";
import { Git } from "./git.ts";
import type { ReactionTarget } from "./seams/code-host.ts";
import { loadConfig, type FactoryConfig } from "./config.ts";
import { DockerContainerRunner, type ContainerRunner } from "./local/container.ts";
import { dockerCli } from "./local/docker.ts";

export interface FactoryDeps {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  /**
   * Built only when a command needs them; `repo` is the checkout the command works in. `jobToken`: write with the
   * job's GITHUB_TOKEN even where FACTORY_TOKEN is set (a job-token write starts no workflow).
   */
  adapters: (input: { config: FactoryConfig; repo: string; jobToken?: boolean }) => Adapters;
  /** Clock in milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Where `local` runs the work job; defaults to a Docker container. */
  container?: (config: FactoryConfig) => ContainerRunner;
  /** The runs of an issue and their artifacts, for `retro-collect`; defaults to GitHub Actions. */
  runLogs?: () => RunLogs;
}

const USAGE = `Usage: pnpm factory <command> [options]

Commands:
  claim <issue> [--event <name>]         Guard the issue and take the lock (ready-for-agent → in-progress).
                                         --event labeled: explain a Blocked Issue with one "Waiting on" comment.
  work <issue> --out <dir> [--repo <dir>] [--flow pr-feedback|update-branch --pr <n>]
                                         Run Development → Review → E2E; write result.json, the branch bundle and the prints.
                                         --flow: continue the branch of PR <n> (merge the base branch first).
  work --flow update-branch --pr <n> --out <dir> [--repo <dir>]
                                         The same update keyed by PR <n> alone (no issue): its own branch.
  pr-feedback --pr <n> --actor <login> [--event <name> --comment-id <id>]
                                         Guard a comment on a Factory PR (writer, factory/issue-N, open threads) and print the claim; the pr-feedback workflow then runs work and publish.
                                         --event (issue_comment, pull_request_review_comment, pull_request_review) and --comment-id: the comment that gets 👀 when the claim accepts.
                                         --event workflow_dispatch: the round \`resume\` starts again after the usage limit; no actor check (only writers dispatch).
  update-branch <issue>                  Guard an update of the Factory branch of an issue (in-progress, open PR).
  update-branch --pr <n>                 Guard an update keyed by PR <n> alone (open, into the base branch, not a fork).
  update-branch --scan [--repo <dir>]    After a push to the base branch: dispatch update-branch for each open PR that is
                                         behind it (Factory and people's PRs); a fork's PR gets one comment instead.
  update-branch --scan --pr <n> [--repo <dir>]
                                         When PR <n> is opened or reopened: the same scan, for that PR alone.
  publish <issue> --in <dir> [--repo <dir>] [--start-sha <sha>] [--run-url <url>] [--pr <n>]
                                         Re-check the forge, validate result.json, push with a lease, then open the
                                         PR with review and evidence, or escalate. --pr: the run continues PR <n>.
  publish --pr <n> --in <dir> [--repo <dir>] --start-sha <sha> [--run-url <url>]
                                         Publish an update keyed by PR <n> alone: push with a lease and comment on the PR only.
  local <issue> [--issues <dir>] [--repo <dir>]
                                         The issue flow on this machine for a Markdown ticket
                                         (.scratch/<feature>/issues/NN-*.md): claim and publish here, work in a
                                         throwaway Docker container. A ticket labelled agent:explore gets the Triage instead. Needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.
  triage [<issue>...] --out <dir> [--repo <dir>]
                                         The Triage, read-only: one session over the issues labelled agent:explore (or the
                                         ones given); checks the references of each verdict in the checkout; writes triage.json.
                                         Changes nothing on the forge.
  apply --in <dir> [--repo <dir>]        Apply triage.json: the marked comment, then agent:explore → ready-for-agent
                                         (easy-call), ready-for-human (needs-a-human) or needs-info (blocked); adds product:<id>.
  unblock [--issue N]                    Drop in-progress from the closed issue N, then sweep the ready-for-agent issues and start the ones whose blockers are all done.
  resume                                 Start again the work paused at the agent's usage limit (the session-limit label) whose
                                         reset has passed: the issue flow, the round on its PR, the Triage or the Retro.
  retro-collect [--issue N] [--pr N] --trigger closed|dispatch --out <dir>
                                         The automatic Retro, read-only: for a closed PR (closed), only when a writer left a
                                         thread or review on it. Writes the run's record into <dir>: the issue, the writer-only
                                         threads and reviews, and the work-out artifact of each run.
  retro --in <dir> --out <dir>           One read-only Retro session over that record (the retro skill); writes retro.json.
                                         With no valid answer it fails and nothing is published.
  retro-publish --in <dir> [--run-url <url>]
                                         Apply retro.json: create or edit the origin's Retro issue (needs-triage, retro), or
                                         comment that there is no candidate. Never applies ready-for-agent.
  notify <issue> --outcome ready|escalated [--updated] [--url <url>] [--to <login>]
                                         The Merge Gate notice: a short comment on the issue that mentions <login> and
                                         links the PR. Run with the job's GITHUB_TOKEN, not FACTORY_TOKEN.
  merge                                  The Merge Mode's decision, after a PR workflow run: in safe, merge each ready Factory
                                         PR, up to date with the base branch, when nothing protected changed, verify and the
                                         preview passed, every criterion is met and the last deploy did not fail; then label
                                         it auto-merged and comment. Reads and labels with GITHUB_TOKEN, merges and comments
                                         with FACTORY_TOKEN.
  working on|off [<issue>...] [--pr <n>] [--triage]
                                         factory:working, run with the job token: on at the start of a run, off at its end
                                         (kept where another Factory run is queued or going). An issue brings its open
                                         Factory PR along. --triage (on): the issues the Triage will read.
  help                                   Show this message.

Settings come from .factory/src/config.ts and FACTORY_* variables.`;

/** Entry point of every command; returns the process exit code. Each command prints one JSON line. */
export async function runFactory(argv: string[], deps: FactoryDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    deps.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (!["claim", "work", "publish", "local", "triage", "apply", "unblock", "pr-feedback", "update-branch", "notify", "retro-collect", "retro", "retro-publish", "working", "resume", "merge"].includes(command)) {
    deps.log(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  const { positionals, values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      repo: { type: "string", default: process.cwd() },
      out: { type: "string" },
      in: { type: "string" },
      "start-sha": { type: "string" },
      event: { type: "string" },
      "run-url": { type: "string" },
      pr: { type: "string" },
      issues: { type: "string" },
      issue: { type: "string" },
      actor: { type: "string" },
      flow: { type: "string" },
      scan: { type: "boolean" },
      outcome: { type: "string" },
      updated: { type: "boolean" },
      url: { type: "string" },
      to: { type: "string" },
      trigger: { type: "string" },
      triage: { type: "boolean" },
      "comment-id": { type: "string" },
    },
  });
  // Parsed on use: `pr-feedback` and `update-branch --scan` take no issue.
  const issueArg = () => parseIssue(positionals[0]);
  const summaryFile = deps.env.GITHUB_STEP_SUMMARY;
  const base = (config: FactoryConfig) => ({
    config,
    log: deps.log,
    now: deps.now ?? Date.now,
    stepSummary: async (markdown: string) => {
      if (summaryFile) await appendFile(summaryFile, `${markdown}\n`);
    },
  });

  if (command === "local") {
    if (!CLAUDE_AUTH.some((key) => deps.env[key])) {
      throw new Error("`factory local` needs Claude's auth: set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY.");
    }
    const config = loadConfig(deps.env);
    const container = deps.container?.(config) ?? new DockerContainerRunner({ docker: dockerCli, config, log: deps.log });
    const result = await local(base(config), issueArg(), { repo: values.repo, issues: values.issues ?? null, container, env: deps.env });
    deps.log(JSON.stringify(result));
    return 0;
  }

  const config = loadConfig(deps.env);
  const ctx: CommandContext = { ...deps.adapters({ config, repo: values.repo }), ...base(config) };

  const writeOutputs = async (claim: PrClaim) => {
    if (!deps.env.GITHUB_OUTPUT) return;
    const lines = claim.claimed
      ? [`claimed=true`, `issue=${claim.issue ?? ""}`, `pr=${claim.pr}`, `branch=${claim.branch}`, `start_sha=${claim.startSha}`]
      : [`claimed=false`, `reason=${claim.reason}`];
    await appendFile(deps.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  };

  switch (command) {
    case "pr-feedback": {
      const comment = feedbackComment(values.event, values["comment-id"]);
      const claim = await claimPrFeedback(ctx, { pr: parseIssue(values.pr), actor: values.actor ?? "", dispatched: values.event === "workflow_dispatch", ...(comment ? { comment } : {}) });
      deps.log(JSON.stringify(claim));
      await writeOutputs(claim);
      return 0;
    }
    case "update-branch": {
      if (values.scan) {
        const git = new Git(values.repo);
        const base = await resolveBase(git, config.baseBranch);
        const result = values.pr ? await scanBranch(ctx, git, base, parseIssue(values.pr)) : await scanBranches(ctx, git, base);
        deps.log(JSON.stringify(result));
        return 0;
      }
      const claim = positionals[0] === undefined && values.pr ? await claimPrUpdate(ctx, parseIssue(values.pr)) : await claimUpdateBranch(ctx, issueArg());
      deps.log(JSON.stringify(claim));
      await writeOutputs(claim);
      return 0;
    }
    case "notify": {
      const issue = issueArg();
      const outcome = values.outcome;
      if (outcome !== "ready" && outcome !== "escalated") {
        // A discarded run, or anything else without a pull request to announce, says nothing.
        deps.log(JSON.stringify({ issue, notified: false }));
        return 0;
      }
      await notify(ctx, issue, { outcome, updated: values.updated ?? false, url: values.url || null, to: values.to ?? "" });
      deps.log(JSON.stringify({ issue, notified: true }));
      return 0;
    }
    case "merge": {
      // The job token reads (`actions: read`, which the Factory's fine-grained token lacks) and labels (no workflow starts).
      const job = deps.adapters({ config, repo: values.repo, jobToken: true }).codeHost;
      const result = await merge(ctx, { reads: job, label: (pr, label) => job.labelPr(pr, label) });
      deps.log(JSON.stringify(result));
      return 0;
    }
    case "claim": {
      // Who applied `ready-for-agent`, read before the lock removes the label: the notice at the end mentions them.
      const requester = await ctx.tracker.labelActor(issueArg(), config.labels.readyForAgent);
      const result = await claim(ctx, issueArg(), { event: values.event ?? null });
      deps.log(JSON.stringify(result));
      // The workflow reads these to decide whether `work` and `publish` run, and where the lease starts.
      if (deps.env.GITHUB_OUTPUT) {
        const lines = [`claimed=${result.claimed}`, `requester=${requester ?? ""}`];
        // The open PR the claim marked factory:working: `publish` may close it (a retry), the end of the run still clears it.
        if (result.claimed) lines.push(`start_sha=${result.startSha ?? ""}`, `branch=${result.branch}`, `pr=${(await ctx.codeHost.openPrFor(result.branch).catch(() => null))?.number ?? ""}`);
        else lines.push(`reason=${result.reason}`);
        await appendFile(deps.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
      }
      return 0;
    }
    case "work": {
      // `update-branch --pr N` with no issue: keyed by the pull request.
      const issue = positionals[0] === undefined && values.flow === "update-branch" ? null : issueArg();
      const result = await work(ctx, issue, { repo: values.repo, out: required(values.out, "--out"), ...(flowOf(values) ? { flow: flowOf(values)! } : {}) });
      deps.log(JSON.stringify({ issue, outcome: result.outcome, reason: result.outcome === "paused" ? "session-limit" : result.reason, attempts: result.attempts.length, ...(result.session ? { session: result.session } : {}) }));
      return 0;
    }
    case "triage": {
      const result = await triage(ctx, { issues: positionals.map(parseIssue), out: required(values.out, "--out"), repo: values.repo });
      deps.log(JSON.stringify(result));
      return 0;
    }
    case "apply": {
      const result = await apply(ctx, { in: required(values.in, "--in"), repo: values.repo });
      deps.log(JSON.stringify(result));
      return 0;
    }
    case "retro-collect": {
      const trigger = values.trigger;
      if (trigger !== "closed" && trigger !== "dispatch") throw new Error(`Expected --trigger closed|dispatch, got: ${trigger ?? "nothing"}`);
      const result = await retroCollect(ctx, {
        issue: values.issue ? parseIssue(values.issue) : null,
        pr: values.pr ? parseIssue(values.pr) : null,
        trigger,
        out: required(values.out, "--out"),
        runLogs: deps.runLogs?.() ?? githubRunLogs(deps.env),
      });
      deps.log(JSON.stringify(result));
      if (deps.env.GITHUB_OUTPUT) await appendFile(deps.env.GITHUB_OUTPUT, `collected=${result.collected}\nissue=${result.issue ?? ""}\n`);
      return 0;
    }
    case "retro": {
      const result = await retro(ctx, { in: required(values.in, "--in"), out: required(values.out, "--out") });
      deps.log(JSON.stringify("session" in result ? { issue: result.issue, pr: result.pr, outcome: "paused", reason: "session-limit", session: result.session } : { issue: result.issue, pr: result.pr, candidates: result.candidates.length, retries: result.retries }));
      return 0;
    }
    case "retro-publish": {
      const result = await retroPublish(ctx, { in: required(values.in, "--in"), runUrl: values["run-url"] || runUrlFromEnv(deps.env) });
      deps.log(JSON.stringify(result));
      return 0;
    }
    case "working": {
      const [mode, ...numbers] = positionals;
      if (mode !== "on" && mode !== "off") throw new Error(`Expected working on|off, got: ${mode ?? "nothing"}`);
      const targets = { issues: numbers.map(parseIssue), prs: values.pr ? [parseIssue(values.pr)] : [] };
      if (mode === "on") {
        if (values.triage) targets.issues.push(...(await triageBatch(ctx)).batch);
        const result = await startWorking(ctx, targets);
        deps.log(JSON.stringify({ working: "on", ...result }));
        // The end of the run takes the label off the same issues.
        if (deps.env.GITHUB_OUTPUT) await appendFile(deps.env.GITHUB_OUTPUT, `issues=${result.issues.join(" ")}\n`);
        return 0;
      }
      const runId = Number(deps.env.GITHUB_RUN_ID);
      const result = await stopWorking(ctx, targets, Number.isInteger(runId) && runId > 0 ? runId : null);
      deps.log(JSON.stringify({ working: "off", ...result }));
      return 0;
    }
    case "resume": {
      const result = await resume(ctx);
      deps.log(JSON.stringify(result));
      return result.failed.length > 0 ? 1 : 0;
    }
    case "unblock": {
      const result = await unblock(ctx, { closed: values.issue ? parseIssue(values.issue) : undefined });
      deps.log(JSON.stringify(result));
      return result.failed.length > 0 ? 1 : 0;
    }
    default: {
      if (positionals[0] === undefined && values.pr) {
        const result = await publishPrUpdate(ctx, parseIssue(values.pr), {
          repo: values.repo,
          in: required(values.in, "--in"),
          startSha: values["start-sha"] || null,
          runUrl: values["run-url"] || runUrlFromEnv(deps.env),
        });
        deps.log(JSON.stringify(result));
        if (deps.env.GITHUB_OUTPUT) await appendFile(deps.env.GITHUB_OUTPUT, `outcome=${result.outcome}\nurl=${"url" in result ? result.url : ""}\n`);
        return 0;
      }
      const issue = issueArg();
      // The job token's code host: its writes start no workflow, and it may dispatch one (`actions: write`).
      const jobCodeHost = () => deps.adapters({ config, repo: values.repo, jobToken: true }).codeHost;
      const result = await publish(ctx, issue, {
        repo: values.repo,
        in: required(values.in, "--in"),
        startSha: values["start-sha"] || null,
        runUrl: values["run-url"] || runUrlFromEnv(deps.env),
        pr: values.pr ? parseIssue(values.pr) : null,
        markWorking: async (pr) => await jobCodeHost().labelPr(pr, config.labels.working),
        dispatchRetro: async (inputs) => await jobCodeHost().dispatch("retro", inputs),
      });
      deps.log(JSON.stringify(result));
      if (deps.env.GITHUB_OUTPUT) {
        const lines = [`outcome=${result.outcome}`, `url=${"url" in result ? (result.url ?? "") : ""}`];
        await appendFile(deps.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
      }
      return 0;
    }
  }
}

/** `--flow pr-feedback|update-branch` with the PR it continues; undefined for the issue flow. */
function flowOf(values: { flow?: string; pr?: string }): WorkFlow | undefined {
  if (values.flow === undefined) return undefined;
  if (values.flow !== "pr-feedback" && values.flow !== "update-branch") throw new Error(`Unknown --flow: ${values.flow}. Known: pr-feedback, update-branch.`);
  return { kind: values.flow, pr: parseIssue(values.pr) };
}

/** The comment or review whose event started a feedback round: the event's name and the id it carries. */
function feedbackComment(event: string | undefined, id: string | undefined): Omit<ReactionTarget, "pr"> | undefined {
  const kind = ({ issue_comment: "comment", pull_request_review_comment: "review-comment", pull_request_review: "review" } as const)[event ?? ""];
  const number = Number(id);
  return kind && Number.isInteger(number) && number > 0 ? { kind, id: number } : undefined;
}

function parseIssue(value: string | undefined): number {
  const issue = Number(value);
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`Expected an issue number, got: ${value ?? "nothing"}`);
  return issue;
}

/** The Actions run link, from the default variables of a GitHub or Forgejo runner. */
function runUrlFromEnv(env: Record<string, string | undefined>): string | null {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = env;
  return server && repo && run ? `${server}/${repo}/actions/runs/${run}` : null;
}

function githubRunLogs(env: Record<string, string | undefined>): RunLogs {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("retro-collect needs GITHUB_REPOSITORY and GITHUB_TOKEN (actions: read) to find the runs.");
  return new GitHubRunLogs({ repo, token, ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}) });
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`Missing ${flag}`);
  return value;
}

if (import.meta.main) {
  const env = process.env;
  try {
    process.exitCode = await runFactory(process.argv.slice(2), {
      env,
      log: (line) => console.log(line),
      adapters: (input) => adaptersFromEnv(env, input),
    });
  } catch (error) {
    console.error(`factory: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
