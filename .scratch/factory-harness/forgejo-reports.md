# Draft reports to the Forgejo project

Prepared 2026-10-18 from `research/19-forgejo-secrets-isolation.md`. **Nothing here has been posted or sent.**

## Read this first: Forgejo's AI Agreement

Forgejo's [AI Agreement](https://codeberg.org/forgejo/governance/src/branch/main/AIAgreement.md) covers **issues and comments**, not only code. Rule 4 lists "commit messages, pull request messages, documentation, code comments and issues". Text meant for people "must not have been generated with AI". Rule 1 says you must disclose AI help, including content "motivated by a suggestion of AI". The [Security Policy](https://codeberg.org/forgejo/governance/src/branch/main/SECURITY-POLICY.md) asks reporters to "communicate with human-written text".

They do enforce this. [PR #13769](https://codeberg.org/forgejo/forgejo/pulls/13769), which fixed `ref_protected`, was closed for that reason alone.

So **do not paste these drafts as they are.** Use them as a fact sheet:
1. Check every link yourself.
2. Write the report in your own words.
3. Add a disclosure line that is honest. For example: "I found this during a source review done with the help of an AI tool. I checked the code paths below myself and wrote this report myself." Only say this if it is true.

## Versions referenced

- Forgejo **v17.0.0** (tag `0d791421`, 2026-10-15) and **v16.0.6** (`1aa13944`, 2026-10-12). The relevant code is identical in both.
- Forgejo `forgejo` branch (main) at [`162ee1d3`](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df), 2026-10-18. All server line links below point to this commit, and every cited line was re-checked there.
- Forgejo Runner **v13.2.0** (`df6b843f`). Runner `main` (`c4a92ffa`) is unchanged for the cited code.
- Docs `next` at [`6bded37e`](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47). It is identical to the `v17.0` docs branch (`a907dfed`) for every cited file.

Link bases:
- `FJ` = `https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/`
- `DOCS` = `https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/`
- `RUN` = `https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/`

**Nothing was reproduced on a live instance.** Every finding comes from reading the source and the docs. The issue templates ask whether you reproduced the problem on https://dev.next.forgejo.org. Answer honestly ("Unknown / not tried"), or reproduce it there first. Reports 1 and 3 are cheap to reproduce.

## Summary

| # | Finding | Where | Action |
|---|---|---|---|
| 1 | `pull_request_target` runs the workflow from the PR's **base branch**, but the docs say the **default branch** (the stale-branch "pwn request" vector) | security@forgejo.org, encrypted | New private report |
| 2 | Docs say every `pull_request` token is read-only; same-repo PRs actually get write | forgejo/docs | New public issue, or a human-written docs PR |
| 3 | `jobs.<id>.environment` is silently ignored, with no warning (unlike `permissions`) | forgejo/forgejo | New public issue ("problem" template) |
| 4 | OIDC `ref_protected` is always `false`, but the docs say otherwise | forgejo/forgejo **#13759** (open) | Comment there, no new issue |
| — | `permissions:` ignored; all secrets sent to runner; protected-file patterns on branch creation; cache in `pull_request_target`; `workflow_dispatch` with the automatic token | — | **Do not report** (see the end) |

---

## Report 1: private, to security@forgejo.org

**Why private.** The [Security Policy](https://codeberg.org/forgejo/governance/src/branch/main/SECURITY-POLICY.md) counts bypassing controls so users "exceed their normal authorization limits" as serious-risk, which must go to the security email. The same policy lists "links in a possible vulnerability chain where other protections are ultimately in place" as public-OK.

This finding sits between the two:
- A fork contributor, who needs no approval for `pull_request_target`, can choose which branch's workflow runs with the repository secrets.
- The documentation promises the default branch.
- Exploiting it still needs a vulnerable `pull_request_target` workflow on some non-default branch.

The policy allows emailing them and asking for a judgement. Do that, and ask explicitly whether it can be made public. Encrypt the email with the key in [security.txt](https://forgejo.org/.well-known/security.txt) (fingerprint `1B638BDF10969D627926B8D9F585D0F99E1FB56F`).

**Dedup.** No public issue was found on this specific point. Related public items, which do not cover it:
- [#13238](https://codeberg.org/forgejo/forgejo/issues/13238): no approval for `pull_request_target`;
- [#10733](https://codeberg.org/forgejo/forgejo/issues/10733): fork `pull_request_target` token is read-only;
- [design#52](https://codeberg.org/forgejo/design/issues/52).

**Subject:** `pull_request_target` runs workflows from the PR base branch, not the default branch as documented (stale-branch workflows reachable by fork PRs)

**Body (fact sheet; rewrite in your own words):**

> **Affected:** Forgejo v16.0.6, v17.0.0 and `forgejo` branch at 162ee1d3 (and very likely all versions with `pull_request_target`).
>
> **Summary.** For `pull_request_target`, Forgejo loads the workflow files from the head of the pull request's *base branch*, whatever branch that is. The documentation says they come from the *default branch*. Anyone who can open a pull request, including from a fork without approval, can pick an older or non-default branch as the base. That branch's `pull_request_target` workflows then run with the repository and organisation secrets, OIDC (if enabled) and no approval step. If a maintainer fixed a vulnerable `pull_request_target` workflow on the default branch only, as the documentation suggests is enough, the vulnerable copy on other branches can still be triggered.
>
> GitHub had the same behaviour and changed it on 2025-12-08 for this reason: "The workflow file and checkout commit will always be taken from the repository's default branch, regardless of the pull request's base branch" ([GitHub changelog, 2025-11-07](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/)).
>
> **Documentation:**
> - [`docs/user/actions/reference.md` L178](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/reference.md#L178): "the workflow runs in the context of the default branch of the base repository".
> - The same page, [L173](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/reference.md#L173) and [L182](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/reference.md#L182), says "target branch", so the page contradicts itself.
>
> **Code (`forgejo` @ 162ee1d3):**
> - [`services/actions/notifier_helper.go` L257-282](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/notifier_helper.go#L257-L282): `baseRef := git.BranchPrefix + input.PullRequest.BaseBranch`. The `pull_request_target` workflows are detected at that commit and appended to `detectedWorkflows` before, and independently of, the approval logic.
> - [`services/actions/trust.go` L70](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/trust.go#L70): approval only applies to head-commit workflows of fork/AGit PRs. `pull_request_target` runs are never gated. The docs state this ("The on.pull_request_target workflows ... will always run").
> - [`models/actions/run_job.go` L217-235](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/models/actions/run_job.go#L217-L235): `CanAccessSecrets` returns true for fork/AGit runs whenever `WorkflowSourceCommit` is set, that is when the workflow came from the "trusted base branch". [`services/actions/secret.go` L41-60](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/secret.go#L41-L60) then sends all owner and repo secrets.
> - [`services/actions/context.go` L36-39](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/context.go#L36-L39): `ref`/`sha` are set to the base branch, not the default branch.
>
> **Steps to reproduce (not yet run on a live instance):**
> 1. Repository `owner/repo`, default branch `main`. Add a repo secret `S`.
> 2. On `main`, add `.forgejo/workflows/t.yml` with `on: pull_request_target`, one job `runs-on: <label>`, step `run: echo "${{ secrets.S }}" | sha256sum` (or anything that shows which file ran, e.g. `echo from-main`).
> 3. Create branch `old` from `main`. On `old`, change the step to `echo from-old` (this stands in for an old, vulnerable version of the workflow).
> 4. From another account with no rights on the repo, fork it and open a PR with base `old`.
> 5. **Expected (per docs):** the workflow from `main` runs (`from-main`). **Actual (per code):** the workflow from `old` runs (`from-old`), with secret `S` available and no approval prompt.
>
> **Impact.** A vulnerable `pull_request_target` workflow remains exploitable by any user who can open a PR for as long as any branch contains it, including release branches, which are often long-lived. Fixing it on the default branch is not enough, and the documentation says it is. Mitigations that exist today: delete or fix the workflow on every branch, or validate `ref`/`workflow_ref` claims in OIDC-based deployments.
>
> **Possible fixes** (your call):
> - (a) align with GitHub: always load `pull_request_target` workflows from the default branch;
> - (b) keep the behaviour, but fix `reference.md` and warn explicitly about non-default base branches;
> - (c) make it configurable.
>
> I did not reproduce this on a running instance; the analysis is from the source code at the commits linked above. Please let me know whether you consider this a security issue or whether I should file it publicly.

---

## Report 2: public issue in `forgejo/docs`

**Why public / why docs.** This is a documentation error, not a vulnerability. The docs understate the token's power, so they are less safe than the code, but the actual behaviour is already correctly documented on another page.

The docs repo has no issue template. Free-form issues are accepted there (e.g. [docs#2030](https://codeberg.org/forgejo/docs/issues/2030)). A small human-written PR to `next` would be even better. Use one or the other, not both.

**Dedup:**
- [docs PR #1673](https://codeberg.org/forgejo/docs/pulls/1673) (open) describes token permissions correctly, but only edits `github-actions.md`.
- [#10733](https://codeberg.org/forgejo/forgejo/issues/10733) covers the fork + `pull_request_target` half; a maintainer there called it a "documentation defect and a missing feature".
- No issue found about `security.md`'s `pull_request` sentence.

**Title:** `user/actions/security.md`: says the `pull_request` token is read-only, but same-repository PRs get a write token

**Body:**

> **Page:** https://forgejo.org/docs/v17.0/user/actions/security/#pull-requests (same text on `next`, [`security.md` L32-40](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/security.md#L32-L40)).
>
> The page says: "Workflows triggered by the `pull_request` event are an exception. The token generated for these runs does *not* have write permissions for the repository."
>
> In the code, the token's access depends only on whether the PR comes from a fork or AGit, not on the event:
> - [`models/perm/access/repo_permission.go` L143-165](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/models/perm/access/repo_permission.go#L143-L165): `if task.IsForkPullRequest { AccessModeRead } else { AccessModeWrite }`;
> - AGit PRs count as fork PRs ([`models/issues/pull.go`, `IsForkPullRequest`](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/issues/pull.go#L478-L488)).
>
> So a `pull_request` workflow for a PR from a branch of the same repository gets a token with write access.
>
> Other pages already say this correctly:
> - [`basic-concepts.md` L182](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/basic-concepts.md#L182): "... from a forked repository is an exception";
> - [`reference.md` L167](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/reference.md#L167).
>
> On the same page, [L40](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/security.md#L40) says that for `pull_request_target` "the restrictions on the token are lifted". That is not true for PRs from forks or AGit, where the token is still read-only. This half is tracked in forgejo/forgejo#10733.
>
> **Suggested wording:** "Workflows triggered by `pull_request` or `pull_request_target` for a pull request from a fork (or an AGit pull request) receive a token without write permission. For pull requests from a branch of the same repository, the token has write permission, as for any other event."
>
> Checked against v17.0.0 and `forgejo` 162ee1d3 by reading the source. Corroborated by the report in forgejo/forgejo#10733 (labels can be removed on same-repo PRs). I have not tested it myself on a live instance.

---

## Report 3: public issue in `forgejo/forgejo` ("Step 1: Report a problem or need" template)

**Why public.** The Security Policy lists "Desired security features that are not implemented" as public. The issue is a silent difference with a safety impact; nothing is bypassed inside Forgejo.

**Why forgejo/forgejo.** The pre-execution warning for `permissions` lives in the server ([`services/actions/notifier.go` L832-847](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/notifier.go#L832-L847)). It uses `jobparser.SingleWorkflow.HasPermissions()`, which was added in runner [PR #1534](https://code.forgejo.org/forgejo/runner/pulls/1534). An `environment` warning would need the same two-part change, so mention the runner side in the issue too.

**Dedup:**
- No issue found about the missing warning.
- The feature itself (real environments) is discussed in [forgejo/discussions#440](https://codeberg.org/forgejo/discussions/issues/440), still open. Link it, but keep this issue about the silent ignore.

**Title:** `problem: jobs.<job_id>.environment is silently ignored, so GitHub deployment gates disappear without notice`

**Template fields:**

- *Does your problem still exist on the latest Forgejo version?* "Unknown, I can't try it for some reason (please explain)". Explain that this is from a source review of v17.0.0 and `forgejo` 162ee1d3. Or reproduce on dev.next.forgejo.org first: a job with `environment: production` runs without any warning in the run view.
- *About your usage of Forgejo:* (your own words) evaluating Forgejo Actions as a target for a project template that also runs on GitHub, with preview deployments from PRs.
- *Problem description:*

> On GitHub, `jobs.<job_id>.environment` is commonly used as a security gate. Environment secrets are only released to jobs that reference the environment, and protection rules (required reviewers, allowed branches) must pass before the job starts.
>
> Forgejo accepts the key, because the runner schema has `"environment": "job-environment"` ([`act/schema/workflow_schema.json` L1464](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/schema/workflow_schema.json#L1464)). But `jobparser.Job` has no such field ([`act/jobparser/model.go` L149-169](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/jobparser/model.go#L149-L169)), so the key is dropped. The job runs immediately, with every repository and organisation secret, and nothing in the UI or logs says that the gate does not exist.
>
> For `permissions`, Forgejo shows a pre-execution warning: "… has a `permissions` field, which is not supported in Forgejo and will be ignored" (`actions.workflow.permissions_warning`, [`notifier.go` L832-847](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/notifier.go#L832-L847)). There is no equivalent for `environment`. The "Known list of differences" page ([`github-actions.md` L22-27](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/github-actions.md#L22-L27)) does not mention it either.
>
> Someone migrating a GitHub workflow that relies on `environment: production` + required reviewers gets an ungated deployment without noticing.

- *Potential workarounds:*
  - Review workflows by hand for `environment:`;
  - Gate deployments outside Forgejo (OIDC + an external broker that checks `ref`/`workflow_ref`);
  - Use `workflow_dispatch` by a trusted user.
- *Forgejo Version:* v17.0.0 (source); runner v13.2.0.
- *Other details:* source review only, no live instance.

(Do not propose the solution in the step-1 issue; the template asks to focus on the problem. You may add one line: "A warning similar to the `permissions` one would already have prevented my confusion.")

---

## Report 4: comment on forgejo/forgejo#13759, not a new issue

**Why.** [#13759](https://codeberg.org/forgejo/forgejo/issues/13759) ("Actions OIDC ref_protected claim is always false") is open and already reports exactly this. The maintainers decided **not** to implement the claim. PR [#13829](https://codeberg.org/forgejo/forgejo/pulls/13829) and runner PR [#1664](https://code.forgejo.org/forgejo/runner/pulls/1664) were closed. The thread ended with agreement to deprecate it ("Sure. Warn on access in the runner?", mfenniak, 2026-08-27).

A new issue would be a duplicate. The only new information is that the docs still promise the opposite, so a short comment is enough. Post it only if you have something to add, e.g. that a relying party you design could be misled by the doc.

**Comment (rewrite in your own words):**

> Since the decision here was not to compute `ref_protected`, could the docs say so until the deprecation lands? The OIDC page still lists it as "`true` if branch protections are configured for the ref that triggered the workflow run" ([`security-openid-connect.md` L160](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/security-openid-connect.md#L160), same on v17.0), while v17.0.0 and current `forgejo` still hard-code `false` ([`services/actions/context.go` L106](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/context.go#L106)). Someone writing a trust policy from the docs could rely on it. Something like "always `false` in Forgejo; do not use it in trust policies, validate `ref`/`workflow_ref` instead" would help. I'm happy to open a docs PR if that's welcome.

(If you offer the PR, you must write it yourself, under the AI Agreement.)

---

## Not recommended for reporting

- **(d) `permissions:` ignored.**
  - Documented ([`github-actions.md` L26](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/github-actions.md#L26)), and the server shows a warning.
  - The need is tracked in [#13183](https://codeberg.org/forgejo/forgejo/issues/13183) (open, labelled `forgejo/security`) and [#3571](https://codeberg.org/forgejo/forgejo/issues/3571). There is a WIP PR [#13079](https://codeberg.org/forgejo/forgejo/pulls/13079).
  - That Gitea supports it is a product difference, not a defect.
  - At most, add a 👍 or a use case to #13183.
- **(e) All repo/org secrets sent to the runner for every non-fork job.**
  - The code is as described ([`secret.go` L41-60](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/services/actions/secret.go#L41-L60), [`models/secret/secret.go` L191-215](https://codeberg.org/forgejo/forgejo/src/commit/162ee1d34a10cc5e2b5802c5ff9e832052a511df/models/secret/secret.go#L191-L215)), but the maintainers already know: PR [#10627](https://codeberg.org/forgejo/forgejo/pulls/10627) states it and reduced it for expanded reusable workflows.
  - GitHub's service also sends all secrets and relies on the runner scrubbing unreferenced ones from memory.
  - The runner only exposes secrets through `${{ secrets.* }}`. This is defence in depth, and static "only referenced secrets" is not possible with `toJSON(secrets)` or dynamic indexing.
  - If you want to raise it, a comment on [discussions#440](https://codeberg.org/forgejo/discussions/issues/440) fits better.
- **(f) Protected-file patterns rejecting branch creation.** Inferred only (comparison against the empty tree), never tested, and it may well be intended. Do not report it without a reproduction on dev.next.forgejo.org.
- **`pull_request_target` writes to the cache without isolation.** Same model as GitHub, and documented as a risk in [`reference.md` L182-189](https://codeberg.org/forgejo/docs/src/commit/6bded37e2871e2aca936479111c135b345368d47/docs/user/actions/reference.md#L182-L189).
- **`workflow_dispatch` triggerable with the automatic write token.**
  - Inference only.
  - GitHub explicitly allows `workflow_dispatch` from `GITHUB_TOKEN`.
  - It requires write access, which the token only has on non-fork runs.
- **Same-repo `pull_request_target` against an attacker-created base branch.** A user with write access can already run any workflow (documented: "If Mallory can push directly to the repository, they can run arbitrary workflows"). The relevant case is the fork-contributor one, which Report 1 covers.
- **Existing items you could +1 instead of re-filing:**
  - [#13238](https://codeberg.org/forgejo/forgejo/issues/13238): no approval for `pull_request_target`;
  - [#7722](https://codeberg.org/forgejo/forgejo/issues/7722): `workflow_run`;
  - [#8004](https://codeberg.org/forgejo/forgejo/issues/8004): artifacts v4 by run id.
