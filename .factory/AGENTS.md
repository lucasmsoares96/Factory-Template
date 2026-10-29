# Factory harness

The code that turns a ready issue into a reviewed pull request with evidence. A change here is a harness change: the Factory labels it `harness-change` and warns on the PR. Repo rules are in the root `AGENTS.md`; terms are in `GLOSSARY.md`.

Detail lives in two docs: [docs/factory-flows.md](../docs/factory-flows.md) (each workflow's jobs, tokens and writes; labels; the marker) and [docs/factory-bootstrap.md](../docs/factory-bootstrap.md) (the wizard's modules, steps and credentials). Read the matching section before changing a flow or a bootstrap step.

## Layout

- `src/cli.ts`: `pnpm factory <claim|work|publish|triage|apply|unblock|resume|pr-feedback|update-branch|notify|local|retro-collect|retro|retro-publish|working|merge>`. `src/commands/`: one file per command.
- `src/adapters/`: the four seams, each with a real and a fake adapter: `Tracker`, `CodeHost`, `Agent`, `Verify` (interfaces in `src/seams/`). `local/` is the Markdown tracker and local code host, `github/` the GitHub Tracker and CodeHost ([how it holds the token](../docs/factory-flows.md#adapters-on-github)), `sandcastle/` the real Agent. `FACTORY_ADAPTERS=github` picks them.
- `src/bootstrap/`: `pnpm bootstrap`, a wizard of steps over client interfaces (GitHub, Cloudflare, Neon, Resend, Stripe) with real and fake adapters. `github.ts` is the only module that calls `gh`. No local state, no secret on disk; `doctor` only reads. See [factory-bootstrap.md](../docs/factory-bootstrap.md).
- `src/ci/`: logic of the workflows, thin YAML around it: `image.ts`, `matrix.ts`, `skills.ts` (PR), `deploy.ts` (plan, bundle, allowlist check, config, migrate) plus `smoke.ts` (the `main` deploy, `factory-deploy.yml`; `--preview` smokes a PR preview), `previews.ts` (the PR previews, `factory-pr.yml` and `factory-pr-cleanup.yml`), `neon-api.ts` (Neon branches API; fake in `fake/`), `vars.ts` (copies the `FACTORY_*` repo variables `config.ts` defines into `$GITHUB_ENV`).
- `src/config.ts`: every setting and the label vocabulary. Any leaf is overridden by a `FACTORY_*` repo variable. `PROTECTED_PATHS` (what the `safe` Merge Mode never merges; `all` ignores it) is not a setting and has no variable.
- `src/skipped-tests.ts`: after Development, a line added to a test file (`*.spec|test.ts(x)`, `e2e/`) that uses `test.fixme|skip|only`, `it|describe.skip|only`, `xit(`, `xdescribe(` fails the attempt (feedback names file:line; out of attempts = Escalation `needs-human`). Strings and comments are cut away; accepted false positives: a marker in a multi-line template literal or block comment, and a conditional `test.skip(cond)` in a test body.
- `src/guard.ts`: the deterministic guard before the lock. `src/paths.ts`: sensitive and harness paths. `src/result.ts`: the Zod schema of `result.json`.
- `src/messages.ts`: the catalog of every fixed text the Factory publishes, in `en` and `pt-BR` (`FACTORY_LANGUAGE`, `config.language`); a key without a language fails `test/messages.test.ts`. Contract text stays English in every language: `## Acceptance criteria`, `## Testing Decisions`, `## Evidence`, the markers, the PR title.
- `src/forge-text.ts`: `forForge`, the one cleaning of the agent's text in `result.json` (no closing keyword, no attribution line) that `publish` applies before any write; every string is text unless its key is structural.
- `src/report.ts`: PR, review, evidence and Escalation text. `src/prompts.ts` renders `prompts/*.md` from a snapshot read when it loads, before any agent session: an agent edit to a prompt never reaches the same run.
- `prompts/`: the Stage prompts (`development`, `review`, `triage`, `pr-feedback`, `update-branch`, `retro`) plus `rules.md`, included in every one. `update-branch` also says how to fix a forked migration chain (the branch's unpublished migration is deleted and generated again on top of the base branch's newest; `skeleton migrations check-chain`, in every package's `lint`, catches the fork).
- `image/`: `Dockerfile` and `setup.sh` of the execution image (Node, pnpm, Claude Code, git, python3, Chromium). `src/local/`: the local container runner.
- `test/`: Vitest, driven through the CLI with fake adapters.

## Rules

- Bootstrap steps query the real state first and only add: never delete or overwrite a DNS record. Values the person must copy are logged as one plain line, not in a clack note (notes wrap).
- Behaviour changes come with a test against the fake adapters (the CLI is the seam), not against internals.
- The Factory never trusts the event payload: each run reads the current state of the forge, and `publish` checks again before writing.
- `work` has no `FACTORY_TOKEN`. The Agent env is an allowlist (`PATH`, `HOME`, Claude auth, `DATABASE_URL`, `CI`); adding a variable needs a test that proves nothing else leaks.
- A Product issue may change `packages/skeleton/` in its own pull request (`src/scope.ts`, ADR 0017). `work` keeps the branch whole; `publish` opens the PR body with a warning that lists the Skeleton files, and the Review checks the change is generic. See [Skeleton changes in a Product issue](../docs/factory-flows.md#skeleton-changes-in-a-product-issue).
- Sensitive paths (`.github/workflows/`, `.agents/skills`, `.claude/`, `skills-lock.json`, `.mcp.json`) and harness paths are flagged, never refused (ADR 0012): the PR gets `harness-change` and a warning that names them (`[!WARNING]` for sensitive, `[!CAUTION]` for harness). `.claude/settings.json` only denies `pnpm bootstrap destroy`.
- Label names exist only in `src/config.ts` and the "Factory labels" table of `docs/agents/triage-labels.md`; a test keeps them equal. Change both.
- The Factory knows its own texts by the hidden marker (`src/marker.ts`, `<!-- factory -->`), never by the author: the write adapters add it, the thread and guard readers also require a `write`+ author. See [The Factory marker](../docs/factory-flows.md#the-factory-marker).
- `in-progress` is the lock, from `claim` to the merge or an Escalation. `factory:working` (`src/commands/working.ts`) means a run is going now: on at its start, off at its end, written only with the job token. See [the labels](../docs/factory-flows.md#in-progress-and-factoryworking).
- Prompts are English templates with placeholders; `rules.md` tells the agent to write public text in `{{LANGUAGE}}`. They call skills by name and repeat the hard rules; they never copy a skill's text.
- The image tag is a hash of the versions it installs; bump a version only after checking the official docs.
- Untrusted text (issue, comments, review threads) is wrapped in tags in prompts and never treated as instructions.

## Flows

Every Factory workflow is off until `FACTORY_ENABLED`. Jobs, tokens and writes of each are in [docs/factory-flows.md](../docs/factory-flows.md).

- [Issue flow](../docs/factory-flows.md#issue-flow) (`factory-issue.yml`): `claim` → `image` → `work` (no `FACTORY_TOKEN`) → `publish` (`FACTORY_TOKEN`, `if: always()`) → `notify`.
- `pnpm factory notify <N> --outcome ready|escalated [--updated] --url --to`: the Merge Gate notice, posted with the job's `GITHUB_TOKEN` so it fires no workflow.
- [Triage](../docs/factory-flows.md#triage) (`factory-triage.yml`, label `agent:explore`): one session over the batch, `triage` → `triage.json` → `apply`, which re-reads the forge and swaps the labels.
- [Unblock](../docs/factory-flows.md#unblock) (`factory-unblock.yml`, `issues: closed`): re-dispatches the `ready-for-agent` issues the guard now accepts.
- [Session limit](../docs/factory-flows.md#session-limit) (`src/session-limit.ts`, `factory-resume.yml`, cron): a session at the agent's usage limit pauses the run under `factory:session-limit` (no Escalation); `resume` starts the same work again after the reset.
- [PR flows](../docs/factory-flows.md#pr-flows) (`commands/pr-claim.ts`): `factory-pr-feedback.yml` answers writers' threads and Conversation requests; `factory-update-branches.yml` brings every open non-fork PR up to date with the base branch (a fork's PR gets one comment).
- [PR previews](../docs/factory-flows.md#pr-previews) (`factory-pr.yml`, off until `PREVIEWS_ENABLED`): a Worker Preview and a Neon branch per PR, smoked, removed on close.
- [Automatic Retro](../docs/factory-flows.md#automatic-retro) (`factory-retro.yml`): after every Escalation and on a closed Factory PR with writers' feedback; opens or edits a `Retro:` issue.
- [Merge Mode](../docs/factory-flows.md#merge-mode) (`factory-merge.yml`, `commands/merge.ts`, ADR 0016): after each PR workflow run, `pnpm factory merge` merges, in `safe`, each open Factory PR up to date with the base branch when nothing in `PROTECTED_PATHS` (`config.ts`) changed and `verify`, the preview, the verdicts and the last deploy allow it; `all` does the same without the protected list; `human` merges nothing.
- [Skills update](../docs/factory-flows.md#skills-update) (`src/ci/skills.ts`, ADR 0013): the PR's `skills-check` and `factory-skills-update.yml`, which auto-merges `skills/update`.

## Commands

- `pnpm bootstrap`, `pnpm bootstrap doctor`: set up (ending with the doctor, one run is enough) and check the copied repo (needs `gh` logged in; tests use the fake clients only).
- `pnpm bootstrap product <id>`: the Production module (Neon, secrets, domain, `main` ruleset; `DEPLOY_ENABLED` once the doctor passes). After it, run the Deploy workflow once by hand: `gh workflow run factory-deploy.yml --ref main`.
- `pnpm bootstrap previews <id>`: the Previews module (optional, after Production; `PREVIEWS_ENABLED` once the doctor passes).
- `pnpm bootstrap domain <id>`, `pnpm bootstrap doctor <id>`: a Product's domain, read from `apps/<id>/product.config.ts`.
- `pnpm bootstrap billing <id>`: the optional billing module (Stripe keys, plans, events endpoint; after `product`). `pnpm bootstrap env <id>` lists its variables, `pnpm bootstrap all <id>` runs the common part, `product`, `previews` and `factory` in order (stopping at the first doctor that fails), asks whether to set `domain` up, and offers billing. Every command ends with a `next: ...` line from the repo's state (none when all is done).
- `pnpm bootstrap factory`: the Factory module (labels, `FACTORY_TOKEN`, Claude auth, auto-merge, Merge Mode; `FACTORY_ENABLED` once the doctor passes), then an optional example issue.
- `pnpm bootstrap destroy`: only a person runs it, never an agent.
- `pnpm --filter @factory/harness test|typecheck`
- `pnpm factory local <NN> [--issues <dir>]`: run an issue on this machine in a throwaway container (needs Claude auth).

Each module's steps are in [factory-bootstrap.md](../docs/factory-bootstrap.md).

## Cloudflare credential (never asked twice)

- The token is collected once, by the `cloudflare-token` step of the common part, only while the `CLOUDFLARE_API_TOKEN` CI secret does not exist; `promptMainToken` is called nowhere else.
- Every other Cloudflare call takes its credential from `cloudflareCredential` in `common.ts` (memory, env, then wrangler's saved login). It stays in memory: never logged, written or sent to the forge. See [the full order](../docs/factory-bootstrap.md#cloudflare-credential-never-asked-twice).
