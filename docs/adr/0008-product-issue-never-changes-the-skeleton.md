# A Product issue never changes the Skeleton: revert, then "The Skeleton must grow"

Status: superseded by ADR-0017

When the Factory builds an issue for one Product (label `product:<id>`, or `apps/<id>` or `Product: <id>` in its text; an issue that names `packages/skeleton` without the label is a Skeleton issue), it may not change `packages/skeleton/**`, the template included. Seen in the first real demonstration, the agent solved a Product footer by editing the Skeleton's root layout and shared test helpers in the same commit, which would have changed every Product.

After the Review, a deterministic detector (`src/scope.ts`) reverts those paths with a new `revert:` commit (never a history rewrite) and the Factory opens a follow-up issue titled "The Skeleton must grow: ..." (label `needs-triage`, linked to the original), built from the reverted files and the agent's `<skeleton-gap>` tags. The original issue is judged on what is left: the run is `ready` only if the final Review says `criteriaMetWithoutSkeleton: true`, otherwise it escalates with `needs-human`.

A test that is skipped or focused never counts as proof. After Development, a line added to a test file with `test.fixme|skip|only`, `it|describe.skip|only`, `xit(` or `xdescribe(` fails the attempt.

## Considered Options

- **Only warn in the Review**: the Review did warn and the change shipped in the same commit.
- **Let a Product issue grow the Skeleton**: one Product's issue changes every Product with a review sized for one.

## Consequences

- To extend the Skeleton you open or take the follow-up issue: the Skeleton interface grows in a separate change.
- The skipped-test check is a line scanner with accepted false positives (see `docs/known-risks.md`).
- Observed cost: a first run that could not be done without the Skeleton ended as an Escalation, which is the intended outcome.
