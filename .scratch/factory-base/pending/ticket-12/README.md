# Ticket 12: workflows waiting for a human

`.claude/settings.json` (ticket 11) denies Edit/Write on `.github/workflows/**`, so the agent that did
ticket 12 left the workflows here. The tree under `github/` mirrors the target (`.github/`).

| File | What it does |
| --- | --- |
| `github/workflows/factory-image.yml` | Reusable workflow `image` (`packages: write`). Hashes `.node-version`, pnpm, Playwright from the lockfile, Claude Code from `config.ts`, `Dockerfile` and `setup.sh` (`node .factory/src/ci/image.ts`), checks the tag in GHCR (`docker buildx imagetools inspect`), builds and pushes only if it is missing, returns `image` (`ghcr.io/<owner>/<repo>/factory:<hash>`). |
| `github/workflows/factory-pr.yml` | `pull_request_target`. `image` (same-repo PRs use the head commit, so a version bump tests with the new image; fork PRs use the base commit), `plan` (turbo affected matrix, `node .factory/src/ci/matrix.ts`), `build` (one job per affected package, in the image, `contents: read` + `packages: read`, no secrets, no cache, `persist-credentials: false`, Postgres service, `runs-on: vars.FACTORY_RUNNER \|\| ubuntu-latest`), `skills-check` (`skills@1.7.2 experimental_install`, `git diff --exit-code`, symlinks), `ci-probe` (`pnpm factory:ci-probe`) and `verify`, the single required check that is green only if all of them are. |
| (removal) `.github/workflows/claude.yml`, `claude-code-review.yml` | The Claude Code GitHub App workflows leave. |

## Install

From the repository root, outside a Claude Code session that loads `.claude/settings.json`:

```sh
cp .scratch/factory-base/pending/ticket-12/github/workflows/factory-image.yml .github/workflows/
cp .scratch/factory-base/pending/ticket-12/github/workflows/factory-pr.yml .github/workflows/
git rm .github/workflows/claude.yml .github/workflows/claude-code-review.yml
```

Then, in `.factory/test/ci-workflows.test.ts`, change the one constant to `WORKFLOWS_DIR = ".github/workflows"`, run
`pnpm --filter @factory/harness test`, and delete `.scratch/factory-base/pending/ticket-12/`. Commit.

## Repository settings the workflows need

- Actions on; "Workflow permissions" may stay read-only (each job declares its own).
- Optional variables: `FACTORY_RUNNER` (self-hosted runner label), `POSTGRES_IMAGE` (a mirror of the Postgres image).
- Branch ruleset on `main`: require the `verify` check.
- A `pull_request_target` workflow runs from the base branch, so it only takes effect once merged to `main`.

## Measurements still to do (need GitHub Actions and GHCR)

See the ticket's `## Comments`: "Initialize containers" with the image against `setup.sh` on the VM, `actions/checkout` in the
container with `USER 1001`, and the visibility GHCR gives the package plus `packages: read`.
