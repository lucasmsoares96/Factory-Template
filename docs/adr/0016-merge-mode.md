# The Merge Mode decides which Factory pull requests merge without a person

Every Factory pull request waited for a person at the Merge Gate, the low-risk ones too, and a merge into `main` deploys to production. How much of that to hand over is now the owner's explicit choice, the Merge Mode, kept in the `FACTORY_MERGE_MODE` variable:

- `human` (the default): the Factory merges nothing. A person merges at the Merge Gate, as before.
- `safe`: the Factory merges a ready pull request of a `factory/issue-N` branch only when every condition holds: no file of its diff is in the protected list, `verify` passed, no preview job failed (a pull request without a preview has nothing to smoke), every acceptance criterion has a met verdict in the body, and the last deploy of `main` did not fail.

How it is built:

- The protected list is `PROTECTED_PATHS` in `.factory/src/config.ts`, not a setting: no variable overrides it. It holds what steers the Factory (the sensitive and harness paths of ADR 0012, `config.ts` itself among them, so the Factory cannot widen what it may merge), the scripts and Turbo config behind `verify`, migrations, dependency manifests, the lockfile and the toolchain pins, and the Skeleton.
- `pnpm bootstrap factory` asks the mode once (step `merge-mode`, `human` first and without a terminal), `--redo merge-mode` changes it, and the doctor shows it. The `FACTORY_TOKEN` cannot write variables, so only the owner changes the mode.
- `factory-merge.yml` runs on `workflow_run` of the PR workflow, so GitHub runs the file and the checkout of `main`, never the pull request's: a pull request cannot change the rule that decides its own merge. The decision is `pnpm factory merge --branch <b>`, a deterministic command over the CodeHost seam, tested with the fake adapters. It reads with the read-only job token and merges, pinned to the head it checked, with `FACTORY_TOKEN`, so the merge starts the deploy of `main` as the owner's merge would (a merge with the job token starts no workflow).
- A failed deploy of `main` stops every merge without a person until a deploy passes: the line stops without anyone switching anything off.
- A pull request the Factory merged gets the `auto-merged` label and a comment, in `FACTORY_LANGUAGE`, naming the mode and the conditions that held, so what to revert and what to feed the Retro is easy to find.
- The skills update (ADR 0013) is unchanged: GitHub's auto-merge, the `auto-merge` step, whatever the mode.

## Considered Options

- **GitHub's native auto-merge on Factory pull requests**: it knows only the checks the ruleset requires, not the protected list, the verdicts or the deploy of `main`.
- **Merging from `publish`**: the checks have not run yet when it ends, and it would run with the harness of the run instead of the one on `main` when the checks end.
- **The protected list as a repo variable**: anything that can set a variable could widen the list; in `config.ts` it changes only through a reviewed, protected pull request.

## Consequences

- In `safe`, a pull request that touches only Product code reaches production with no person looking. The Review, `verify`, the preview smoke and the verdicts are the brakes; a person still reviews everything protected, which covers the one-way doors (migrations, dependencies, the Skeleton) and the Factory's own rules.
- The verdicts are read from the pull request body: a person who edits them there decides for the Factory.
- A branch behind `main` is refused by the strict ruleset; the update-branch scan brings it up to date, its checks run again, and the decision is made again on the new head.
