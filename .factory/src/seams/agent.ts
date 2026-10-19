/**
 * Agent seam: one fresh coding-agent session per call, never resumed.
 * Adapters: scripted fake, Sandcastle in a child process (ticket 10).
 */

export type Stage = "development" | "review";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRun {
  /** Commits the session added on top of the branch. */
  commits: number;
  /** Final message of the session. */
  output: string;
  usage: Usage;
  /** The session was stopped at its timeout. */
  timedOut: boolean;
}

export interface Agent {
  run(stage: Stage, prompt: string, options: { timeoutMs: number; model: string }): Promise<AgentRun>;
}
