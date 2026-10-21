# One Factory run is three jobs: `claim`, `work`, `publish`

The token that writes to the repository never shares a machine with the Agent.

- `claim` (job token, `issues: write`, no secret): reads the current state of the forge, runs the deterministic guard and takes the lock (label `in-progress`; the label swap is the lock, a 404 means someone else holds it).
- `work` (the Factory image, `contents: read` and `issues: read`, `persist-credentials: false`): runs the Agent and the Stages. It holds only Claude's credentials. It never receives `FACTORY_TOKEN`.
- `publish` (a fresh VM, `FACTORY_TOKEN`, the harness from the default branch, `if: always()`): re-reads the forge, then pushes (`--force-with-lease` against the start SHA), opens the PR, reviews and comments. No artifact means an `infra` Escalation.

The jobs meet only in the `work-out` artifact (git bundle, `result.json` validated with Zod on both sides, evidence, `stream-json`, 14 days). The workflow YAML stays thin; the logic is TypeScript in `.factory/`. A fourth job, `notify`, posts the Merge Gate notice with the job's own `GITHUB_TOKEN`.

## Considered Options

- **One job with the token**: the Agent runs arbitrary code from the issue, the repository and its dependencies, and could read or send the token.
- **Token in the Agent's process, restricted by prompt**: a prompt is not a boundary.

## Consequences

- `publish` takes its code from the default branch, so a branch cannot change what runs with the token. Workflow files are protected paths: a diff there is an Escalation without a PR.
- `work` and `build` can move to a self-hosted runner (`vars.FACTORY_RUNNER`); `claim`, `publish`, `apply`, `deploy`, `smoke` and `image` never do. See `docs/self-hosted-runner.md`.
- A persistent machine that ran `work` may keep anything, so no job with a secret may land there.
- Each run reads the forge state, never the event payload; `publish` checks again and discards with "Run discarded: ..." if the world moved.
