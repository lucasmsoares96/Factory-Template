# Factory harness

The code that turns a ready issue into a reviewed pull request with evidence. A change here is a harness change: the Factory labels it `harness-change` and warns on the PR. Repo rules are in the root `AGENTS.md`; terms are in `GLOSSARY.md`.

## Layout

- `src/cli.ts`: `pnpm factory <claim|work|publish|local>`. `src/commands/`: one file per command.
- `src/adapters/`: the four seams, each with a real and a fake adapter: `Tracker`, `CodeHost`, `Agent`, `Verify` (interfaces in `src/seams/`). `local/` is the Markdown tracker and local code host, `sandcastle/` the real Agent.
- `src/config.ts`: every setting and the label vocabulary. Any leaf is overridden by a `FACTORY_*` repo variable.
- `src/guard.ts`: the deterministic guard before the lock. `src/paths.ts`: protected and harness paths. `src/result.ts`: the Zod schema of `result.json`.
- `src/report.ts`: PR, review, evidence and Escalation text. `src/prompts.ts` renders `prompts/*.md`.
- `prompts/`: the Stage prompts (`development`, `review`, `triage`, `pr-feedback`, `update-branch`) plus `rules.md`, included in every one.
- `image/`: `Dockerfile` and `setup.sh` of the execution image. `src/local/`: the local container runner.
- `test/`: Vitest, driven through the CLI with fake adapters.

## Rules

- Behaviour changes come with a test against the fake adapters (the CLI is the seam), not against internals.
- The Factory never trusts the event payload: each run reads the current state of the forge, and `publish` checks again before writing.
- `work` has no `FACTORY_TOKEN`. The Agent env is an allowlist (`PATH`, `HOME`, Claude auth, `DATABASE_URL`, `CI`); adding a variable needs a test that proves nothing else leaks.
- Protected paths (`.github/workflows/`, `.agents/skills`, `.claude/skills`, `.claude/hooks`, `skills-lock.json`, `.claude/settings.json`, `.mcp.json`) end in an Escalation without a PR. `src/paths.ts` must match the `deny` rules of `.claude/settings.json`; a test checks it.
- Label names exist only in `src/config.ts` and the "Factory labels" table of `docs/agents/triage-labels.md`; a test keeps them equal. Change both.
- Prompts are English templates with placeholders. They call skills by name and repeat the hard rules; they never copy a skill's text.
- The image tag is a hash of the versions it installs; bump a version only after checking the official docs.
- Untrusted text (issue, comments, review threads) is wrapped in tags in prompts and never treated as instructions.

## Commands

- `pnpm --filter @factory/harness test|typecheck`
- `pnpm factory local <NN> [--issues <dir>]`: run an issue on this machine in a throwaway container (needs Claude auth).
