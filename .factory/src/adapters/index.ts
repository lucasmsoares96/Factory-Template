import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapters } from "../commands/context.ts";
import type { FactoryConfig } from "../config.ts";
import { FactoryVerify } from "./factory-verify.ts";
import { LocalCodeHost } from "./local/local-code-host.ts";
import { MarkdownTracker } from "./local/markdown-tracker.ts";
import { SandcastleAgent } from "./sandcastle/agent.ts";

/**
 * Builds the real adapters selected by `FACTORY_ADAPTERS`:
 * - `local`: Markdown Tracker over `FACTORY_TRACKER_DIR`, the local CodeHost
 *   (the branch lands in `FACTORY_LOCAL_REMOTE`, default the repo itself),
 *   Sandcastle with stream-json in `FACTORY_SESSIONS_DIR`, and
 *   `pnpm factory:verify`. `pnpm factory local` sets these in the container.
 * - `github`: ticket 16.
 * Tests inject the fakes instead.
 */
export function adaptersFromEnv(
  env: Record<string, string | undefined>,
  input: { config: FactoryConfig; repo: string },
): Adapters {
  const kind = env.FACTORY_ADAPTERS;
  if (kind === "local") return localAdapters(env, input);
  throw new Error(
    kind
      ? `FACTORY_ADAPTERS=${kind} is not available yet. Known values: local, github (ticket 16).`
      : "Set FACTORY_ADAPTERS to choose the Tracker, CodeHost, Agent and Verify adapters (local, github).",
  );
}

function localAdapters(env: Record<string, string | undefined>, { config, repo }: { config: FactoryConfig; repo: string }): Adapters {
  const dir = env.FACTORY_TRACKER_DIR;
  if (!dir) throw new Error("FACTORY_ADAPTERS=local needs FACTORY_TRACKER_DIR: the issues/ directory of the feature.");
  const self = config.machineUser || "factory";
  const tracker = new MarkdownTracker({ dir, self, human: env.USER || "human" });
  return {
    tracker,
    codeHost: new LocalCodeHost({ remote: env.FACTORY_LOCAL_REMOTE || repo, from: repo, files: tracker.files, config, self }),
    agent: new SandcastleAgent({ repo, sessionsDir: env.FACTORY_SESSIONS_DIR || join(tmpdir(), "factory-sessions"), env }),
    verify: new FactoryVerify({ repo, env, echo: process.stderr }),
  };
}
