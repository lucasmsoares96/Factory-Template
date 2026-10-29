# Known risks and limits

Things the base knowingly lives with. Each says what it is, how likely it bites, and what to do.

## Runtime

- **Workers Free allows 10 ms of CPU per request, and the Worker's measured p50 is 21 ms** (p99 116 ms). No `exceededCpu` has been seen in the samples, so the limit looks tolerated, not guaranteed. Watch it when real traffic arrives (`workersInvocationsAdaptive` in the GraphQL Analytics API); the move is to the Paid plan.
- **The CPU of `/mcp` cannot be separated.** The Workers analytics do not group by path, so there is no number for the tool registration (the handler is stateless and registers every tool on every request), input and output validation with JSON Schema, the internal `app.request` and the provider's KV reads. The CPU of rendering the email is also unmeasured (Resend was deferred, the preview uses the outbox).
- **The `PasswordHasher` can use 843 ms in one invocation** (the typical hash is about 112 ms). It runs on the Durable Object's budget, not the request's; the same object serializes calls, which is why there is a pool of 16 names.
- **Neon Free caps previews at about 9 at once** (10 branches per project). Above it the preview is skipped.
- **Free-plan quotas are per account**: see "Free-plan ceilings" in `docs/measured-facts.md`.

## Skeleton

- **The Owner check of an account deletion is not atomic with the deletion.** `beforeDelete` (`src/platform/auth-options.ts`) reads the user's Owner rows, then Better Auth deletes the user in a separate statement. A Company the same user creates from another session in that window loses its only Owner when the Members cascade. It takes two concurrent requests by the same user, so it is unlikely; if it matters (an ownership transfer, say), lock the user's Member rows or move the check into a database constraint.
- **The Stripe plugin's webhook answers 200 even when it fails to save** (better-auth#10534). If the database write for a Subscription event fails, Stripe sees a success and does not retry, so the Subscription in Postgres can stay behind Stripe's until the next event for it. Billing reads Plans from Stripe, but a person's Subscription comes from this webhook. Unlikely (it takes a failing write at the moment of the event); if it bites, replay the event from the Stripe dashboard. Watch the Worker logs for the plugin's errors.

## The Factory

- **The skipped-test check has false positives** (`src/skipped-tests.ts`). It scans added lines of test files for `test.fixme|skip|only`, `it|describe.skip|only`, `xit(`, `xdescribe(`. It cuts strings and comments cheaply, so it still flags a marker inside a multi-line template literal or in the middle of a block comment, and a conditional `test.skip(cond)` inside a test body. It cannot see a test that passes without asserting anything.
- **The Triage can claim what it did not check.** In one run it suggested importing a constant the Skeleton does not export. A Triage comment is a plan, not a proof.
- **A Review can undo a request that a human made in a PR thread**, unless it is shown the thread. Fixed (the Review and the Pull Request Stage receive the round's threads and the Factory's decision); keep it in mind when changing those prompts.
- **All screenshots of a pr-feedback round enter the PR body**, including screens the change does not touch. Correct by the criterion, noisy to read.
- **A Product issue that waits on its Skeleton issue stays blocked if that issue is closed as "not planned"** (a human rejects the Skeleton pull request). GitHub counts only a `completed` close as done, so `factory-unblock.yml` finds it still blocked and says nothing. Remove the dependency and re-add `ready-for-agent`, or escalate the Product issue by hand.
- **The Skeleton pull request is not opened when its branch `factory/issue-<skeleton issue>` already exists**: `publish` never overwrites a branch, logs it, and leaves the `ready-for-human` Skeleton issue (and any Product issue blocked by it) without a pull request. The diff is still in the run's `work-out` artifact (`skeleton.patch`).
- **A comment by a human that contains `<!-- factory -->` is ignored** by the PR-feedback flow (ADR 0002).
- **A Product that never published is invisible to a push deploy** until a merge affects it (see `docs/measured-facts.md`).
- **The Factory's workflow changes cannot be tested from their own PR** (`pull_request_target`, ADR 0006).
- **Third-party skills reach every agent without review** (ADR 0013): `factory-skills-update.yml` merges upstream changes to the locked skills on its own once `verify` is green.
- **A workflow the Factory writes can run with secrets before review** (ADR 0012): an `on: push` workflow pushed to a `factory/issue-N` branch runs on that push. Sensitive paths are only flagged on the PR.
- **Every push to `main` updates every open PR that is behind it**, people's PRs included: the Factory pushes a merge commit (and, when Verify fails, its fixes) onto a person's branch. A run that does not pass Verify after 5 attempts pushes nothing and says why on the PR. A branch the person moved meanwhile is never overwritten (lease).
- **An update that brings workflow changes from `main` may be refused**: `FACTORY_TOKEN` has no `workflows` permission, and GitHub refuses a push that adds or changes `.github/workflows/` without it (unverified for a merge of commits already on `main`). The PR then needs a manual update.
- **Never demonstrated live**: a Factory PR in conflict with `main` (`update-branch` is covered by tests), the update of a person's PR or a fork's comment, the cap of 9 previews, `bootstrap destroy` against real accounts, the self-hosted runner on a real VM, a session resumed to extract output with real Claude (Claude returned the block the first time; the adapter test uses a fake `claude`).

## Tokens

- **A classic personal access token cannot be limited to one repository.** `repo` is the narrowest useful scope and reaches every repository the owner can. It was the machine-user design; it is gone (ADR 0002). The classic form also had a way to read scopes (`X-OAuth-Scopes`), which the fine-grained one lacks.
- **A fine-grained token's permissions cannot be read back.** GitHub offers only `X-Accepted-GitHub-Permissions` (what an endpoint needs, not what the token has), and `permissions.push` on `GET /repos/{o}/{r}` shows write access, nothing more. A stray `workflows` permission is therefore undetectable and the wizard can only warn. A pre-filled link cannot choose repositories either (checked 2026-10-21): "Only select repositories" is a manual click.
- **`FACTORY_TOKEN` has no expiry** (`expires_in=none`) and acts as the owner. The protection is that it never reaches the `work` job and that `publish` runs `main`'s harness.
- **The Factory cannot approve its own PR, and neither can the owner.** The ruleset asks for 0 approvals; the Merge Gate is a merge, not a review requirement.
- **In the `safe` Merge Mode, Product code reaches production with no person looking** (ADR 0016). The brakes are the Review, `verify`, the preview smoke, the verdicts in the PR body (which a writer can edit) and a failed deploy of `main`; everything in `PROTECTED_PATHS` still waits for a person.
- **In the `all` Merge Mode, nothing waits for a person** (ADR 0016): the Factory may merge changes to its own rules (workflows, the guard, prompts, `config.ts` and its `PROTECTED_PATHS`), so one bad pull request can loosen every later brake. Only `verify`, the preview smoke, the verdicts and the last deploy of `main` stop it. `bootstrap factory` asks for a typed confirmation and the doctor warns while it is on.

## Self-hosted runner

See `docs/self-hosted-runner.md`: never on a public repo, and the host's `docker.sock` makes the VM root-equivalent.
