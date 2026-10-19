import type { Agent, AgentRun, Stage, Usage } from "../../seams/agent.ts";
import { Git } from "../../git.ts";

export interface AgentCall {
  stage: Stage;
  prompt: string;
  timeoutMs: number;
  model: string;
}

/** What one scripted session does: change the repo in `cwd`, then report. */
export type AgentStep = (call: AgentCall & { cwd: string }) =>
  | Promise<Partial<Omit<AgentRun, "commits">> | void>
  | Partial<Omit<AgentRun, "commits">>
  | void;

/**
 * Scripted Agent. Each call to `run` consumes the next step scripted for its
 * Stage; an unscripted call fails the test. Commits are counted from the repo,
 * as the real adapter does.
 */
export class FakeAgent implements Agent {
  readonly calls: AgentCall[] = [];
  private readonly cwd: string;
  private readonly steps: Record<Stage, AgentStep[]>;

  constructor(cwd: string, script: Partial<Record<Stage, AgentStep[]>>) {
    this.cwd = cwd;
    this.steps = { development: [...(script.development ?? [])], review: [...(script.review ?? [])] };
  }

  async run(stage: Stage, prompt: string, options: { timeoutMs: number; model: string }): Promise<AgentRun> {
    const call = { stage, prompt, ...options };
    this.calls.push(call);
    const step = this.steps[stage].shift();
    if (!step) throw new Error(`FakeAgent: unscripted ${stage} session #${this.calls.length}`);
    const git = new Git(this.cwd);
    const before = await git.head();
    const reported = (await step({ ...call, cwd: this.cwd })) ?? {};
    const usage: Usage = reported.usage ?? { inputTokens: 1000, outputTokens: 100 };
    return {
      commits: await git.countCommits(before, "HEAD"),
      output: reported.output ?? "",
      usage,
      timedOut: reported.timedOut ?? false,
    };
  }
}
