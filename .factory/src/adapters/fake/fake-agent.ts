import { MAX_EXTRACTION_RETRIES, type Agent, type AgentRun, type Extraction, type Stage, type Usage } from "../../seams/agent.ts";
import { Git } from "../../git.ts";

export interface AgentCall {
  stage: Stage;
  prompt: string;
  timeoutMs: number;
  model: string;
  /** What the harness told the session on each resume to extract the block. */
  resumes: string[];
}

/** What a resumed session answers. */
export interface ResumeStep {
  output: string;
  usage?: Usage;
  timedOut?: boolean;
}

/** What one scripted session does: change the repo in `cwd`, then report. */
type Reported = Partial<Omit<AgentRun, "commits" | "retries">> & {
  /** Answers to successive resumes, consumed while the block stays invalid. */
  resumes?: ResumeStep[];
};
export type AgentStep = (call: AgentCall & { cwd: string }) => Promise<Reported | void> | Reported | void;

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
    this.steps = {
      development: [...(script.development ?? [])],
      review: [...(script.review ?? [])],
      "pull-request": [...(script["pull-request"] ?? [])],
      triage: [...(script.triage ?? [])],
    };
  }

  async run(stage: Stage, prompt: string, options: { timeoutMs: number; model: string; extract?: Extraction }): Promise<AgentRun> {
    const { extract, ...rest } = options;
    const call: AgentCall = { stage, prompt, ...rest, resumes: [] };
    this.calls.push(call);
    const step = this.steps[stage].shift();
    if (!step) throw new Error(`FakeAgent: unscripted ${stage} session #${this.calls.length}`);
    const git = new Git(this.cwd);
    const before = await git.head();
    const reported = (await step({ ...call, cwd: this.cwd })) ?? {};
    const usage: Usage = { ...(reported.usage ?? { inputTokens: 1000, outputTokens: 100 }) };
    let output = reported.output ?? "";
    let timedOut = reported.timedOut ?? false;
    let retries = 0;
    if (extract && !timedOut && !extract.valid(output)) {
      const answers = [...(reported.resumes ?? [])];
      let current = output;
      while (retries < MAX_EXTRACTION_RETRIES && !extract.valid(current) && !timedOut) {
        const answer = answers.shift();
        if (!answer) throw new Error(`FakeAgent: unscripted resume #${retries + 1} of ${stage} session #${this.calls.length}`);
        retries++;
        call.resumes.push(extract.ask);
        usage.inputTokens += answer.usage?.inputTokens ?? 0;
        usage.outputTokens += answer.usage?.outputTokens ?? 0;
        timedOut = answer.timedOut ?? false;
        current = answer.output;
      }
      if (!timedOut && extract.valid(current)) output = current;
    }
    return { commits: await git.countCommits(before, "HEAD"), output, usage, retries, timedOut };
  }
}
