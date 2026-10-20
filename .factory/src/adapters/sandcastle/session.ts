import { appendFileSync } from "node:fs";
import { claudeCode, run } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

/**
 * One agent session, in the child process the Sandcastle Agent spawns with
 * the allowlisted env. Reads a SessionRequest on stdin, runs Claude Code
 * headless in `cwd` through Sandcastle, appends every raw stream-json line to
 * `streamFile` and prints a SessionResponse.
 */

export interface SessionRequest {
  cwd: string;
  prompt: string;
  model: string;
  /** Raw stream-json of the session, one event per line. */
  streamFile: string;
  /** Sandcastle's own progress log. */
  logFile: string;
  /** Sandcastle stops a silent agent after this long; the parent enforces the Stage timeout. */
  idleTimeoutSeconds: number;
}

export type SessionResponse = { ok: true } | { ok: false; error: string };

async function main(): Promise<SessionResponse> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as SessionRequest;
  appendFileSync(request.streamFile, "");
  try {
    await run({
      // The session file stays in the agent's HOME; the stream-json above is what the job keeps.
      agent: claudeCode(request.model, { captureSessions: false }),
      sandbox: noSandbox(),
      cwd: request.cwd,
      prompt: request.prompt,
      name: "factory",
      // Commit straight on the branch the harness checked out.
      branchStrategy: { type: "head" },
      maxIterations: 1,
      idleTimeoutSeconds: request.idleTimeoutSeconds,
      logging: {
        type: "file",
        path: request.logFile,
        onAgentStreamEvent: (event) => {
          if (event.type === "raw") appendFileSync(request.streamFile, `${event.line}\n`);
        },
      },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

if (import.meta.main) {
  const response = await main();
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = response.ok ? 0 : 1;
}
