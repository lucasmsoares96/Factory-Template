# The Factory writes with the owner's fine-grained token and marks its own texts

The Factory module no longer needs a second GitHub account. `FACTORY_TOKEN` is a fine-grained personal access token of the repository owner, limited to this repository (`contents`, `pull_requests` and `issues` as write, never `workflows`), pasted once into `pnpm bootstrap factory`. The wizard prints one pre-filled link (GitHub's URL parameters cannot pick repositories, so choosing "Only select repositories" is the only manual step) and checks the token before storing it: the `github_pat_` prefix, and `permissions.push` on `GET /repos/{o}/{r}` made with the token. GitHub has no way to read the permissions of a fine-grained token, so a stray `workflows` permission cannot be detected; the wizard only warns (checked 2026-10-21).

Since the Factory now writes as the owner, the author no longer tells the Factory's words from a person's. Every text it writes carries the hidden marker `<!-- factory -->`, put in one place, the write adapters (`src/marker.ts`). Readers filter by marker: a comment with it never starts a PR-feedback round, and a thread is the Factory's turn when its last comment is marked. A Factory text is trusted only when its author also has `write`+, so a stranger's forged marker gets no power (a writer could apply the labels by hand anyway).

The "PR is ready" notice comes from the job's own `GITHUB_TOKEN` (`github-actions[bot]`), because GitHub notifies nobody of what the owner's token writes, and a comment made with `GITHUB_TOKEN` fires no workflow.

## Considered Options

- **A machine user (a second account)**: creating another account by hand is a bad flow, and the invitation, acceptance and classic-PAT scope checks all existed only to support it. Rejected by the user on 2026-10-21.
- **A GitHub App**: Forgejo has no equivalent, and the Factory must port to it.
- **`GITHUB_TOKEN` plus the "Create pull request" button (as `claude-code-action` does)**: commits pushed with `GITHUB_TOKEN` to an open PR would not trigger CI.

## Consequences

- The history of the repository does not separate the Factory from its owner, and the PR belongs to the owner, who cannot approve it. The main ruleset asks for 0 approvals, so nothing blocks.
- The token has no expiry (`expires_in=none`).
- A human comment that contains `<!-- factory -->` is ignored by the PR-feedback flow. Accepted.
- On Forgejo there is no `workflow` scope: a token with `write:repository` can change `.forgejo/workflows/`. The only defence there is the `protected-paths` Escalation before `publish`, and the token never reaches the `work` job (ticket 22).
