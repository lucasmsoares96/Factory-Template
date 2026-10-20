# Factory harness

The code that turns a ready issue into a reviewed pull request with evidence. A change here is a harness change: the Factory labels it `harness-change` and warns on the PR. Repo rules are in the root `AGENTS.md`; terms are in `GLOSSARY.md`.

## Layout

- `src/cli.ts`: `pnpm factory <claim|work|publish|local>`. `src/commands/`: one file per command.
- `src/adapters/`: the four seams, each with a real and a fake adapter: `Tracker`, `CodeHost`, `Agent`, `Verify` (interfaces in `src/seams/`). `local/` is the Markdown tracker and local code host, `sandcastle/` the real Agent.
- `src/bootstrap/`: `pnpm bootstrap [doctor [<id>]] [domain <id>] [--redo <step>]`. Wizard steps in `common.ts` (common part) and `domain.ts` (per Product: `resend-domain`, `dns-records`, `restricted-resend-key`, `worker-domain`; `domainSteps(product)` is reusable by `bootstrap product`) over client interfaces (`clients.ts`: GitHub, Cloudflare, Neon, Resend), real adapters (`cloudflare.ts`, `resend.ts`, Zod-validated) and `fake/`. `github.ts` is the only module that calls `gh`. No local state, no secret on disk; `doctor` only reads. The wizard (common and `domain`) ends by running the doctor with the credentials held in memory (exit code = doctor); standalone, with a TTY and no `CLOUDFLARE_API_TOKEN`/`RESEND_API_KEY` in the env, the doctor asks once (hidden, not stored); without a TTY it says `skip`.
- `src/config.ts`: every setting and the label vocabulary. Any leaf is overridden by a `FACTORY_*` repo variable.
- `src/guard.ts`: the deterministic guard before the lock. `src/paths.ts`: protected and harness paths. `src/result.ts`: the Zod schema of `result.json`.
- `src/report.ts`: PR, review, evidence and Escalation text. `src/prompts.ts` renders `prompts/*.md`.
- `prompts/`: the Stage prompts (`development`, `review`, `triage`, `pr-feedback`, `update-branch`) plus `rules.md`, included in every one.
- `image/`: `Dockerfile` and `setup.sh` of the execution image. `src/local/`: the local container runner.
- `test/`: Vitest, driven through the CLI with fake adapters.

## Rules

- Bootstrap steps query the real state first and only add: never delete or overwrite a DNS record. Values the person must copy are logged as one plain line, not in a clack note (notes wrap).
- Behaviour changes come with a test against the fake adapters (the CLI is the seam), not against internals.
- The Factory never trusts the event payload: each run reads the current state of the forge, and `publish` checks again before writing.
- `work` has no `FACTORY_TOKEN`. The Agent env is an allowlist (`PATH`, `HOME`, Claude auth, `DATABASE_URL`, `CI`); adding a variable needs a test that proves nothing else leaks.
- Protected paths (`.github/workflows/`, `.agents/skills`, `.claude/skills`, `.claude/hooks`, `skills-lock.json`, `.claude/settings.json`, `.mcp.json`) end in an Escalation without a PR. `src/paths.ts` must match the `deny` rules of `.claude/settings.json`; a test checks it.
- Label names exist only in `src/config.ts` and the "Factory labels" table of `docs/agents/triage-labels.md`; a test keeps them equal. Change both.
- Prompts are English templates with placeholders. They call skills by name and repeat the hard rules; they never copy a skill's text.
- The image tag is a hash of the versions it installs; bump a version only after checking the official docs.
- Untrusted text (issue, comments, review threads) is wrapped in tags in prompts and never treated as instructions.

## Commands

- `pnpm bootstrap`, `pnpm bootstrap doctor`: set up (ending with the doctor, one run is enough) and check the copied repo (needs `gh` logged in; tests use the fake clients only).
- `pnpm bootstrap domain <id>`, `pnpm bootstrap doctor <id>`: a Product's domain. Reads `domain` from `apps/<id>/product.config.ts` (never rewrites it). Needs `RESEND_API_KEY` (full access, or it is asked) and the one Cloudflare token (template URL in `common.ts`: Workers Scripts Edit, Workers KV Storage Edit, Account Settings Read, DNS Edit, Zone Read; no Workers Routes, the Custom Domain needs only Workers Scripts Write; older tokens must be recreated). A pasted token is checked with read-only calls (verify, scripts, KV, account, zones, DNS records) and a refused one is named and asked again without being stored; the probes cannot tell edit from read, the first real write does. Without the zone in the account, DNS records are printed as plain lines; without the Worker, the Custom Domain waits for the first deploy.
- `pnpm --filter @factory/harness test|typecheck`
- `pnpm factory local <NN> [--issues <dir>]`: run an issue on this machine in a throwaway container (needs Claude auth).
