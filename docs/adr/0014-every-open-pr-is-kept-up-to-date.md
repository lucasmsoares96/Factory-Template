# Every open pull request is kept up to date with `main`

The `main` ruleset requires a branch to be up to date before merging (`strict_required_status_checks_policy: true`, set by `pnpm bootstrap product` and checked by `doctor`), so nothing merges with a `verify` that ran against an older `main`. To keep that from stalling work, `factory-update-branches.yml` runs on every push to `main` and updates every open pull request into `main` that is behind, the Factory's and a person's alike:

- it merges `main` into the branch in its own checkout: no agent when the merge is clean, the agent when there is a conflict ("preserve both intents, do not invent new behaviour"); then `verify`, and the normal loop when it fails;
- it pushes with `FACTORY_TOKEN` and a lease, so the pull request's CI runs again; a branch that moved during the run is discarded;
- a Factory pull request runs as its issue's flow; any other runs keyed by the pull request (`PR #N update branch`), touches no label and only comments on the pull request; after five failed attempts on a person's pull request it comments and stops;
- a pull request from a fork is never pushed to: it gets one comment asking its author to update the branch.

`skeleton migrations check-chain` in `lint` fails when two migrations of a package share a parent, which no text conflict shows (#60 and #61 each added a Skeleton migration on the same parent; `drizzle-kit check` saw nothing). The update-branch prompt regenerates the branch's unpublished migration on top of `main`'s newest one.

## Considered Options

- **Update only the pull requests that conflict** (the earlier scan): a pull request without a text conflict kept an old green `verify`, so the forked migration chain of #60 could have merged.
- **Update only pull requests that add a migration, without `strict`**: covers one kind of incompatibility, and only for Factory pull requests; nothing stops a person's stale pull request.
- **`strict` with a person clicking "Update branch"**: every merge leaves every other pull request blocked until someone clicks.
- **The forge's update-branch API**: it pushes the merge without running `verify` first, and it differs between GitHub and Forgejo; the Factory's own merge and push is the same on both.

## Consequences

- The Factory pushes commits onto a person's branch. A local `git push` with unpulled commits is refused, not overwritten: pull first.
- Every merge to `main` runs CI again on every open pull request, which costs Actions minutes, and pull requests merge one at a time, each after its CI. GitHub's merge queue would batch them but exists only for organizations.
- On Forgejo the same rule is `block_on_outdated_branch` on the branch protection of `main` (`docs/forgejo.md`).
