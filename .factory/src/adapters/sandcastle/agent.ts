import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_ENV_ALLOWLIST, pick } from "../../env.ts";
import { Git } from "../../git.ts";
import type { Agent, AgentRun, Stage, Usage } from "../../seams/agent.ts";
import type { SessionRequest, SessionResponse } from "./session.ts";

export { AGENT_ENV_ALLOWLIST };

const SESSION_SCRIPT = fileURLToPath(new URL("./session.ts", import.meta.url));
const KILL_GRACE_MS = 5000;

export interface SandcastleAgentOptions {
  /** The working copy the sessions run and commit in. */
  repo: string;
  /** Where each session's stream-json is kept (`NN-<stage>.jsonl`). */
  sessionsDir: string;
  /** The job's env, filtered through the allowlist. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Agent seam on Sandcastle 0.12 with `noSandbox()`: the job's container or VM
 * is the sandbox. Each call is a fresh Claude Code session, run by a child
 * Node process whose env is the allowlist (noSandbox hands the agent the
 * whole env of its process). The session is killed at its timeout.
 */
export class SandcastleAgent implements Agent {
  private readonly options: SandcastleAgentOptions;
  private sessions = 0;

  constructor(options: SandcastleAgentOptions) {
    this.options = options;
  }

  async run(stage: Stage, prompt: string, options: { timeoutMs: number; model: string }): Promise<AgentRun> {
    const git = new Git(this.options.repo);
    const before = await git.head();
    await mkdir(this.options.sessionsDir, { recursive: true });
    const name = `${String(++this.sessions).padStart(2, "0")}-${stage}`;
    const streamFile = join(this.options.sessionsDir, `${name}.jsonl`);
    const request: SessionRequest = {
      cwd: this.options.repo,
      prompt,
      model: options.model,
      streamFile,
      logFile: join(this.options.sessionsDir, `${name}.log`),
      idleTimeoutSeconds: Math.ceil(options.timeoutMs / 1000),
    };

    const { response, timedOut } = await runSession(request, allowlisted(this.options.env ?? process.env), options.timeoutMs);
    if (!timedOut && !response?.ok) throw new Error(`Agent session ${name} failed: ${response?.error ?? "no response"}`);
    const stream = await readFile(streamFile, "utf8").catch(() => "");
    return { commits: await git.countCommits(before, "HEAD"), ...summarize(stream), timedOut };
  }
}

export function allowlisted(env: Record<string, string | undefined>): Record<string, string> {
  return pick(env, AGENT_ENV_ALLOWLIST);
}

/** Runs one session in its own process group, so a timeout kills the agent and everything it started. */
function runSession(
  request: SessionRequest,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ response: SessionResponse | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SESSION_SCRIPT], {
      cwd: request.cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    let timedOut = false;
    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      // The session's own children may still hold the group: end them too.
      kill("SIGKILL");
      const line = stdout.trim().split("\n").findLast((l) => l.startsWith("{"));
      resolve({ response: line ? (JSON.parse(line) as SessionResponse) : null, timedOut });
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/**
 * The final message and the token usage of a Claude Code stream-json:
 * from the `result` event, or the last assistant text when the session was cut.
 * Input tokens include cache writes and reads, so the cost estimate errs high.
 */
export function summarize(stream: string): { output: string; usage: Usage } {
  let output = "";
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (const line of stream.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      continue;
    }
    if (event.type === "assistant") {
      const text = (event.message?.content ?? []).flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
      if (text) output = text;
    } else if (event.type === "result") {
      if (typeof event.result === "string") output = event.result;
      if (event.usage) usage = tokens(event.usage);
    }
  }
  return { output, usage };
}

interface RawUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

type StreamEvent =
  | { type: "assistant"; message?: { content?: { type: string; text?: string }[] } }
  | { type: "result"; result?: string; usage?: RawUsage }
  | { type: string; message?: undefined; result?: undefined; usage?: undefined };

function tokens(u: RawUsage): Usage {
  return {
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  };
}
