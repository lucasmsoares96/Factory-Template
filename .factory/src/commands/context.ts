import type { FactoryConfig } from "../config.ts";
import type { Agent } from "../seams/agent.ts";
import type { CodeHost } from "../seams/code-host.ts";
import type { Tracker } from "../seams/tracker.ts";
import type { Verify } from "../seams/verify.ts";

/** The four seams. */
export interface Adapters {
  tracker: Tracker;
  codeHost: CodeHost;
  agent: Agent;
  verify: Verify;
}

/** Everything a command needs: the four seams, the configuration, a clock and the outputs. */
export interface CommandContext extends Adapters {
  config: FactoryConfig;
  log: (line: string) => void;
  /** Milliseconds; the global time limit and Stage durations are measured with it. */
  now: () => number;
  /** Appends Markdown to the job summary (`$GITHUB_STEP_SUMMARY`), when there is one. */
  stepSummary: (markdown: string) => Promise<void>;
}
