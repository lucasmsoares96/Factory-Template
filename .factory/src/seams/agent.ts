/**
 * Agent seam: one fresh coding-agent session per call. A session is never
 * resumed to continue the work, only to extract its output: when the caller
 * passes `extract` and the final message has no valid block, the adapter
 * resumes the same session and asks for the block again, up to
 * `MAX_EXTRACTION_RETRIES` times, inside the call's timeout.
 * Adapters: scripted fake, Sandcastle in a child process (ticket 10).
 */

export const MAX_EXTRACTION_RETRIES = 2;

/** The block a caller expects at the end of the session's final message. */
export interface Extraction {
  /** True when the message carries a valid block. */
  valid(output: string): boolean;
  /** What to tell the resumed session. */
  ask: string;
}

export type Stage = "development" | "review" | "pull-request" | "triage" | "retro";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRun {
  /** Commits the session added on top of the branch. */
  commits: number;
  /** Final message of the session (the first one when no resume produced a valid block). */
  output: string;
  /** Tokens of the session and of every resume. */
  usage: Usage;
  /** How many times the session was resumed to extract the block. */
  retries: number;
  /** The session was stopped at its timeout. */
  timedOut: boolean;
}

export interface Agent {
  run(stage: Stage, prompt: string, options: { timeoutMs: number; model: string; extract?: Extraction }): Promise<AgentRun>;
}

/**
 * A session that ended in error, not at its timeout. The caller keeps what the session committed and reports
 * `message`, the agent's own words, instead of failing the job.
 */
export class AgentSessionError extends Error {
  override name = "AgentSessionError";
}

/**
 * The agent's account hit its usage limit (Claude Code: "You've hit your session limit · resets 3:20pm (UTC)").
 * `resetsAt` is the reset time as the agent wrote it, null when it gave none: the run waits for it and starts again.
 */
export class SessionLimitError extends AgentSessionError {
  override name = "SessionLimitError";
  readonly resetsAt: string | null;

  constructor(message: string, resetsAt: string | null) {
    super(message);
    this.resetsAt = resetsAt;
  }
}
