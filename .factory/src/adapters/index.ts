import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapters } from "../commands/context.ts";
import type { FactoryConfig } from "../config.ts";
import { FactoryVerify } from "./factory-verify.ts";
import { GitHubCodeHost } from "./github/github-code-host.ts";
import { GitHubTracker } from "./github/github-tracker.ts";
import { LocalCodeHost } from "./local/local-code-host.ts";
import { MarkdownTracker } from "./local/markdown-tracker.ts";
import { SandcastleAgent } from "./sandcastle/agent.ts";

/**
 * Builds the real adapters selected by `FACTORY_ADAPTERS`:
 * - `local`: Markdown Tracker over `FACTORY_TRACKER_DIR`, the local CodeHost
 *   (the branch lands in `FACTORY_LOCAL_REMOTE`, default the repo itself),
 *   Sandcastle with stream-json in `FACTORY_SESSIONS_DIR`, and
 *   `pnpm factory:verify`. `pnpm factory local` sets these in the container.
 * - `github`: the GitHub Tracker and CodeHost (REST) with the same Sandcastle Agent and `factory:verify`. The token is
 *   `FACTORY_TOKEN` (the `publish` job) or else `GITHUB_TOKEN` (`claim`, and the read-only `work`); the repo is
 *   `GITHUB_REPOSITORY`. `jobToken` takes `GITHUB_TOKEN` even next to `FACTORY_TOKEN`: `publish` labels with it.
 * Tests inject the fakes instead.
 */
export function adaptersFromEnv(
  env: Record<string, string | undefined>,
  input: { config: FactoryConfig; repo: string; jobToken?: boolean },
): Adapters {
  const kind = env.FACTORY_ADAPTERS;
  if (kind === "local") return localAdapters(env, input);
  if (kind === "github") return githubAdapters(env, input);
  throw new Error(
    kind
      ? `FACTORY_ADAPTERS=${kind} is not available. Known values: local, github.`
      : "Set FACTORY_ADAPTERS to choose the Tracker, CodeHost, Agent and Verify adapters (local, github).",
  );
}

function localAdapters(env: Record<string, string | undefined>, { config, repo }: { config: FactoryConfig; repo: string }): Adapters {
  const dir = env.FACTORY_TRACKER_DIR;
  if (!dir) throw new Error("FACTORY_ADAPTERS=local needs FACTORY_TRACKER_DIR: the issues/ directory of the feature.");
  const self = "factory";
  const tracker = new MarkdownTracker({ dir, self, human: env.USER || "human" });
  return {
    tracker,
    codeHost: new LocalCodeHost({ remote: env.FACTORY_LOCAL_REMOTE || repo, from: repo, files: tracker.files, config, self }),
    agent: new SandcastleAgent({ repo, sessionsDir: env.FACTORY_SESSIONS_DIR || join(tmpdir(), "factory-sessions"), env }),
    verify: new FactoryVerify({ repo, env, echo: process.stderr }),
  };
}

function githubAdapters(env: Record<string, string | undefined>, { config, repo, jobToken }: { config: FactoryConfig; repo: string; jobToken?: boolean }): Adapters {
  const slug = env.GITHUB_REPOSITORY;
  if (!slug) throw new Error("FACTORY_ADAPTERS=github needs GITHUB_REPOSITORY (owner/name), which GitHub Actions sets.");
  const token = jobToken ? env.GITHUB_TOKEN : env.FACTORY_TOKEN || env.GITHUB_TOKEN;
  if (!token) throw new Error("FACTORY_ADAPTERS=github needs FACTORY_TOKEN (publish) or GITHUB_TOKEN (claim, work).");
  const api = { repo: slug, token, ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}) };
  return {
    tracker: new GitHubTracker(api),
    codeHost: new GitHubCodeHost({ ...api, baseBranch: config.baseBranch, cwd: repo }),
    agent: new SandcastleAgent({ repo, sessionsDir: env.FACTORY_SESSIONS_DIR || join(tmpdir(), "factory-sessions"), env }),
    verify: new FactoryVerify({ repo, env, echo: process.stderr }),
  };
}
