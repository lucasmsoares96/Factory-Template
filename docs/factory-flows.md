# Factory flows

The detail of the Factory's flows on the forge: which workflow runs which jobs, with which token, and what each writes. `.factory/AGENTS.md` keeps the short version; the code is in `.factory/src/`.

## Adapters on GitHub

- `src/adapters/github/` is the GitHub Tracker and CodeHost. `api.ts` is `fetch` + Zod, and holds the token.
- `git push --force-with-lease` and `gh pr comment --attach` get the token through their environment, never their argv.
- `markReady` and the 👀 on a submitted review are the GraphQL calls: REST has neither.
- `FACTORY_ADAPTERS=github` picks these adapters (`GITHUB_REPOSITORY`, token `FACTORY_TOKEN` else `GITHUB_TOKEN`).

## The Factory marker

`src/marker.ts`, `<!-- factory -->`. The Factory writes as the owner, so it knows its own texts by this hidden marker, never by the author.

- The write adapters add it (`marked`) to every text: issue and PR comments, PR body, reviews and their inline comments, thread replies, the Triage comment. Callers do not.
- Readers:
  - `openThreads`: a thread whose last comment is marked is the Factory's turn. Every comment must come from a `write`+ author, so a stranger's forged marker never reaches the agent. In the Conversation tab, writers' comments and review bodies after the last marked one are open (see [PR feedback](#pr-feedback)).
  - `guard.isFactoryComment`: Triage and Waiting comments, marker plus a `write`+ author.
  - the `wait` job's `if` in `factory-pr-feedback.yml`.
- A human comment that contains the marker is ignored (accepted trade).

## `in-progress` and `factory:working`

`src/commands/working.ts`.

- `in-progress` is the lock, taken by `claim` and held until the merge or an Escalation, also while the PR only waits at the Merge Gate; it never changes meaning.
- `factory:working` says a run is going right now: each run puts it on at its start and takes it off at its end, whatever the outcome (ready, Escalation, "Run discarded", a refusal, a failed job).
- It goes on:
  - in the issue flow at `claim` (the issue and its open PR) and on the PR `publish` opens (`PublishOptions.markWorking`, with the `GITHUB_TOKEN` job token that step holds next to `FACTORY_TOKEN`);
  - in a feedback round or a branch update at the claim (the PR, and the issue when there is one);
  - in the Triage in a `start` job (`working on --triage`: each issue of the batch, the list handed to `done`);
  - in the Retro at `retro-collect` (the origin issue only).
- It comes off in the last step of the last job (`pnpm factory working off [<issue>...] [--pr <n>]`, `if: always()`). An issue brings its open Factory PR along, and the issue flow also passes the PR its claim marked, which `publish` may have closed.
- `off` keeps the label where another Factory run is queued or going (`CodeHost.activeRuns`, read from the run titles: `#N` an issue, `PR #N` a PR, the Triage (`Factory triage`) keeps the issues still in `agent:explore`), never counting its own run (`GITHUB_RUN_ID`).
  - A run that its first job's own condition skips, such as the ones the Factory's own label swaps and marked texts start, names nothing in its `run-name` and keeps nothing.
  - When the runs cannot be listed it comes off anyway.
- A cancelled or interrupted run never reaches its end: `update-branch --scan` takes the label off every open issue and PR with no Factory run queued or going (when the runs cannot be listed it touches nothing).
- Every write is best effort (logged, never fails the run), and only the job token writes it: a label put with `FACTORY_TOKEN` would start `issues: labeled` and `pull_request_target: labeled` workflows.
- An accepted feedback round also puts 👀 on the comment or review that started it (`--event`, `--comment-id` from the event; `CodeHost.react`).

## Issue flow

`.github/workflows/factory-issue.yml`, off until `FACTORY_ENABLED`. Group `factory-<N>`, no cancel.

1. `claim`: job token, `issues: write`, `pull-requests: write`, `actions: write`; `pnpm factory claim`, outputs `claimed`, `start_sha` and `pr` (the open PR it marked `factory:working`) through `$GITHUB_OUTPUT`.
   - A `missing-seams` refusal swaps `ready-for-agent` → `agent:explore` and dispatches `factory-triage.yml` with no inputs, since a job-token label event starts no workflow. A failed dispatch is logged and the issue waits for the next Triage run.
2. `image`: the reusable image job.
3. `work`: the image, `contents: read` + `issues: read`, only Claude's secrets, `runs-on: vars.FACTORY_RUNNER || ubuntu-latest`, 350 min. Uploads `work-out`: bundle, `result.json`, prints, `stream-json`, 14 days.
   - It reads the issue with its read-only job token, which the Agent's env allowlist never passes on.
4. `publish`: fresh VM, `FACTORY_TOKEN`, the default branch's harness, `if: always()`: no artifact means Escalation "infra". Outputs `outcome` and `url`. The job token, with `actions: write`, dispatches the Retro of an Escalation. Its last step is `working off` with the job token.
5. `notify`: the Merge Gate notice, `pnpm factory notify <N> --outcome ready|escalated [--updated] --url --to`.
   - It runs after `publish` in `factory-issue.yml` and `factory-pr-feedback.yml` with the job's `GITHUB_TOKEN` (never `FACTORY_TOKEN`): the comment appears as `github-actions[bot]`, mentions who applied `ready-for-agent` (`claim` writes `requester` to `$GITHUB_OUTPUT` before the lock) or who commented, and fires no workflow.

## Skeleton changes in a Product issue

`src/scope.ts`, ADR 0008. A Product issue never changes `packages/skeleton/`.

- `work` takes the Skeleton change as Development left it (the Review may undo it itself), reverts what is left after the Review, and writes it, against the base, to `skeleton.patch` in `out` (a file changed in several attempts keeps its last version).
- The follow-up in `result.json` names it (`patch`) and carries the `<skeleton-gap>` texts (`gaps`).
- `publish` applies the patch on the base in a throwaway worktree before anything else and refuses it (Escalation `infra`) if it does not apply or touches anything outside `packages/skeleton/`.
- Then it opens the "The Skeleton must grow" issue as `ready-for-human` and a pull request of its own (branch `factory/issue-<skeleton issue>` from the base, never a draft, `Closes #<skeleton issue>`, the Product issue and the gaps in the body). A gap with no file is only an issue, `needs-triage`, no PR.
- A Product issue that meets its criteria without the Skeleton (`criteriaMetWithoutSkeleton`) gets its ready PR as before and blocks on nothing.
- One that cannot (the issue flow only; a PR round escalates `needs-human`) ends `waiting`: no Pull Request Stage, no Product PR and no Escalation.
  - `publish` adds each Skeleton issue as a blocker (`Tracker.addBlocker`: GitHub `POST /issues/{n}/dependencies/blocked_by` with the blocker's `id`, the Markdown `Blocked by:` line, the fake in memory), comments once (with the guard's "Waiting on" marker) and swaps `in-progress` → `ready-for-agent`.
  - The run that label starts is refused by the guard and says nothing more. `factory-unblock.yml` queues the issue again when the Skeleton issue closes (see [Unblock](#unblock)), and that run starts from the base that has the new Skeleton.

## Triage

`.github/workflows/factory-triage.yml`, label `agent:explore`, off until `FACTORY_ENABLED`.

- Jobs, meeting only in the `triage-out` artifact (`triage.json`):
  1. `start`: job token, `working on --triage`.
  2. `image`.
  3. `work`: the image, read-only, Claude's auth only, `pnpm factory triage --out`.
  4. `apply`: fresh VM, `FACTORY_TOKEN`, `pnpm factory apply --in`.
  5. `done`: `if: always()`, `working off` the batch.
- One global group `factory-triage` without cancel: a label event during a run replaces the pending run, which sweeps every issue still in Triage.
- `triage` reads only the issues whose label is trusted (`guard.trustedExplore` over `Tracker.labelOrigin`: put by `write`+, or the Factory's own swap, the same actor having just removed a `ready-for-agent` put by `write`+; the job token's `github-actions[bot]` cannot write itself).
- It runs ONE session over the batch and ends with `<triage>{"issues": [...]}</triage>` (`src/triage-output.ts`). Each verdict has:
  - `tag` `easy-call|needs-a-human|blocked`, difficulty, files, claims, questions, approach;
  - `references`: each import, export, function, route or file the approach cites, with `foundAt`. `triage` checks each in the checkout (`checkReferences`: the file must exist inside it and hold the symbol), and the comment lists the rest under "Not found in the code (unchecked)";
  - `door`, `seams` with what each catches and lets through, `product`, `duplicateOf`.
- The block is extracted with the Agent seam's resume (max 2, validator: every issue of the batch has a valid verdict; an easy-call needs a seam).
- Fallback, after 2 failed resumes or a timeout: each issue without a valid verdict gets `needs-a-human` (door one-way, session's last words in the comment); nothing is queued on a guess.
- `apply` trusts only the shape of `triage.json`:
  - it re-reads the forge (still `agent:explore`, label trusted by the same rule);
  - posts the one `<!-- factory:triage -->` comment (rendered by the harness, before the label swap: `ready-for-agent` starts a run whose guard needs it);
  - then swaps `agent:explore` → `ready-for-agent` / `ready-for-human` / `needs-info` and, only after that swap (the lock), removes `needs-triage` if the issue has it;
  - a duplicate is never queued (`ready-for-human`);
  - it adds `product:<id>` only when the issue has none and `apps/<id>` exists.
- `pnpm factory local NN` on a ticket with Status `agent:explore` runs `triage` in the container and `apply` on the host.

## Unblock

`.github/workflows/factory-unblock.yml`, `issues: closed` + dispatch, no cron, off until `FACTORY_ENABLED`.

- `pnpm factory unblock` with the job token (`actions: write`, no secret) sweeps the open `ready-for-agent` issues, runs the guard on each and dispatches `factory-issue.yml` for those it accepts.
- Before the sweep, `--issue N` (the closed issue of the event, a hint: the forge says if it is closed) removes `in-progress` from it, so a merged Factory PR does not leave the label behind; the job has `issues: write` for that.
- Still-blocked ones get no comment (the guard wrote "Waiting on…" on `labeled`); other refusals are left to `claim`.
- A failed dispatch does not stop the sweep (exit 1 at the end).

## PR flows

`work <N> --flow pr-feedback|update-branch --pr <n>`, then `publish <N> --pr <n>`; `commands/pr-claim.ts` guards both.

- `publish` pushes with `FACTORY_TOKEN`, so the PR's CI runs again (the `GITHUB_TOKEN` that step holds only dispatches the Retro of an Escalation). The guarantee is the lease: `Run discarded` when the branch moved, on the issue or, for a PR-keyed run, on the PR.

### PR feedback

`.github/workflows/factory-pr-feedback.yml` (`pull_request_review: submitted`, `pull_request_review_comment`, `issue_comment`; run `PR #N feedback`).

1. `wait`: a job with `sleep 180` in group `factory-feedback-<PR>`, `cancel-in-progress: true`; a submitted review skips the sleep.
2. `claim`: `pnpm factory pr-feedback --pr --actor --event --comment-id`, job token with `issues`/`pull-requests: write`. Needs an actor with `write`+, the PR open on `factory/issue-N`, the issue `in-progress`, and at least one open thread or Conversation request. Accepted: `factory:working` and 👀.
3. `image` → `work` → `publish`.

What a round reads:

- A thread is open until a Factory-marked comment has the last word (the Factory never resolves one).
- The Conversation tab (`CodeHost.conversation`: issue comments and submitted review bodies, oldest first) has no threads: every comment and review body by a writer after the last Factory-marked entry is a request of the round (`comment-<id>`, `review-<id>`, `in="conversation"` in the prompt). Entries by non-writers and by `github-actions[bot]` are never read.

What `work` does:

- It merges the base branch first (an agent resolves conflicts, `update-branch.md`), then Development with `pr-feedback.md`, Review, E2E.
- On the first attempt, a `<checks>` block (untrusted) holds the Actions jobs of the PR's head that ended in `failure` or `timed_out`, with the end of each log (`CodeHost.failedChecks`).
  - It uses the Actions API, read with the job token's `actions: read`, which only this `work` job has; 200 lines per job, 1,000 in all, cut from the start.
  - A check posted by another app is not seen. A read that fails puts its reason in the block and the round goes on.
- A `<replies>` block holds address, decline, defer or answer per thread. A round of declines, defers and answers makes no commit and skips Review.

What `publish` does:

- It posts the replies in their threads (`Address: …`).
- It answers all Conversation requests in one Conversation comment, each request quoted above its `Address|Decline|Defer|Answer: …`, which closes the round (a request written while the run was going is closed with it: accepted).
- After the 5 failures it comments on the PR and sets `ready-for-human` without making it a draft.

### Branch updates

`.github/workflows/factory-update-branches.yml` (`push` on the base branch; the scan's group cancels the previous scan, so only the latest push counts).

- It runs `pnpm factory update-branch --scan` with the job token (`actions: write`, `pull-requests: write` for the fork comment, `issues: write` with it for the orphan `factory:working`).
- Every open PR into the base branch whose head does not contain the base head (`git merge-base --is-ancestor`, the PR heads fetched as `refs/pull/*/head` and never run) is dispatched, clean or conflicting, drafts included, no cap.
  - A Factory PR whose issue is `in-progress` goes in the issue's flow (`issue`, run `#N update branch`, group `factory-<N>`).
  - Any other PR, a person's or a Factory PR whose issue is not `in-progress`, is keyed by the PR (`pr`, `update-branch --pr`, `work --flow update-branch --pr`, `publish --pr` with no issue; run `PR #N update branch`, group `factory-pr-<N>`).
- A fork's PR is never pushed to and none of its code runs: it gets one marked comment (`<!-- factory:update-fork -->`, never repeated) asking its author to update the branch, and `update-branch --pr` refuses it.
- The run merges with no agent when clean (conflict: the agent, "preserve both intents, do not invent new behaviour"; a branch that already contains the base runs nothing), runs Verify and enters the normal loop only if it fails. It runs no Pull Request Stage and leaves the PR body alone.
- A PR-keyed run reads no issue (the prompt names the PR), changes no label but `factory:working` on the PR, opens no PR, starts no Retro and comments only on the PR: what it merged, or why it stopped (after the 5 attempts, with them; nothing is pushed then).

## PR previews

`.github/workflows/factory-pr.yml`, off until `PREVIEWS_ENABLED` (set up by `pnpm bootstrap previews <id>`, see [factory-bootstrap.md](factory-bootstrap.md)). Logic in `.factory/src/ci/previews.ts`: gate, bindings check, Neon branch, preview config, URL, result, comment, `base`, cleanup.

1. `build`: PR code, no secrets; also uploads `bundle-<id>`.
2. `preview-plan`: `previews.ts gate`: affected ∩ `PREVIEW_PRODUCTS`, author `write`+ or the event of the `preview` label put by someone with `write`+; a push removes the label.
3. `deploy`: `main`'s checkout, the only job with Cloudflare and Neon preview secrets.
   - Allowlist check, bindings against `apps/<id>/wrangler.jsonc` of `main`.
   - Neon branch `preview/pr-N` from `base`, or "preview skipped: limit reached" at `FACTORY_PREVIEW_LIMIT` (9) open previews.
   - Migrations, the Skeleton's and the Product's, both from the artifact: `bundle` copies `packages/skeleton/drizzle` to `migrations/skeleton`; an artifact without it fails `migrate`, push again to rebuild it. The deploy of `main` and `previews.ts base` read them the same way.
   - `wrangler preview --name pr-N --worker-name <id> --config <preview config> --secrets-file --ignore-base-config`.
4. `smoke`: no secrets. Real sign-up, the email read at `GET /api/preview/outbox?to=`, sign-in, `/api/me`, `/mcp` 401.
5. `preview-comment`: one comment, edited.

- `factory-pr-cleanup.yml` on `closed` deletes the Worker Preview and the Neon branch.
- The deploy of `main` migrates `base` (`preview-base`) and recreates it when missing.
- The outbox route exists only with `EMAIL_TRANSPORT=outbox` and `PREVIEW_OUTBOX=true`, which only the preview config sets.
- A change to these workflows takes effect only after it is merged (`pull_request_target`).

## Automatic Retro

`.github/workflows/factory-retro.yml`, off until `FACTORY_ENABLED`, and with `FACTORY_RETRO_ENABLED=false`. Code in `src/commands/retro.ts`, `src/retro-output.ts`.

- What starts it:
  - `publish` dispatches it after every Escalation with the job token (`GITHUB_TOKEN`, `actions: write` on the `publish` jobs of the three flows: `FACTORY_TOKEN` may not dispatch a workflow). A failed dispatch is logged, never fails the Escalation.
  - `pull_request_target: closed` starts it for a Factory PR of this repository.
- Jobs:
  1. `collect`: job token, `actions: read`, `issues: write` for `factory:working` on the origin issue only. It goes on for a closed PR only when a writer left an unmarked thread or review, then writes `retro-in`: `issue.md` (writers' comments), `pull-request.md` (writer-only threads and reviews), `runs/<id>/` (each run's `work-out` artifact, found by `#N` or the issue's/PR's title in the run title: `GitHubRunLogs`, `gh run download`) and `sources.json`.
  2. `work`: the image, read-only, Claude's auth only. One session that reads `.agents/skills/retro/SKILL.md` and ends with `<retro>{"summary", "candidates": [{category, severity, title, proposal, evidence[]}]}</retro>`. No valid block after 2 resumes fails the run; nothing is published.
  3. `publish`: `FACTORY_TOKEN`. Creates `Retro: #N <title>` with `needs-triage` + `retro`, or edits the open one carrying `<!-- factory:retro:issue-N -->` and the Factory marker. No candidate = one comment on the PR (or the issue).
- It never applies `ready-for-agent`.
- The Review ends its summary with "Rules this review wanted and could not find", which the Retro reads.

## Skills update

Skills follow upstream (ADR 0013; `src/ci/skills.ts`).

- The PR's `skills-check` restores the skills and runs `skills.ts check --base <base sha>`, which fails only when the PR changed `.agents/skills/` or `skills-lock.json` and the restore does not reproduce it (an upstream change is a notice), then `skills.ts links`.
- `.github/workflows/factory-skills-update.yml` (push to the default branch, daily, dispatch; off until `FACTORY_ENABLED`):
  1. `fetch` (no secret) restores on the default branch and `skills.ts patch` uploads a patch of the skill paths only.
  2. `publish` (`FACTORY_TOKEN`): `skills.ts publish` refuses any other path, force-pushes `skills/update`, opens or reuses its PR and runs `gh pr merge --auto --merge`.
- The repo's `allow_auto_merge` is the `auto-merge` step of `pnpm bootstrap factory`.
