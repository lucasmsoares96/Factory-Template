# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Factory labels

The Factory adds these to the five above. Their names live in `.factory/src/config.ts` (`labels`); a test keeps this table equal to it, so change both together.

| Label | Set by | Meaning |
| --- | --- | --- |
| `in-progress` | the Factory (`claim`) | The Factory holds the lock on this issue. Replaced by `ready-for-human` on an Escalation, by `ready-for-agent` when a Product issue waits on its Skeleton issue (blocked by it), or by `ready-for-agent` with `factory:session-limit` when the run stopped at the agent's usage limit. |
| `factory:working` | the Factory (each run, with the job token) | A Factory run is working on this issue or pull request right now: the issue flow, a feedback round, a branch update, the Triage or the Retro. It comes off at the end of every run, whatever the outcome; a run that was cancelled leaves it behind until the next push to the base branch, whose `update-branch --scan` removes it from everything with no Factory run queued or going. Unlike `in-progress`, which is the lock and stays until the merge, it says nothing about who holds the issue. |
| `factory:session-limit` | the Factory (`publish`, `apply`, `retro-publish`; `resume` removes it) | A run on this issue or pull request stopped at the agent's usage limit (Claude Code's "You've hit your session limit · resets ..."). It is paused, not escalated: its marked comment says the reset time, and `pnpm factory resume` (`factory-resume.yml`, every 30 minutes) takes the label off and starts the same work again once the reset has passed (an hour after the limit when the reset time cannot be read). While it is on, the guard does not start the issue; remove it to cancel the wait. |
| `agent:explore` | a human | Ask the Factory to triage this issue: it explores and comments, and changes no code. |
| `harness-change` | the Factory (`publish`) | The pull request touches `AGENTS.md`, `docs/agents/`, `GLOSSARY.md`, `CODING_STANDARDS.md`, `docs/adr/` or `.factory/`. Review it with care. |
| `preview` | a human with `write`+ access (CI removes it on each push) | Asks CI to deploy a preview of a pull request whose author has no `write` access. It must be re-applied after each push. |
| `retro` | the Factory (`retro-publish`) | The issue holds the candidates of an automatic Retro (with `needs-triage`). A human picks what becomes work and closes the rest. |
| `auto-merged` | the Factory (`merge`) | The Factory merged this pull request on its own, as the Merge Mode allowed (`FACTORY_MERGE_MODE`). Its comment names the mode and the conditions that held. Look here first for what to revert, and for the Retro. |
| `product:<id>` | a human or the Factory | The issue or pull request concerns the Product `<id>`. One label per Product (for example `product:example`). |
