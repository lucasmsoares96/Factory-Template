# Sandcastle is the Factory's engine; `claude-code-action` is out

The Factory is our own harness (`.factory/`, TypeScript) that drives Claude Code through `@ai-hero/sandcastle` (pinned, pre-1.0) with `noSandbox()` on a hosted `ubuntu-latest` runner, inside a throwaway job container. The harness owns the Stages, the five-attempt limit, the pull request and the Escalation; Sandcastle only runs one Agent session per call, as a child process with an allowlisted environment (`PATH`, `HOME`, Claude auth, `DATABASE_URL`, `CI`). Claude authenticates by `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, and every Stage uses Opus with a fresh session.

All forge work sits behind four seams with a real and a fake adapter (`Tracker`, `CodeHost`, `Agent`, `Verify`), so most behaviour is tested through the CLI against fakes and the forge adapter can be replaced (Forgejo, see `docs/forgejo.md`).

## Considered Options

- **`anthropics/claude-code-action`**: it stops at the first `result` message, so it cannot run a multi-Stage loop. It uses `GITHUB_TOKEN` (commits pushed with it fire no workflow, so CI would not run on the PR) or a Claude App, and it is GitHub only.
- **A dynamic `Workflow` run by `claude -p`**: a research preview; whether the workflow fires depends on the model, so each job would have to verify it from `stream-json`.
- **The Agent SDK as orchestrator**: it was the fallback in the research, but the engine decision keeps no alternative engine.
- **A Docker sandbox with restricted network for the agent**: wanted as future hardening, not built.

## Consequences

- Sandcastle is a library, so the loop, the limits and the PR are ours to keep correct (and to test).
- The Agent seam never resumes a session to continue work (ADR 0001).
- Sandcastle pre-1.0: bump the pinned version only after reading its release notes.
