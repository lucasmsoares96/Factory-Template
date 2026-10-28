# Coding Standards

<!-- Read by the Review stage (the Standards axis of the `code-review` skill), not by Development,
     so these standards are enforced during review without costing tokens during implementation.
     Do not point to this file from AGENTS.md. Rules come from `/retro` on real findings:
     mechanical violations belong in a deterministic check, only judgement belongs here. -->

## Style

## Testing

## Architecture

- When harness code checks text supplied by an agent (symbols, paths, labels), it matches the whole token, never a raw
  substring, and rejects blank input. An automated test covers a near-miss:
  `line` vs `line7`, `/api/note` vs `/api/notes`. `holdsName` in `.factory/src/triage-output.ts` does this.
