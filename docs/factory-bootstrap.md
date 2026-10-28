# Factory bootstrap

The detail of `pnpm bootstrap` (`.factory/src/bootstrap/`): its modules, their steps, and how credentials are collected. `.factory/AGENTS.md` keeps the short version.

## Layout

- `pnpm bootstrap [doctor [<id>]] [domain <id>] [product <id>] [previews <id>] [factory] [--redo <step>]`.
- Wizard steps live in `common.ts` (the common part), `product.ts` (the Production module of `bootstrap product <id>`) and `domain.ts` (per Product: `resend-domain`, `dns-records`, `restricted-resend-key`, `worker-domain`).
  - `resendSteps(product)` is reused by `bootstrap product`. `domainSteps` adds `worker-domain` for `bootstrap domain` only: the Worker does not exist before the first deploy.
- The steps run over client interfaces (`clients.ts`: GitHub, Cloudflare, Neon, Resend), real adapters (`cloudflare.ts`, `resend.ts`, Zod-validated; `neon.ts` drives `neonctl`) and `fake/`.
- `previews.ts` is the Previews module (`previewSteps`). `github.ts` is the only module that calls `gh` (through `runGh`; `gh` gets `BASE_ENV` plus its own sign-in variables, `GH_AUTH_ENV`, and the proxy/CA ones, `GH_NETWORK_ENV`). `token.ts` checks the owner's token through `GitHubApi`.
- No local state, no secret on disk; `doctor` only reads.

## Common rules

- Resend is optional. Before any key prompt the wizard asks once "Set up real email with Resend now?" (default: skip, keeps the outbox; `RESEND_API_KEY` in the env skips the question; no TTY defers). Setting it up prints `https://resend.com/api-keys` and asks for the key, empty = deferred.
- A blank credential is never re-asked in the same run (`memory.resendDeferred`, `memory.cloudflareDeclined`).
- The wizard (common and `domain`) ends by running the doctor with the credentials held in memory (exit code = doctor). Standalone, with a TTY and no `CLOUDFLARE_API_TOKEN`/`RESEND_API_KEY` in the env, the doctor asks once (hidden, not stored); without a TTY it says `skip`.
- `pnpm bootstrap` and `pnpm bootstrap doctor` set up (ending with the doctor, one run is enough) and check the copied repo. They need `gh` logged in; tests use the fake clients only.

## `pnpm bootstrap product <id>`: the Production module

- Steps `neon-project`, `github-environment`, `database-secrets`, `auth-secret`, the four `domain` steps, `main-ruleset`, `deploy-products`; then the doctor of the Product, and only if it passes `DEPLOY_ENABLED=true`.
- Secrets are `<ID>_DATABASE_URL` (direct, migrations), `<ID>_DATABASE_URL_POOLED` (the Worker), `<ID>_BETTER_AUTH_SECRET`, `<ID>_RESEND_API_KEY`, in the `<id>-production` environment (restricted to the default branch), or at repo level with `FACTORY_USE_ENVIRONMENTS=false` when GitHub refuses environments.
- The ruleset requires branches to be up to date before merging (`strict_required_status_checks_policy: true`): a green `verify` against an old `main` does not merge.
  - An existing ruleset that already covers the default branch (PR, no force-push, no deletion, check `verify`) is reused, never duplicated.
  - When it is not strict, `main-ruleset` turns that on in it (`requireUpToDate`: the rules are read back and written whole with only that flag changed), and the doctor reports it as `off`.
- Neon: the wizard uses neonctl's own saved login (`neonctl auth` opens the browser only when `neonctl me` shows none, so once per machine) or `NEON_API_KEY` from the env, and passes the connection strings straight to `setSecret`; it never logs out. It makes no Neon API key for production (the deploy only needs the connection strings).
- First deploy of a new Product: a push deploys only the Products it affects, so after `bootstrap product <id>` run the Deploy workflow by hand once (`gh workflow run factory-deploy.yml --ref main`); a manual run deploys every Product in `DEPLOY_PRODUCTS`. The wizard prints this line at the end.

## `pnpm bootstrap previews <id>`: the Previews module

Optional, after Production.

- Steps:
  - `preview-environment` (`<id>-preview`, restricted like production, same `FACTORY_USE_ENVIRONMENTS` fallback).
  - `preview-neon-project` (`<id>-preview`, default branch renamed to `base`; variable `<ID>_PREVIEW_NEON_PROJECT_ID`).
  - `preview-neon-key` (secret `<ID>_PREVIEW_NEON_API_KEY`, minted with `neonctl api-keys create --project-id` under the run's login; when Neon refuses, one pasted key, hidden, blank = skip and remembered).
  - `preview-kv` (KV `<id>-preview-oauth` through the Cloudflare client; variable `<ID>_PREVIEW_OAUTH_KV_ID`).
  - `preview-products` (id in `PREVIEW_PRODUCTS`).
- Then the doctor of the previews and, only if it passes, `PREVIEWS_ENABLED=true`.
- The one-run rules hold: a recorded variable or secret proves a step done (no Neon login, no Cloudflare prompt on a rerun), one Neon login per run and only with Neon work.
- The doctor shows a Previews section for a Product by presence (any preview variable, secret, environment or the id in `PREVIEW_PRODUCTS`); the Production module never fails on it.
- What the previews do on a PR is in [factory-flows.md](factory-flows.md#pr-previews).

## `pnpm bootstrap domain <id>`, `pnpm bootstrap doctor <id>`: a Product's domain

- Reads `domain` from `apps/<id>/product.config.ts` (never rewrites it).
- Needs `RESEND_API_KEY` (full access, or it is asked) and the one Cloudflare token (template URL in `common.ts`: Workers Scripts Edit, Workers KV Storage Edit, Account Settings Read, DNS Edit, Zone Read; no Workers Routes, the Custom Domain needs only Workers Scripts Write; older tokens must be recreated).
- A pasted token is checked with read-only calls (verify, scripts, KV, account, zones, DNS records) and a refused one is named and asked again without being stored; the probes cannot tell edit from read, the first real write does.
- Without the zone in the account, DNS records are printed as plain lines; without the Worker, the Custom Domain waits for the first deploy.

## `pnpm bootstrap factory`: the Factory module

`factory.ts`, after the common part.

- Steps:
  - `labels`.
  - `factory-token`: the one prompt (`factory-token`, hidden): the owner's fine-grained token limited to this repo.
    - One pre-filled link `settings/personal-access-tokens/new?...` with `contents`, `pull_requests` and `issues` as write and no `workflows`, printed once after saying the only manual step is "Only select repositories".
    - Checked before it is stored: prefix `github_pat_` (a classic `ghp_` is refused), `GET /repos/{o}/{r}` with the token must say `permissions.push` (`TokenClient`, `token.ts`). GitHub offers no way to read a fine-grained token's permissions, so the missing `workflows` cannot be tested and the wizard only warns. Three tries.
    - `FACTORY_TOKEN` in the env or already as a secret skips the prompt.
  - `claude-auth`: never prompted. `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` from the env, or an existing secret; both in the env stores only the OAuth one; both as secrets is a warning.
  - `auto-merge`: the repo's `allow_auto_merge`, which the skills update needs ([factory-flows.md](factory-flows.md#skills-update)).
- Then the doctor (Factory section, no Cloudflare checks) and, only if it passes, `FACTORY_ENABLED=true`. A rerun with the secrets present asks no credential.
- No second GitHub account exists any more (ADR 0002).

### The example issue

- Last, only when the doctor passed, `FACTORY_ENABLED` is on and there is a TTY, one `confirm` (`example-issue`, default No, asked again on every run): an example issue (`example.ts`).
- It takes the first Product of `apps/` (`select` with several; none = skip), creates a parent spec (`## Testing Decisions`) and a child (`## Acceptance criteria`: a `auth.signIn.title` override in the Product's messages, checked by its own E2E), links the sub-issue, then adds `product:<id>` (created when missing) and `ready-for-agent`, which is what starts the run.
- It polls `GET` every 30 s for up to 40 min (spinner; `deps.example.pollMs|timeoutMs`) until the PR `factory/issue-N` has its preview comment or finished checks (exit 0), the issue gets `ready-for-human`, the `factory-issue.yml` run fails, or the timeout.
- Then, pass or fail (try/finally; the first Ctrl-C stops the wait and cleans up), it prints the PR and preview URLs and asks (`choose`, `example-delete`) whether to delete the example, the default and also what Ctrl-C picks, or keep it (nothing is deleted; it prints what is left and the commands that delete it later).
- Deleting cancels a run still going, closes the PR without merging (so `factory-pr-cleanup.yml` deletes the Worker Preview and the Neon branch; it waits for that run), deletes `factory/issue-N`, the "The Skeleton must grow" follow-ups that mention the child, the child and the parent (`gh issue delete`), and names anything left with the command that removes it.
- It uses only the `gh` session (`GitHubClient`), never `FACTORY_TOKEN`. No ready PR = non-zero exit, the setup is still fine.

## `pnpm bootstrap destroy`

`pnpm bootstrap destroy [product <id> | previews <id> | factory | common]` (`destroy.ts`; no argument = everything). Only a person may run it, never an agent (the root `AGENTS.md` and `.claude/settings.json` say so).

- It refuses without a TTY or with `CI` set before any listing or API call.
- It lists what disappears (the production Neon database on a `!!` line; environments with their secrets), asks to type the id (`all`, `factory`, `common`), deletes one item at a time and reports failures while it continues (exit 1).
- Deletes: Worker (+ Previews, Custom Domains), KVs `<id>-oauth-kv` and `<id>-preview-oauth`, Neon projects `<id>` and `<id>-preview` (never one of several with the same name), Resend domain, `<ID>_*` secrets and variables, environments, the id in `DEPLOY_PRODUCTS`/`PREVIEW_PRODUCTS` (the list, its switch and the `main` ruleset go with the last Product), `FACTORY_TOKEN`.
- Never the repo, issues, labels, accounts, DNS records or the workers.dev subdomain.
- Credentials as everywhere else (wrangler/neonctl logins, `RESEND_API_KEY` or one optional question).
- Delete methods of the clients are used by `destroy` only.

## Cloudflare credential (never asked twice)

- The Cloudflare API token is collected once, by the `cloudflare-token` step of the common part, and only while the `CLOUDFLARE_API_TOKEN` CI secret does not exist (an explicit `--redo cloudflare-token` replaces it). `promptMainToken` is called nowhere else.
- Every other Cloudflare call (`cloudflareHandle`: previews KV, `dns-records`, `worker-domain`; `workers-dev`; the doctor) takes its credential from `cloudflareCredential` in `common.ts`, in this order:
  1. this run's memory;
  2. `CLOUDFLARE_API_TOKEN` in the env;
  3. wrangler's saved login (`wrangler auth token --json`, via `wrangler.ts`; wrangler 4.151.2 docs read 2026-10-20: refreshes an expired OAuth token itself).
- With none, steps that may change things run `wrangler login` once (browser; wrangler keeps it, like neonctl); the doctor and the `check`s never log in.
- The token stays in memory: never logged, written or sent to the forge.
- The account id is `CLOUDFLARE_ACCOUNT_ID` from the env or the only account the credential sees; with several it fails naming `CLOUDFLARE_ACCOUNT_ID`, it never asks.
- wrangler's OAuth scopes have no DNS: when listing or creating DNS records is refused (`CloudflareRefused`), `dns-records` prints each record on one unwrapped line plus a "NOT done" note and returns without prompting; run it again after creating them by hand.
