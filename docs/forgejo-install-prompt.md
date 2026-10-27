# Install the Factory on a Forgejo repository

One prompt. Give everything below the line to an agent working in a clone of an **existing** repository hosted on Forgejo, with its own stack. It installs the Factory's harness there, with the same flow as this template on GitHub: a ready issue becomes a reviewed pull request with evidence, waiting at the Merge Gate.

Nothing in it has run on a Forgejo yet. The portability notes it relies on are in [forgejo.md](forgejo.md); the decisions are in `docs/adr/`.

---

You are installing the Factory, an issue-to-pull-request harness, in this repository. It is hosted on Forgejo and already has its own code and stack. The source is the Factory Template repository (call it `TEMPLATE`; clone it next to this one). Work on a branch, in small Conventional Commits, and open one pull request at the end. Before you use any Forgejo API, CLI, runner flag or workflow feature, read the official documentation for the version this instance runs (`GET /api/v1/version`); the names below were checked against Forgejo v15 LTS to v17 and Forgejo Runner v13, and may differ.

Read first: `TEMPLATE/AGENTS.md`, `TEMPLATE/GLOSSARY.md`, `TEMPLATE/.factory/AGENTS.md`, `TEMPLATE/docs/forgejo.md` and ADRs 0002, 0005, 0006, 0012, 0013 and 0014 in `TEMPLATE/docs/adr/`. Use the glossary's terms (Factory, Stage, Escalation, Merge Gate, Verify, ...) as written.

## 0. Check the instance

- Stop and ask the owner if the instance lacks the security release of 2026-08-20 (v16.0.3 on the v16 line; on the v15 LTS, check its release notes for the same fix): before it, local reusable workflows under `pull_request_target` were read from the pull request's head. Prefer v16.0.3 or later on v16.0.x, or a v15 LTS release with that fix; v17.0.0 shipped with an upstream warning against upgrading.
- Note whether the instance is v15 or later: only then can a token be restricted to this one repository.
- Install on a self-hosted Forgejo instance, never on Codeberg: its terms forbid mostly AI-generated projects and its hosted runners stop at 10 minutes.

## 1. Copy only the harness

Copy from `TEMPLATE`:

- `.factory/` (CLI, commands, adapters, prompts, tests, `image/Dockerfile` and `image/setup.sh`).
- The workflows, moved from `.github/workflows/` to `.forgejo/workflows/`: `factory-image.yml`, `factory-issue.yml`, `factory-triage.yml`, `factory-unblock.yml`, `factory-pr-feedback.yml`, `factory-update-branches.yml`, `factory-retro.yml`, `factory-skills-update.yml`, and from `factory-pr.yml` the jobs `image`, `build` (with the `Verify` command of step 4, not the per-Product matrix of `plan`; drop `plan` from its `needs` and its `if:`), `skills-check` and `verify` (the aggregate check: it fails when any job it `needs` failed; drop `plan` and `ci-probe` from its `needs`).
- `AGENTS.md` (rewrite the Map, Commands and "Building a product" sections for this repository; keep the Rules), `GLOSSARY.md`, `CODING_STANDARDS.md`, `docs/agents/`, `docs/adr/`.
- `.agents/skills/` with `skills-lock.json`, and the `.claude/skills/<name>` symlinks to them. Leave out the `skeleton-*` skills and `workers-best-practices` unless this stack uses them.
- `.claude/settings.json` as it is (it only denies `pnpm bootstrap destroy`).

Leave out: `packages/skeleton/`, `apps/`, `pnpm new-product`, `.factory/src/bootstrap/` (the Products' bootstrap: Cloudflare, Neon, Resend, environments), `factory-deploy.yml`, `factory-pr-cleanup.yml` and the preview jobs of `factory-pr.yml`. Remove from `.factory/` whatever only served them, and the tests with it: done when nothing left imports `bootstrap/`, the preview or deploy code of `ci/`, or a Product path, and the harness tests pass. If this repository is not a Node workspace, keep `.factory/` as its own package with its own `package.json` and lockfile.

## 2. Workflows on Forgejo Actions

- Forgejo reads `.forgejo/workflows/` when it exists and GitHub ignores it. Keep the events Forgejo has: `push`, `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `pull_request_target`, `schedule`, `workflow_call`, `workflow_dispatch`. There is no `workflow_run`, no `concurrency.queue: max`, no `gh`, no `claude-code-action`: replace `gh` calls with the CLI's own commands or `curl` against the REST API.
- Every `runs-on:` names a label of this repository's own runner (step 5), never a hosted one.
- Keep `#N` in each `run-name` (`"#N <title>"`, `"#N update branch"`, `"PR #N update branch"`, `"Retro of #N"`, `"Retro of PR #N"`): the Retro finds an issue's runs by that title. Port `GitHubRunLogs` (`.factory/src/adapters/github/run-logs.ts`) to the Forgejo Actions API and artifacts.
- Quote every YAML value that contains ` #` (`run-name: "#${{ inputs.issue }} ..."`, or any `name:` or `if:` with ` #` in it). Unquoted, the rest of the line is a comment and the workflow does not load, with no run to show it. Load every workflow once after you change it.
- Swap `GITHUB_TOKEN` for the job's automatic token (`${{ secrets.GITHUB_TOKEN }}` / `${{ forgejo.token }}`, check which this version exposes) and keep `FACTORY_TOKEN` only where the template has it: the `publish` jobs (issue, PR feedback, update branches, skills update, Retro) and the Triage's `apply`. `claim`, `notify`, the scans and every `work` job use the automatic token, never `FACTORY_TOKEN`.

### `pull_request_target` takes the YAML of any base branch

GitHub runs `pull_request_target` from the default branch. Forgejo takes it from the pull request's **base** branch, whatever it is: anyone who can push a branch `x` with an altered workflow and open a pull request into `x` runs that YAML with the secrets. So: protect `main`, keep no long-lived branch other than `main` that carries a `pull_request_target` workflow, and give the Factory's identity no write access beyond what it needs. Under `pull_request_target`, pull request code can also write the runner cache: use no cache in privileged jobs. Write this in the installed `docs/known-risks.md`.

## 3. The Forgejo adapters

Write `.factory/src/adapters/forgejo/` with a `Tracker` and a `CodeHost` (interfaces in `.factory/src/seams/`), over the REST API directly (`fetch` + Zod, the token held inside the adapter, never in argv), like `adapters/github/`. Select them with `FACTORY_ADAPTERS=forgejo` (the instance URL and `owner/repo` from the job's environment, token `FACTORY_TOKEN` else the job token).

- **Done** is `closed`: Forgejo has no `state_reason`, so a `Blocker` is done when its issue is closed.
- **Draft** is a title that starts with `WIP:`. `markReady` removes the prefix; opening a draft adds it.
- **Evidence** (the screenshots of `@evidence` tests, the prints): upload them as assets through the REST attachment endpoints of the issue or comment, then swap the body's references for the asset URLs. The `fj` CLI cannot upload attachments.
- **Blockers and sub-issues**: use the issue dependencies endpoints for blockers; for the parent spec, use what this version offers and say in the pull request what you chose.
- **`labelOrigin`**: read it from the issue timeline (label events with their actor), so the Factory's own `ready-for-agent` → `agent:explore` swap is recognized as a swap (same actor, removal just before).
- **`conversation`**: the pull request's issue comments plus the bodies of submitted reviews, oldest first, ids `comment-<id>` and `review-<id>`.
- **`fork`**: true for a head in another repository and for an AGit pull request (`refs/for/...`). The Factory never pushes to either.
- **Pushes** stay `git push --force-with-lease` from the Factory's own checkout, with the token in the environment.

Test them like the GitHub adapters: the commands' behaviour is already covered through the CLI with the fakes (`adapters/fake/fake-tracker.ts`, `fake-code-host.ts`); for the new adapters, add tests that replay recorded Forgejo responses through a stubbed `fetch` and check each one returns what the fake returns for the same state. Do not change the seams' interfaces to fit Forgejo; if one cannot be met, say so in the pull request.

## 4. `Verify`

The `Verify` seam runs one command in the working copy (`pnpm factory:verify` in the template). Build that command from what this repository already has: its typecheck, lint, tests, end-to-end tests and Evidence, in that order, failing on the first error. Run the same command in the `build` job of the pull request workflow, so the status check `verify` (step 6, the aggregate job) covers what the Factory ran. Where something is missing (no typecheck, no tests, no E2E, so no Evidence), keep a minimal implementation, and write in the installed `AGENTS.md` and in the pull request where it is minimal and what would complete it.

## 5. Runner and image

- Build the image from `.factory/image/Dockerfile` and `setup.sh` (add this stack's toolchain to `setup.sh`) and push it to the instance's own container registry, not GHCR.
- Set up a runner of the repository's own, on a dedicated VM with Docker and no secrets on disk: register it with `forgejo-runner register --ephemeral --labels <label> ...` (or `forgejo forgejo-cli actions register --ephemeral` on the server), and run it with `forgejo-runner one-job --wait` in a loop that wipes the workspace and Docker after every job. One job at a time, its own labels.
- A job sees all the owner's and repository's secrets unless it is called through a reusable workflow. Put jobs that run the agent or pull request code on a separate runner (label) from the jobs that hold `FACTORY_TOKEN`.
- Write the steps you could not do yourself (the VM, the registration token) as a checklist for the owner in `docs/self-hosted-runner.md`.

## 6. Labels, branch protection and token

- Create the labels of `docs/agents/triage-labels.md`: the five triage labels and the Factory labels (`in-progress`, `agent:explore`, `harness-change`, `retro`). Drop `preview` and `product:<id>` unless this repository uses them, in `.factory/src/config.ts` and the table together.
- Protect `main` (`POST /repos/{owner}/{repo}/branch_protections`): no direct push, `enable_status_check: true`, `status_check_contexts: ["verify"]` (the exact context name the runs report), and `block_on_outdated_branch: true`, so a `verify` that ran against an older `main` never merges.
- `FACTORY_TOKEN` is the owner's token. On v15 or later restrict it to this repository, with only `write:repository` and `write:issue`. There is no `workflow` scope on Forgejo: **a token with `write:repository` can change `.forgejo/workflows/`**. The Factory does not refuse those changes (ADR 0012): it flags them. The defence is the human review of the flagged pull request and keeping the token out of `work`. Tell the owner this in the pull request.
- The Merge Gate notice (`pnpm factory notify`) is written with the job's automatic token, never `FACTORY_TOKEN`, so the requester is notified.

## 7. The flows that must keep working

Check each of these on Forgejo and adapt the workflow or adapter until it holds:

- **Sensitive paths are flagged, not refused** (ADR 0012). Add `.forgejo/workflows/` to the sensitive paths in `.factory/src/paths.ts`. A Factory pull request that touches one gets `harness-change` and a warning naming the files; nothing blocks it.
- **Every open pull request is kept up to date with `main`** (ADR 0014). With `block_on_outdated_branch`, `factory-update-branches.yml` runs on each push to `main` and, for every open pull request that is behind, merges `main` in the Factory's own checkout (the agent only on a conflict), runs `Verify`, then pushes with a lease. Never use the forge's "Update branch" button or API: it skips `Verify`. A fork's pull request or an AGit pull request is never pushed to: it gets one comment asking its author to update the branch.
- **Skills follow upstream with an automatic merge** (ADR 0013). `factory-skills-update.yml` opens or reuses the `skills/update` pull request; instead of `gh pr merge --auto`, schedule the merge for when the checks pass (`POST /repos/{owner}/{repo}/pulls/{index}/merge` with `"Do": "merge"` and `merge_when_checks_succeed: true`). If this version or the protection refuses it, leave the merge manual and say so in `AGENTS.md`: then a person merges `skills/update`.
- **Automatic Retro**: `factory-retro.yml` runs after every Escalation (dispatched by `publish`) and on a closed Factory pull request (it goes on only when a writer left an unmarked thread or review), finds the runs through `#N` in their titles, and opens or edits `Retro: #N <title>` with `needs-triage` + `retro`.
- **The Triage starts on its own**: when the guard refuses an issue for missing seams, `claim` swaps `ready-for-agent` → `agent:explore` and dispatches `factory-triage.yml` itself (`workflow_dispatch` through the API), because a label event made with the job's token starts no workflow. The Triage trusts that `agent:explore` because the same actor had just removed a `ready-for-agent` put by a writer; a stranger's `agent:explore` stays untrusted.
- **Comments in the Conversation tab trigger pull request feedback**, not only line comments: `factory-pr-feedback.yml` listens to `issue_comment` on pull requests as well as `pull_request_review` and `pull_request_review_comment`, and a writer's comment or review body after the last Factory-marked one is a request of the round.
- **The Factory marker** (`<!-- factory -->`) is how the Factory knows its own texts, since it writes as the owner (ADR 0002). Keep it in every text the adapters write.

## 8. Prove it end to end

1. Run the harness tests and the new `Verify` command locally; both pass.
2. Open the installation pull request. It changes `.forgejo/workflows/`, so it must carry the `harness-change` label and warning; ask the owner to review and merge it.
3. After the merge, open a small test issue in this repository: a parent spec with `## Testing Decisions` and a child with `## Acceptance criteria` for a tiny, real change in this stack. Apply `ready-for-agent` to the child as the owner.
4. Follow it end to end: `claim`, `work`, `publish`, the pull request opened from `factory/issue-N`, the `verify` check green, the Evidence shown in the body, the Review Stage, and the Merge Gate notice. The run is done when the pull request is ready (no `WIP:`) and waiting at the Merge Gate. Fix what breaks, in the same way, until it is.
5. Report to the owner: what was installed, where `Verify` is minimal, whether the skills auto-merge is on or manual, the runner checklist, and the open risks (`write:repository` reaches `.forgejo/workflows/`, `pull_request_target` from any base branch).
