# Forgejo: what changes

The Factory is built for GitHub; only the adapters are designed to fit Forgejo. Forge calls sit behind the `Tracker` and `CodeHost` seams (about 20 REST operations), and the Agent seam does not care. Nothing here has been run on a Forgejo. It was researched against Forgejo v17.0.0 (2026-10-15), v16.0.x and the v15 LTS (supported until 2027-07-15), and Forgejo Runner v13.2.0. v17.0.0 carried an upstream warning against upgrading at release time, and Authorized Integrations need v16 or later, so aim at v16.0.x or the LTS.

## What exists only on GitHub

- `gh` and `claude-code-action` (the Factory uses neither on the Forgejo path), `state_reason` (use `done` = `closed`), `concurrency.queue: max`, the lock by `git/refs`, the draft state (Forgejo shows a draft when the title starts with `WIP:`; `fj` has no `--draft`), and `workflow_run` (not available; feature request open).
- Events: `push`, `issues`, `issue_comment`, `pull_request`, `pull_request_target`, `release`, `schedule`, `workflow_call`, `workflow_dispatch`. Forgejo reads `.forgejo/workflows/` when that directory exists and GitHub ignores it, so one template can carry both with small differences.
- Screenshots: the `fj` CLI 0.7.0 cannot upload attachments, but the REST API has asset endpoints (use REST directly).
- Not a forge to use: Codeberg's terms (since June 2026) forbid mostly AI-generated projects and its hosted runners stop at 10 minutes.

## Tokens

- **No `workflow` scope exists.** A token with `write:repository` can change `.forgejo/workflows/`. The Factory does not refuse workflow changes on either forge (ADR 0012): the defence is the human review of the flagged pull request, plus keeping the token out of the `work` job. State this in the install prompt.
- Since v15 tokens can be restricted to specific repositories, with only `read/write:repository` and `read/write:issue`. There is no GitHub App equivalent, and the Factory already writes as the owner and recognizes its texts by a marker (ADR 0002), which works there too.
- The Merge Gate notice must come from the job's automatic token (the Forgejo equivalent of `GITHUB_TOKEN`), because nobody is notified of what the Factory's own token does.
- The automatic token has write access to the repository in same-repository PRs; PRs from forks and AGit PRs get read-only, even under `pull_request_target`. The documentation of v17 still says the `pull_request` token has no write permission, which contradicts the code.
- To comment a preview URL from a read-only job, use an Authorized Integration (v16+: an ID token traded for API access by a bot, with claim rules on repo, workflow file, ref and event).

## PR from the Factory: AGit

- AGit (`git push origin HEAD:refs/for/main/<topic>`, with `-o title=... -o description=... -o force-push=true`) opens a PR with only read access to the base repository (the pre-receive hook checks read on pull requests). Forgejo treats an AGit PR like a fork PR: `pull_request` runs without secrets, with a read-only token and no OIDC.
- A person who is a collaborator with write access is not held for approval; only read-only authors from forks or AGit are. "Approve always" expires after 3 months without a PR.

## `pull_request_target`: the base branch caveat

- GitHub pins `pull_request_target` to the default branch. Forgejo takes the YAML from the PR's base branch, whichever it is. In the same repository, whoever can push a branch `x` with an altered workflow and open a PR against `x` runs that YAML with the secrets. The protection "YAML from the base" holds only if every possible base branch is trusted: protect `main`, keep no long-lived branch with a `pull_request_target` workflow, and give the Factory's identity no write access if you can (AGit).
- Until the security release of 2026-08-20 (v16.0.3), local reusable workflows under `pull_request_target` were read from the PR's head. Make sure the instance is newer.
- Under `pull_request_target`, PR code can write the runner cache with no isolation (only `pull_request` gets a write-isolation key). Use separate runners and caches and none in privileged workflows.
- Approval for same-repository PRs does not exist, and never applies to `pull_request_target`. An open upstream issue notes `pull_request_target` runs without approval.
- `actions/checkout` v7 of GitHub may refuse the head checkout under `pull_request_target` (`allow-unsafe-pr-checkout: true`); unverified for AGit.

## Keeping pull requests up to date

- GitHub: the `main` ruleset requires up-to-date branches (`strict_required_status_checks_policy`), and `factory-update-branches.yml` merges `main` into every open PR that is behind and pushes. On Forgejo, the same rule is `block_on_outdated_branch: true` on the branch protection of `main` (with `enable_status_check` and `verify` in `status_check_contexts`); a Forgejo bootstrap would set it there instead of the ruleset (not written yet).
- The update stays a merge and a push from the Factory's own checkout (`git merge` of the base branch, the agent only on a conflict, then Verify, then `git push --force-with-lease`), not the forge's "Update branch" button or API: the Factory has to run Verify on the merge before it pushes, and that path is the same on both forges. Listing the open PRs, telling a fork's head from the repository's and commenting on a PR are the only forge calls it adds.
- A fork's PR (and an AGit PR) is never pushed to: it gets one comment asking its author to update the branch.

## Runner and registry

- A runner of your own with Docker, ephemeral and one job at a time, with its own labels. Forgejo's reusable-workflow secrets scope only applies to jobs called through a reusable workflow; elsewhere a job sees all the owner's and repo's secrets, so keep jobs that hold secrets on a separate runner.
- The image goes to the instance's own container registry, not GHCR.
- The Verify seam uses whatever the target repo has (typecheck, lint, tests, E2E, preview, screenshots) and should say where it is minimal.

## Not done

Hardening of the preview CI on Forgejo (automatic write token in `build`, `pull_request_target` with any base branch, no `workflow` scope) is left for the install, which is meant for a private repository with its own runner. The defects found in Forgejo (the base-branch YAML, the token documentation, `environment:` ignored without a warning) are for the owner to report.
