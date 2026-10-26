# Sensitive paths are flagged on the pull request, not refused

The Factory and local agents may change `.github/workflows/`, `.agents/skills/`, `.claude/`, `skills-lock.json` and `.mcp.json`. A Factory pull request that touches them is no longer an Escalation without a pull request: `publish` opens it as usual, labels it `harness-change` and puts a warning on top that names those files. `.claude/settings.json` keeps only the `deny` on `pnpm bootstrap destroy`; the `Edit` denies on these paths and the git-guardrails hook (which blocked `git push`, `git reset --hard` and the like) are gone. `FACTORY_TOKEN` now needs the Workflows permission, since GitHub refuses a push that changes a workflow file without it.

This supersedes the protected-paths rule of ADR 0002 and ADR 0005.

## Considered Options

- **Keep refusing**: it stopped the Factory from building a Factory issue that needs a workflow (the automatic Retro, #62, had to be written by hand), and it blocked a person's own local work, down to pushing a branch.
- **Refuse only workflows**: the same friction for the most common case.

## Consequences

- A person reviews every `harness-change` pull request, and a sensitive-file warning line by line, before the Merge Gate. Nothing else checks those files.
- A workflow file pushed to a Factory branch can run with the repository's secrets before anyone reviews it (an `on: push` workflow runs on the branch's push). The `work` job still never holds `FACTORY_TOKEN`, but an issue or comment that steers the agent into writing such a workflow is no longer stopped by the harness. See `docs/known-risks.md`.
- An existing `FACTORY_TOKEN` without the Workflows permission still works for every other pull request; one that changes a workflow fails to push until the token is recreated with it.
