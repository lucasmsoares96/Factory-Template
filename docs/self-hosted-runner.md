# Self-hosted runner for a private Factory repo

Optional. By default every Factory job runs on `ubuntu-latest`. The owner of a **private** repo can move two jobs to their own machine: `work` (the Agent, `factory-issue.yml`) and `build` (the PR checks, `factory-pr.yml`, and the `build` job of `factory-deploy.yml`). Nothing else moves.

Checked against the official docs and `actions/runner` on 2026-10-20 (latest release `v2.338.0`, 2026-10-06; releases below `v2.329.0` no longer register on github.com).

## Never on this machine

`claim`, `publish`, `apply`, `deploy`, `smoke`, `image` and the preview deploy always run on `ubuntu-latest`. They hold `FACTORY_TOKEN`, Cloudflare or Neon credentials, or push to GHCR. A job that ran `work` can leave things on a persistent machine, so any job with a secret must never land there. A Factory pull request that edits a workflow is flagged for review, not refused (ADR 0012): check that it does not move a job with a secret onto this runner.

Never use a self-hosted runner on a public repo (GitHub: "should almost never be used for public repositories"). The public template does not define `FACTORY_RUNNER` and its bootstrap creates no runner.

## The machine

- A dedicated VM, Linux x64, with Docker Engine. Not your laptop, not a shared server.
- No secrets on it: no SSH keys, cloud credentials, tokens or `.env` files. No access to your local network or to cloud metadata endpoints (egress firewall: allow only outbound HTTPS 443).
- Outbound domains: `github.com`, `api.github.com`, `*.actions.githubusercontent.com`, `results-receiver.actions.githubusercontent.com`, `*.blob.core.windows.net`, `ghcr.io`, `pkg-containers.githubusercontent.com`, and Docker Hub (or your mirror).
- User `runner` with **uid 1001**, in the `docker` group (root-equivalent, which is why the VM is dedicated). The Factory image runs as `USER 1001`; if the host user has another uid, the job cannot write the workspace (`/__w`).
- Runner `>= v2.329.0`; install the latest (`v2.338.0` on 2026-10-20) from `https://github.com/actions/runner/releases` into `/home/runner/actions-runner`. Keep auto-update on, or update within 30 days.
- One runner (one VM or one directory and user-level service) per simultaneous job. A runner takes one job at a time.
- Docker Hub rate limits apply here (hosted runners are exempt). The `postgres` service image is pulled every job: log in to Docker Hub with `credentials:` on the service, or mirror `postgres` to your GHCR and point the workflow at the mirror.

## Ephemeral loop with JIT config

A JIT config is made through the REST API and registers a runner that takes **one job** and is removed. Creating it needs admin on the repo, so mint it on a trusted machine (not the VM) and send it over SSH. The VM only ever holds the one-shot config, in a pipe.

On the trusted machine, in a loop (`gh` is logged in there as a repo admin; that login never goes on the VM):

```bash
while true; do
  gh api -X POST repos/OWNER/REPO/actions/runners/generate-jitconfig \
    -f name="factory-$(date +%s)" -F runner_group_id=1 -f 'labels[]=factory' --jq .encoded_jit_config \
    | ssh runner@VM /home/runner/run-one.sh
done
```

`runner_group_id=1` is the default group; `labels` is required. GitHub adds `self-hosted`, `Linux` and `X64` itself; the one custom label here is `factory`.

On the VM, `/home/runner/run-one.sh` (owner `runner`, mode 755). It reads the config from stdin, runs one job, then wipes the workspace and Docker:

```bash
#!/usr/bin/env bash
set -uo pipefail
export ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true
cd /home/runner/actions-runner
./run.sh --jitconfig "$(cat)"
docker ps -aq | xargs -r docker rm -f
docker system prune -af --volumes
rm -rf /home/runner/actions-runner/_work/* /home/runner/actions-runner/_diag/*
```

`ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true` makes the runner refuse any job without `container:`, so a job cannot run directly on the host. Forward the runner logs elsewhere if you need them: `_diag` is wiped.

## Point the repo at it

In the repo, Settings, Secrets and variables, Actions, Variables: create `FACTORY_RUNNER` with value `factory` (a label, or `self-hosted`). The workflows read `runs-on: ${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}`. To go back to GitHub-hosted, delete the variable. If the runner is off, the job waits in the queue up to 24 hours, then fails.

## Cost

Self-hosted runners are free in Actions today. A US$ 0.002/min platform charge was announced for 2026-03-01 and postponed with no new date; it was not cancelled.

## Verify (needs a VM)

1. Provision the VM as above and start the loop.
2. Set `FACTORY_RUNNER=factory`.
3. Run a Factory issue and open a PR. In the `work` and `build` logs, `id -u` prints `1001` and the job ran on a `factory-*` runner (Runners page shows it, then removes it).
4. Check `docker ps -a` and `_work` on the VM are empty after the job, and that `claim`, `publish`, `deploy` ran on `ubuntu-latest`.
