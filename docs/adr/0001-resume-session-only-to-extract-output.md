# The Agent seam resumes a session only to extract its output

The `Agent` seam runs one fresh session per call and never resumes one to continue the work. The single exception: when the caller passes the expected output block (the Review's `<review>`) and the final message has no valid one, the adapter resumes the same session and asks for the block again, up to 2 times (Sandcastle's `runWithExtraction` default, `maxRetries: 2`), inside the Stage timeout, adding the tokens of every resume to the Stage's usage. After the 2 resumes the caller keeps its own fallback (the raw message becomes the Review summary).

The Sandcastle adapter does this through `run({ resumeSession })` (Claude Code `--resume <session-id>`, the id read from the `stream-json` init event), not through `Output.object({ maxRetries })`, so the raw `stream-json` of every resume is still kept per session and the validator stays the harness's own.

## Considered Options

- **A new session per retry**: the new session has none of the context that made the review, so it would redo the review to produce the block; costly, and it can give a different verdict.
- **No retry**: a missing or malformed block silently turns the whole review message into the summary and drops the inline comments.

## Consequences

- Resuming restores the session's context, so the rule "never resumed to continue the work" is now enforced by what the resume asks for (only the block), not by the seam being unable to resume. Do not use `extract` to keep a Stage working.
- Sandcastle checks that the session file exists on the host: with `noSandbox()` it is under the agent's `HOME` (`~/.claude/projects`), which the job's env allowlist keeps.
