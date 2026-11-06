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

When the Factory cannot finish (repeated E2E failures, out of time, a question, an infra failure), it escalates. The issue moves to `ready-for-human`, and a Retro starts. Other workflows answer PR comments, keep open PRs up to date with `main` and resume paused work. The details are in `docs/factory-flows.md`.

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
