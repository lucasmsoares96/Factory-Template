# Known risks and limits

Things the base knowingly lives with. Each says what it is, how likely it bites, and what to do.

## Runtime

- **Workers Free allows 10 ms of CPU per request, and the Worker's measured p50 is 21 ms** (p99 116 ms). No `exceededCpu` has been seen in the samples, so the limit looks tolerated, not guaranteed. Watch it when real traffic arrives (`workersInvocationsAdaptive` in the GraphQL Analytics API); the move is to the Paid plan.
- **The CPU of `/mcp` cannot be separated.** The Workers analytics do not group by path, so there is no number for the tool registration (the handler is stateless and registers every tool on every request), input and output validation with JSON Schema, the internal `app.request` and the provider's KV reads. The CPU of rendering the email is also unmeasured (Resend was deferred, the preview uses the outbox).
- **The `PasswordHasher` can use 843 ms in one invocation** (the typical hash is about 112 ms). It runs on the Durable Object's budget, not the request's; the same object serializes calls, which is why there is a pool of 16 names.
- **Neon Free caps previews at about 9 at once** (10 branches per project). Above it the preview is skipped.
- **Free-plan quotas are per account**: see "Free-plan ceilings" in `docs/measured-facts.md`.

## The Factory

- **The skipped-test check has false positives** (`src/skipped-tests.ts`). It scans added lines of test files for `test.fixme|skip|only`, `it|describe.skip|only`, `xit(`, `xdescribe(`. It cuts strings and comments cheaply, so it still flags a marker inside a multi-line template literal or in the middle of a block comment, and a conditional `test.skip(cond)` inside a test body. It cannot see a test that passes without asserting anything.
- **The Triage can claim what it did not check.** In one run it suggested importing a constant the Skeleton does not export. A Triage comment is a plan, not a proof.
- **A Review can undo a request that a human made in a PR thread**, unless it is shown the thread. Fixed (the Review and the Pull Request Stage receive the round's threads and the Factory's decision); keep it in mind when changing those prompts.
- **All screenshots of a pr-feedback round enter the PR body**, including screens the change does not touch. Correct by the criterion, noisy to read.
- **A comment by a human that contains `<!-- factory -->` is ignored** by the PR-feedback flow (ADR 0002).
- **A Product that never published is invisible to a push deploy** until a merge affects it (see `docs/measured-facts.md`).
- **The Factory's workflow changes cannot be tested from their own PR** (`pull_request_target`, ADR 0006), and the five `factory-*.yml` files are protected paths, so a person edits them.
- **Never demonstrated live**: a Factory PR in conflict with `main` (`update-branch` is covered by tests), the cap of 9 previews, `bootstrap destroy` against real accounts, the self-hosted runner on a real VM, a session resumed to extract output with real Claude (Claude returned the block the first time; the adapter test uses a fake `claude`).

## Tokens

- **A classic personal access token cannot be limited to one repository.** `repo` is the narrowest useful scope and reaches every repository the owner can. It was the machine-user design; it is gone (ADR 0002). The classic form also had a way to read scopes (`X-OAuth-Scopes`), which the fine-grained one lacks.
- **A fine-grained token's permissions cannot be read back.** GitHub offers only `X-Accepted-GitHub-Permissions` (what an endpoint needs, not what the token has), and `permissions.push` on `GET /repos/{o}/{r}` shows write access, nothing more. A stray `workflows` permission is therefore undetectable and the wizard can only warn. A pre-filled link cannot choose repositories either (checked 2026-10-21): "Only select repositories" is a manual click.
- **`FACTORY_TOKEN` has no expiry** (`expires_in=none`) and acts as the owner. The protection is that it never reaches the `work` job and that `publish` runs `main`'s harness.
- **The Factory cannot approve its own PR, and neither can the owner.** The ruleset asks for 0 approvals; the Merge Gate is a human merge, not a review requirement.

## Self-hosted runner

See `docs/self-hosted-runner.md`: never on a public repo, and the host's `docker.sock` makes the VM root-equivalent.
