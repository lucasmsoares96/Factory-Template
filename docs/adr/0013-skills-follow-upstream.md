# The locked skills follow their upstream on their own

`skills experimental_install` restores the latest version of each skill in `skills-lock.json`, not a pinned one. When a skill changed upstream, `skills-check` (`git diff --exit-code` after the restore) failed on every open pull request until someone updated the lock by hand, as on 2026-10-27 when `mattpocock/skills` changed `setup-matt-pocock-skills`.

Now an upstream change is taken with no one looking:

- `skills-check` fails only when the pull request itself changed `.agents/skills/` or `skills-lock.json` and the restore does not reproduce it. An upstream change the pull request did not make is a notice.
- `factory-skills-update.yml` runs on every push to the default branch, daily and by hand. Its `fetch` job (no secret) restores the skills and, when they changed, uploads a patch limited to `.agents/skills/` and the lock. Its `publish` job (`FACTORY_TOKEN`) refuses any other path, pushes the patch to `skills/update`, opens or reuses that pull request and turns on auto-merge. GitHub merges it once `verify` is green, and the update-branch scan keeps it up to date with `main`.
- `pnpm bootstrap factory` turns on the repo's `allow_auto_merge` (step `auto-merge`).

## Considered Options

- **Pin each skill to a commit**: the CLI has no documented way to restore a pinned ref, and the owner wants new versions anyway.
- **Only warn and let a person update the lock**: the owner does not want to spend attention on it.

## Consequences

- Text written by third parties (`mattpocock/skills`, the vendor skills) reaches every agent's instructions without a human review. Whoever controls those repositories steers the Factory. See `docs/known-risks.md`.
- This is the only pull request that merges without a person at the Merge Gate. The Factory's own pull requests never turn auto-merge on.
- Between an upstream change and the merge of `skills/update`, the committed skills are one version behind; nothing fails meanwhile.
