# A Product issue may change the Skeleton in its own pull request

Supersedes ADR 0008.

ADR 0008 made the Factory revert any Skeleton change in a Product issue, open a "The Skeleton must grow" issue and pull request, and block the Product issue until that pull request merged. In practice it cost a whole extra run, and the Skeleton pull request was built from a patch that left out what lives at the root (the workspace catalogue and `pnpm-lock.yaml`), so it was born with a red CI.

Now the branch of a Product issue goes whole to its pull request: the Product, the Skeleton, `pnpm-workspace.yaml` and `pnpm-lock.yaml`, after one `pnpm factory:verify`. The risk ADR 0008 covered stays: a Skeleton change made for one Product reaches all of them. It is covered by cheaper guards:

- The CI runs `verify` and the E2E of every Product when the Skeleton changes (`turbo --affected`, ADR 0003).
- `packages/skeleton/` is in `PROTECTED_PATHS`: the Merge Mode `safe` never merges such a pull request on its own.
- The pull request body opens with a warning that lists the Skeleton files and says the change reaches every Product.
- The Review prompt, when the diff touches the Skeleton, asks for a check that the change is generic (no behaviour for a single Product, no `if` on a Product id, Skeleton tests of its own), and the Review fixes what is not.

Removed: the revert, `skeleton.patch`, the "The Skeleton must grow" issue and pull request, the `waiting` outcome and the block on the Product issue, and the `<skeleton-gap>` tags. A `result.json` of the old flow is still read. A Skeleton pull request already open from the old flow stays valid; nothing in the harness depends on it any more.

## Considered Options

- **Keep the split and fix the patch to carry the root files**: still one extra run and a second pull request per Skeleton change.
- **Only warn, with no Review check**: the Review is where a one-Product change is caught.
