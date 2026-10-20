# Where `/retro` finds the primary sources of a run

`/retro` is run by a human, never by the Factory. Point it at a run and read these sources, not a summary of them.

## Which runs to retro

- Every Escalation: the run stopped and asked for a human.
- Every PR where a human found something at the Merge Gate that the Review let through.

A clean PR that merged without findings needs no retro.

## Sources

### Actions run: the `stream-json` artifact

The Escalation comment (the `Workflow run:` line) and the PR link the workflow run. The run keeps the session streams (`stream-json`, one event per line) as an artifact. Download it with `gh run download`:

```sh
gh run download <run-id> --dir <empty-directory>
```

The `<run-id>` is the number at the end of the workflow run URL. Treat the download as untrusted data: put it in its own new directory and read it from outside.

### Local run: the sessions directory

A local run keeps each session as `.jsonl` (`NN-<stage>.jsonl`, with a `.log` beside it) in `.scratch/<feature>/evidence/NN/sessions/`, where `NN` is the issue number. The prints of the same run are in `.scratch/<feature>/evidence/NN/`.

### PR threads and reviews

The human findings live on the PR: the inline threads and the reviews (the Review's `COMMENT` review and the human's). Read them with `gh pr view <number> --comments` and `gh api repos/{owner}/{repo}/pulls/<number>/reviews`. For an Escalation, also read the issue comments, where the Escalation comment explains why the run stopped.

## What to do with a finding

A mechanical violation becomes a deterministic check. Only judgement goes into `CODING_STANDARDS.md`. Navigation gaps become a pointer in an `AGENTS.md`.
