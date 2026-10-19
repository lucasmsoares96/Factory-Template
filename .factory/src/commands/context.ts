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

/** Everything a command needs: the four seams, the configuration and a log sink. */
export interface CommandContext extends Adapters {
  config: FactoryConfig;
  log: (line: string) => void;
}
