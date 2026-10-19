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
| `in-progress` | the Factory (`claim`) | The Factory holds the lock on this issue. Replaced by `ready-for-human` on an Escalation. |
| `agent:explore` | a human | Ask the Factory to triage this issue: it explores and comments, and changes no code. |
| `harness-change` | the Factory (`publish`) | The pull request touches `AGENTS.md`, `docs/agents/`, `GLOSSARY.md`, `docs/adr/` or `.factory/`. Review it with care. |
| `preview` | a human with `write`+ access (CI removes it on each push) | Asks CI to deploy a preview of a pull request whose author has no `write` access. It must be re-applied after each push. |
| `product:<id>` | a human or the Factory | The issue or pull request concerns the Product `<id>`. One label per Product (for example `product:example`). |
