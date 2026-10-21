# The PR workflow is `pull_request_target`: it runs main's workflow and main's code

A pull request check needs secrets (Cloudflare, Neon) to deploy a preview, and the PR can carry code written by an agent or a stranger. GitHub runs a `pull_request_target` workflow from the base branch, so a PR cannot change the YAML that holds the secrets. The workflow is split:

- `build`: the PR's code, the Factory image, no secrets, `contents: read`, no cache. Runs `verify` and uploads the bundle, assets and migrations of each affected Product.
- `deploy`: a fresh VM, checkout of `main` (`ref: github.sha`), dependencies from `main`'s lockfile with `--ignore-scripts`, the PR artifact extracted into `$RUNNER_TEMP` and limited by an allowlist (`worker/**`, `.sql`/`.json` migrations, no symlink), `CLOUDFLARE_API_BASE_URL` fixed, the PR number read from the event. The only job with Cloudflare and Neon preview secrets. The preview config is generated from `main`'s `apps/<id>/wrangler.jsonc`.
- `smoke`: no secrets, no environment, against the preview URL.

The preview is skipped, with a comment, when the PR's Worker bindings differ from `main`'s (compared by name signature, empty lists in the built config are not bindings). Previews run automatically only for an author with `write`+; otherwise a person with `write`+ applies the `preview` label, which a push removes. Production deploys use the same split with `<id>-production` environments.

## Considered Options

- **`pull_request` with secrets**: the PR's own YAML would decide what runs with them.
- **A separate Cloudflare token per Worker**: not needed. The one account token with five permissions (Workers Scripts edit, Workers KV Storage edit, Account Settings read, DNS edit, Zone read) was measured to create the Worker Preview.
- **Hardening against a hostile Forgejo base branch**: deferred, see `docs/forgejo.md`.

## Consequences

- A change to the workflows takes effect only after it is merged, so it cannot be tested from its own PR. The bindings-skip bug shipped for this reason: the PR check was green while no preview was created.
- A preview can never reach production data: the Neon preview project holds only a `base` branch without real data, and the preview has no Resend key (emails go to a database outbox read at `GET /api/preview/outbox?to=`, a route that exists only with two preview-only variables).
- `verify` does not depend on the preview jobs: a Cloudflare outage does not block a merge.
