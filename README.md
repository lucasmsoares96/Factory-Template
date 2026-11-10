# Factory Template

A repository of Products plus the harness that builds them. See [AGENTS.md](AGENTS.md) for the map and [GLOSSARY.md](GLOSSARY.md) for the terms.

## Overview

The repository has three parts: the Products and the Skeleton they share, the Factory that builds them, and the bootstrap and workflows that run them.

### Products on the Skeleton

- A Product (`apps/<id>/`) is one Cloudflare Worker. Static Assets serve the React SPA, and the Worker answers `/api/*`, `/mcp` and `/oauth/*`.
- The Skeleton (`packages/skeleton/`) gives every Product the platform:
  - Hono with OpenAPI.
  - Better Auth, with accounts, companies and invitations.
  - Postgres through Drizzle: Neon in production, Docker locally.
  - An MCP server.
  - Email through Resend.
  - Optional Stripe billing.
  - The SPA shell (TanStack Router and Query, shadcn, Tailwind), in `en` and `pt-BR`.
- A Product adds features in `src/features/<feature>/`. A feature can bring tables (`schema.ts`), screens (`routes/` for signed-in users, `public/` for visitors), texts (`messages.ts`) and API routes (`api(app)`). Every API operation is also an MCP tool unless it sets `x-mcp: false`.
- `pnpm generate` builds the OpenAPI client, the React Query hooks, the MSW handlers, the route tree and the MCP tool list from the code.

### The Factory

The Factory (`.factory/`) turns an issue into a reviewed pull request. It drives Claude Code from GitHub Actions (`.github/workflows/factory-*.yml`):

1. Someone with write access adds `ready-for-agent` to an issue that has `## Acceptance criteria`.
2. `claim` checks the issue and takes the Lock (`in-progress`). An issue without test seams goes to Triage first.
3. `work` runs the Stages inside the Factory image (`.factory/image/`) with read-only access:
   - Development, then E2E.
   - Visual Review, when the interface changed.
   - Review.
   - The Pull Request Stage.

   A failing E2E sends the work back to Development, up to 5 attempts.
4. `publish` scans for secrets, pushes and opens the PR. The PR carries the review, one verdict per acceptance criterion, and the `@evidence` screenshots at 1280 and 390 px.
5. The PR waits at the Merge Gate. A human merges, unless the Merge Mode (`FACTORY_MERGE_MODE`) lets `factory-merge.yml` merge it.

When the Factory cannot finish (repeated E2E failures, out of time, a question, an infra failure), it escalates. The issue moves to `ready-for-human`, and a Retro starts. Other workflows answer PR comments, keep open PRs up to date with `main` and resume paused work. The details are in `docs/factory-flows.md`, and [Using the Factory](#using-the-factory) walks through it from a person's side.

### Provisioning and deploy

- `pnpm bootstrap` sets up GitHub (labels, the `main` ruleset, environments, secrets), Cloudflare, Neon and, optionally, Resend and Stripe.
  - Per Product: `product`, `previews`, `domain` and `billing`.
  - `factory` turns the Factory on.
  - The details are in `docs/factory-bootstrap.md`.
- Every PR runs `verify` (`factory-pr.yml`). With Previews on, a PR can also get a Preview: a Worker preview with its own Neon branch, removed when the PR closes.
- A push to `main` deploys the changed Products (`factory-deploy.yml`). It migrates the database, runs `wrangler deploy` and then a smoke test that signs in with the Default account.
- GitHub is the only forge that runs today. Forgejo support is a design only (`docs/forgejo.md`).

## Install

[proto](https://moonrepo.dev/docs/proto) is the only tool you install by hand. `.prototools` pins Node, pnpm and the GitHub CLI (`gh`); the `gh` plugin is `.proto/gh.toml`, which downloads the official `cli/cli` release and checks its checksum.

1. Install proto: `bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)`.
2. In the clone, run `proto install`. If proto refuses the `gh` plugin because the configuration is not trusted, run `proto trust` once in the clone first: `[plugins]` is a security-sensitive setting, applied only to a trusted path.
3. Run `pnpm install`, then `pnpm bootstrap`.

`pnpm bootstrap` asks for credentials as it goes, so you export nothing beforehand. It checks your `gh` login (and offers `gh auth login --web`), and Neon signs in through the browser. You paste every other key into a hidden prompt, including Claude's token, which you get from `claude setup-token`.

## Create a new Product

The whole flow, in order (`<id>` is lowercase letters, digits and hyphens, e.g. `notes`):

1. `pnpm bootstrap product <id>` creates `apps/<id>/` when it does not exist yet. It asks for the title and the domain, or reads them from `--title` and `--domain`, and runs the same code as `pnpm new-product <id>`. If the folder already exists, nothing in it changes. Then it sets up:
   - the database. It asks for the region once per Product, with São Paulo (`aws-sa-east-1`) as the default; without a terminal the region comes from `NEON_REGION`. The region cannot change later.
   - the secrets and the environment.
   - the Default account.

   It does not commit or push.
2. `pnpm dev <id>` runs the Product on your machine.
3. Open a pull request with `apps/<id>/` and `pnpm-lock.yaml`. The new folder is not in git yet.
4. Merge it. The Worker exists only after the first deploy.
5. Run the first deploy: `gh workflow run factory-deploy.yml --ref main`.
6. Optional, whenever you want: `pnpm bootstrap previews <id>`, `pnpm bootstrap domain <id>` and `pnpm bootstrap billing <id>`.

To create only the folder, with no accounts and no database, run `pnpm new-product <id>`.

The database region cannot change once the database exists. To change it:

1. Run `pnpm bootstrap destroy db <id>`. It deletes only the Neon projects and what depends on them, including the Default account. It leaves the Worker, the environments and the `main` ruleset alone.
2. Run `pnpm bootstrap product <id> --redo region`.
3. Run `pnpm bootstrap previews <id>`.

You are asked for the email and password of the Default account again.

## Run on your machine

`pnpm dev <id>` starts the Worker and the SPA with a local Postgres. There are two billing modes:

- **Fake Stripe (default):** `pnpm dev <id>`. Billing runs on a Stripe that lives inside the Worker, with no internet access and no key.
- **Real Stripe sandbox:** `pnpm dev <id> --stripe`. Checkout, the Billing Portal and the webhooks are the real Stripe ones. Use the Previews' sandbox, which already has the Product's Plans (`pnpm bootstrap billing <id>`). Create a restricted key in it and export it:

  ```sh
  read -s -p "Stripe sandbox key: " STRIPE_SECRET_KEY; export STRIPE_SECRET_KEY
  ```

  - Only sandbox keys (`sk_test_`, `rk_test_`) are accepted. The command refuses an `sk_live_` key before starting anything.
  - It starts Vite on port 5173 and `stripe listen` (the Stripe CLI, already in the catalog: install nothing), which forwards the webhooks to `localhost:5173/api/auth/stripe/webhook`.
  - The Worker runs with `BILLING_ENVIRONMENT=local`. What it creates is tagged `local`. The Previews ignore those events, and the local Worker accepts only events tagged `local`.
  - If either process stops, the other stops too.

Test cards:

- `4242 4242 4242 4242` pays.
- `4000 0000 0000 0002` is declined.
- `4000 0027 6000 3184` asks for 3D Secure.
- `4000 0000 0000 0341` fails when charged.

To fire an event while `--stripe` is running, use `pnpm --filter @workspace/skeleton exec stripe trigger <event> --api-key $STRIPE_SECRET_KEY` (for example, `customer.subscription.trial_will_end`).

## Using the Factory

A walkthrough of the Factory from a person's side: how to plan work, write an issue the Factory accepts, follow the run, and act on its pull request. The mechanics of each workflow are in `docs/factory-flows.md`. The Factory is off until `pnpm bootstrap factory` sets `FACTORY_ENABLED`.

### 1. Plan with the skills

The skills in `.agents/skills/` turn an idea into issues the Factory can take. Run them in Claude Code as slash commands (`/wayfinder`, `/to-spec`, ...). Most come from [Matt Pocock's skills](https://github.com/mattpocock/skills).

| Skill | Use it to |
| --- | --- |
| `/ask-matt` | Ask which skill or flow fits your situation. It routes over Matt Pocock's skills. |
| `/wayfinder` | Plan any effort, small or large. It builds a map issue (`wayfinder:map`) with decision tickets as sub-issues and resolves them one at a time. The tickets carry `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` or `wayfinder:task`. A small effort gets a small map. |
| `/grilling` | The interview itself: it asks you questions until the plan holds. `/wayfinder` runs it for every `wayfinder:grilling` ticket. Call it directly only for a quick question that should leave nothing on the tracker. |
| `/research` | Answer a question from primary sources and save the findings as Markdown in the repo. |
| `/prototype` | Build a throwaway prototype to answer a design question. |
| `/domain-modeling` | Sharpen the terms in `GLOSSARY.md` or record an ADR in `docs/adr/`. |
| `/to-spec` | Turn the conversation into a spec issue, with a `## Testing Decisions` section. |
| `/to-tickets` | Split a spec into tickets: one issue each, as sub-issues of the spec, with `## Acceptance criteria` and blocking edges, labelled `ready-for-agent`. |
| `/triage` | Move issues through the triage labels and write agent-ready briefs. |
| `/wizard` | Write a bash wizard for steps only a person can do (dashboards, credentials). |
| `/handoff` | Compact the session into a document another agent can pick up. |
| `/retro` | Run a retrospective over an Escalation or a PR the Merge Gate stopped. |

`/ask-matt` also recommends skills that are not installed here (`/grill-with-docs`, `/grill-me`, `/implement-spec`, `/improve-codebase-architecture`, `/to-questionnaire`, `/wait-what`, `/teach`). Add one with `npx skills@1.7.2 add mattpocock/skills --skill <name>`, then move it from `.claude/skills/` to `.agents/skills/` and link it back, as the other skills are.

This repo starts every effort with `/wayfinder`, even a small one. The map keeps each decision in an issue, where later sessions and the Factory can read it. Matt's own guidance in `/ask-matt` saves `/wayfinder` for large, foggy efforts and starts smaller ones with a grilling session; here, a small effort just gets a smaller map. When the map is clear, run `/to-spec`, then `/to-tickets`. The Factory never works on the spec itself: once a spec has sub-issues, it is skipped. `/to-spec` labels the spec `ready-for-agent`; remove that label, or the Factory moves the spec to `needs-info` because it has no acceptance criteria.

### 2. Write an issue the Factory accepts

Before it starts, the Factory checks the issue (`.factory/src/guard.ts`). An issue passes when:

- it is open and has no sub-issues;
- it has a `## Acceptance criteria` section. Each item is one behaviour that a test proves, and the Review gives a verdict per item. Never list the verify (`pnpm factory:verify`) as a criterion: the Factory always runs it;
- it has test seams: the parent spec has `## Testing Decisions`, or a Factory Triage comment exists;
- every issue that blocks it (GitHub's native issue dependencies) is closed.

```markdown
## Parent

#41

## What to build

A signed-in user sees their notes as a list, newest first.

## Acceptance criteria

- [ ] The notes page lists the user's notes, newest first.
- [ ] A user with no notes sees an empty state.
- [ ] A user never sees another user's notes.
```

Add `product:<id>` when the issue is about one Product.

### 3. Start a run

Add `ready-for-agent`. Only a label put by someone with `write` access counts. What happens next:

- **Accepted:** the label becomes `in-progress` (the Lock) and the run starts.
- **No acceptance criteria, or a criterion that names the verify:** `needs-info`, with a comment saying what to fix. Fix the issue and add `ready-for-agent` again.
- **No test seams:** `agent:explore`, and Triage starts (see below).
- **Blocked:** a "Waiting on #N" comment. When the last blocker closes, the Factory starts the issue by itself.

**Triage.** Add `agent:explore` to an issue to have the Factory explore it without changing code. It comments with the approach, the files, the test seams and the open questions, then moves the issue to `ready-for-agent`, `ready-for-human` or `needs-info`.

### 4. Follow the run

The run takes from minutes to a few hours (at most 330 minutes). It goes through the Stages: Development, E2E, Visual Review (only when the interface changed), Review and the Pull Request Stage. A failing E2E sends the work back to Development, up to 5 attempts. `factory:working` is on while a run is going. Its logs are in the Actions tab, under the `Factory issue` workflow.

The run ends in one of three ways:

- **Ready:** the PR is open, and `github-actions[bot]` comments to the person who added `ready-for-agent`.
- **Escalation:** the Factory could not finish (5 failed E2E attempts, out of time, a question for you, an unmet criterion, an infra failure). The issue gets `ready-for-human` and a comment with the reason, plus a draft PR when there are commits. Answer or fix the issue, then add `ready-for-agent` again: the next run continues from the kept commits.
- **Pause:** the Claude account hit its usage limit. The issue gets `factory:session-limit` and resumes by itself after the reset. Remove the label to cancel the wait.

### 5. Review the pull request

The PR carries the Review (a summary and inline comments), one verdict per acceptance criterion, a `## Merge Danger` section, and the `@evidence` screenshots at 1280 and 390 px.

- **Ask for changes:** comment on a line, submit a review, or write in the Conversation tab. Only comments from people with `write` access count. About 3 minutes after the last one (at once for a submitted review), the Factory runs a feedback round: it fixes, replies in each thread and answers the Conversation comments. A thread stays open until the Factory has the last word.
- **Get a Preview:** with Previews on, a PR from someone with `write` access gets a Preview by itself. For anyone else's PR, someone with `write` access adds `preview`; each push removes it.
- **Keep it up to date:** every push to `main` merges `main` into every open PR. The Factory resolves conflicts and runs verify again.
- **Merge:** the Merge Mode (`FACTORY_MERGE_MODE`) decides who merges.

| Merge Mode | Who merges |
| --- | --- |
| `human` (default) | You, always. |
| `safe` | The Factory, when `verify`, the Preview, every criterion and the last deploy are green, no comment waits for an answer, and the PR touches no protected file (its own workflows, guard, prompts, `config.ts`). It labels the PR `auto-merged`. |
| `all` | The Factory, under the same conditions, protected files included. |

A PR that touches the harness gets `harness-change` and a warning. Review it with care: these files change how the Factory itself works. When the PR merges, the issue closes, its criteria are checked, and the blocked issues start.

### 6. Retro

After every Escalation, and when a Factory PR closes with comments from a person, the Factory runs a Retro. It opens or edits an issue named `Retro: #N <title>`, labelled `retro` and `needs-triage`, with proposals for the rules and the harness. Turn the proposals worth doing into issues, and close the rest. Set `FACTORY_RETRO_ENABLED=false` to turn it off.

### 7. Run an issue on your machine

`pnpm factory local <NN> [--issues <dir>]` runs a local Markdown issue through the same Stages in a throwaway container. It needs Claude's auth in the environment.

### Labels

| Label | Put by | Meaning |
| --- | --- | --- |
| `needs-triage` | a person | Someone must evaluate the issue. |
| `needs-info` | a person or the Factory | Waiting for more information. |
| `ready-for-agent` | a person with `write` | Start the Factory on this issue. |
| `ready-for-human` | a person or the Factory | A person must do it (also the label of an Escalation). |
| `wontfix` | a person | Will not be done. |
| `agent:explore` | a person | Triage this issue: explore and comment, no code. |
| `in-progress` | the Factory | The Lock: the Factory holds the issue, from the start to the merge. |
| `factory:working` | the Factory | A run is going right now. |
| `factory:session-limit` | the Factory | Paused at Claude's usage limit; resumes after the reset. |
| `preview` | a person with `write` | Deploy a Preview of a PR whose author has no `write` access. |
| `harness-change` | the Factory | The PR changes the harness or the agent rules. |
| `auto-merged` | the Factory | The Factory merged this PR under the Merge Mode. |
| `retro` | the Factory | The issue holds a Retro's proposals. |
| `product:<id>` | a person or the Factory | The issue or PR is about the Product `<id>`. |

### What the Factory runs on

- **[Sandcastle](https://github.com/mattpocock/sandcastle)** (`@ai-hero/sandcastle`, pinned in `pnpm-workspace.yaml`), by Matt Pocock: runs each Claude Code session of a Stage. The harness in `.factory/` owns the Stages, the attempts, the PR and the Escalation (ADR 0004).
- **The skills the Stages call:** `tdd` and `implement` (Development and PR feedback), `code-review` (Review), `pr` (the PR text), `triage` (Triage) and `retro` (Retro). The stack recipes (`skeleton-add-feature`, `skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-evidence-test`) tell the agent how to build on the Skeleton. `codebase-design`, `diagnosing-bugs` and `domain-modeling` are there when the work needs them.
- **Vendor skills:** `playwright-cli` (Microsoft) and `workers-best-practices` (Cloudflare).
- **Keeping the skills current:** `skills-lock.json` pins each skill to its source. `factory-skills-update.yml` takes the upstream changes every day on the `skills/update` branch and merges them by itself once `verify` passes (ADR 0013).
