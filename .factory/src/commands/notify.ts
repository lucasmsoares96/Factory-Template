import type { CommandContext } from "./context.ts";

export interface NotifyInput {
  outcome: "ready" | "escalated";
  /** The PR was already open: the round answered comments instead of opening it. */
  updated: boolean;
  url: string | null;
  /** Login of whoever started the run (applied `ready-for-agent`, or wrote the comment). Empty: nobody is mentioned. */
  to: string;
}

/** A GitHub login: letters, digits and dashes. Anything else could smuggle another mention or Markdown into the comment. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * The Merge Gate notice: one short comment on the issue, written with the job's own `GITHUB_TOKEN` (the CLI is run with
 * no `FACTORY_TOKEN`). GitHub notifies nobody of what the Factory writes as its owner, and a comment made with
 * `GITHUB_TOKEN` fires no workflow, so it can start no loop.
 */
export async function notify(ctx: Pick<CommandContext, "tracker">, issue: number, input: NotifyInput): Promise<void> {
  if (input.to !== "" && !LOGIN.test(input.to)) throw new Error(`Not a GitHub login: ${JSON.stringify(input.to)}`);
  const mention = input.to ? `@${input.to} ` : "";
  const link = input.url ? `: ${input.url}` : ".";
  const text =
    input.outcome === "escalated"
      ? `${mention}the Factory could not finish this issue and left what it has${input.url ? ` in a draft pull request: ${input.url}` : " (see the Escalation comment)."}`
      : input.updated
        ? `${mention}the Factory pushed the answers to your comments to the pull request${link}`
        : `${mention}the Factory opened a pull request for this issue and it is ready for review${link}`;
  await ctx.tracker.comment(issue, text);
}
