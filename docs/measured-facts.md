# Measured facts

What was measured on real accounts while building the base (Cloudflare Workers Free, Neon Free, GitHub Actions, October 2026). Re-measure before relying on a number for another plan or volume.

## Production (`example`, Workers Free)

- First deploy by Actions: `image`, `plan`, `build`, `deploy` and `smoke` green. The smoke signs in with the default account (ADR 0009), reads `/api/me` with the session cookie and checks `/mcp` answers 401 with a `WWW-Authenticate` that carries `resource_metadata`.
- Sign-in without `exceededCpu`: confirmed by the smoke, since the hash runs in the `PasswordHasher` Durable Object.
- `PasswordHasher`: about 112 ms of CPU per hash (scrypt), wall time p50 202 ms (7 calls, no error). Another run saw 58-173 ms per hash and up to 843 ms in one invocation. The Worker in front spent 0-1 ms.
- `RateLimiter` (Durable Object): about 0.7 ms of CPU per call (15 calls, no error); its SQLite rows stay well inside the Free quotas at this volume.
- Worker, all routes together (6 h, 39 requests, no error): CPU p50 21.2 ms, p90 76.4 ms, p99 115.8 ms. Earlier, 3 h: p50 14.8 ms, p99 63.9 ms.
- Rate limit by IP behind Cloudflare: five sign-ins in a row on an unknown email gave 401, 401, 401, 429, 429, and 401 again after 11 s. The window is 3 attempts per 10 s per `cf-connecting-ip`. The 429 carried no `Retry-After`.
- On another Free deployment (leadflow), sign-in with scrypt in the Worker spent 65-179 ms of CPU; bursts of 10 sequential and 10 parallel requests all succeeded, and 30 days had no 1102 (largest 269 ms).
- Worker bundle of `example`: `index.js` 2.9 MB (0.69 MB gzip), under the 3 MB compressed limit of Free.

## Previews

- A preview is a Worker Preview (`wrangler preview --name pr-N --worker-name <id>`, wrangler 4.151.2; the docs ask for >= 4.135.0). Example URL: `https://pr-15-example.<subdomain>.workers.dev`. Cleanup on `closed` (`wrangler preview delete`) removed the Worker Preview (it then answers 404) and the Neon branch (only `base` is left). Deleting something that does not exist is tolerated ("Preview not found").
- The `previews` block of the generated config is mandatory and nothing is inherited: the production KV never appears in it, and `EMAIL_TRANSPORT=outbox` and `PREVIEW_OUTBOX=true` come only from there.
- The Neon preview project holds a `base` branch (the renamed default branch, migrated by each `main` deploy and recreated when missing); each PR gets `preview/pr-N` from it, created with `autoscaling_limit_max_cu: 0.25`. Neon Free allows 10 branches per project, so `FACTORY_PREVIEW_LIMIT` is 9; at the limit the preview is skipped with a comment. The limit is covered by tests only, never observed live.
- The preview was skipped on every PR at first: the Cloudflare Vite plugin writes empty lists (`dispatch_namespaces`, `pipelines`, `secrets_store_secrets`, `vpc_services`, `worker_loaders`) into the built config and each counted as a new binding. Fixed; a non-empty list still counts. Observed live afterwards: a real binding change gives "preview skipped: the Worker bindings changed".
- The Cloudflare API token with the five template permissions (Workers Scripts edit, Workers KV Storage edit, Account Settings read, DNS edit, Zone read) creates the Worker Preview. No extra permission was needed (workers-sdk#15797).
- Stripe's docs say an account registers at most 16 webhook endpoints; a Stripe staff reply on the Stripe developer forum says 16 per sandbox (an account has up to 6 sandboxes). Neither is observed live: the previews count the endpoints their sandbox key sees (`previews.ts billing`), which is right under both readings, and the limit is covered by tests with a fake Stripe only. Confirm with a real sandbox when a Product enables billing in Previews.
- One comment per PR (marker `factory-previews`, edited, never duplicated); a preview of a PR from an author with `write` is automatic.

## GitHub Actions and GHCR

- The Factory image (`ubuntu:24.04` + `setup.sh`, 2.44 GB, tag = hash of what it installs) is built on demand and published to `ghcr.io/<owner>/<repo>/factory`. In a public repo the package is born public (anonymous manifest pull gave 200) and jobs with `packages: read` pull it. "Initialize containers" took 31-34 s with the Postgres service, against 46 s for `setup.sh` alone, so the image stays.
- `actions/checkout` inside a container with `USER 1001` works without `options: --user` and without a `safe.directory` error.
- With `CI=true` pnpm uses a frozen lockfile by default, so `new-product` must install with `--no-frozen-lockfile` (it adds an importer).
- `pnpm exec <bin>` runs from the root, where only the packages that declare a binary can find it: run `pnpm --filter @factory/harness exec wrangler ...`. A test fails for any `pnpm exec` of a binary the root does not declare.
- `concurrency.queue: max` (up to 100 pending, FIFO, incompatible with `cancel-in-progress: true`) is on every `factory-<N>` group; without it a third comment during a round became an `infra` Escalation.
- A push deploys only the Products it affects, so a Product listed in `DEPLOY_PRODUCTS` but never published waits for an affecting merge. Run the Deploy workflow by hand once after `bootstrap product <id>`; a manual run deploys every listed Product.
- Comments made with the job's `GITHUB_TOKEN` fire no workflow and notify nobody of what the owner's token does, so the Merge Gate notice uses `GITHUB_TOKEN` (`github-actions[bot]`).
- The `gh` of `ubuntu-latest` must be >= 2.99.0 for `gh pr edit --attach` (evidence images; the `user-attachments` endpoint is not documented REST). The `publish` job prints the version; if the upload fails, the PR body names the screenshots instead.
- The `main` ruleset (PR required, 0 approvals because GitHub does not let an owner approve their own PR, no force-push, no deletion, check `verify` required) was created by the wizard; an admin can bypass it.
- A closed Factory issue used to keep `in-progress` when its PR merged; `unblock --issue N` now removes it.

## The Factory end to end (real runs)

- Issue to PR in one run (`claim`, `image`, `work`, `publish`, `notify`, each on a fresh VM); the `work` log never names `FACTORY_TOKEN`.
- A blocked issue was refused with "Waiting on #N", and dispatched 13 s after the blocker's PR merged.
- Triage gave a verdict with the marked comment and queued the issue by itself.
- A PR-feedback round answered in the thread; the Factory's own marked replies started no further round.
- Real-Claude local runs (Opus 5.5): a Skeleton-only issue went ready on attempt 1 for about US$ 4.66; a Product issue that needed the Skeleton escalated for about US$ 2.36.

## Free-plan ceilings with several Products

- Resend Free: 3 domains per account (a 4th Product needs Pro, US$ 20/month) and 100 emails a day across all of them.
- Actions on a private repo: 2,000 minutes a month per account, split across CI and the Factory of every Product, and, per GitHub's docs (not measured yet), no environments or rulesets on a private Free repo. A self-hosted runner is free today and spends none of them (a US$ 0.002/min fee was announced and postponed).
- Neon: 100 projects, but the combined 20 GB limits first. Workers: 100k requests a day per account (static assets do not count). R2 has no spend cap and likely needs a card, so attachments are out of the base.
