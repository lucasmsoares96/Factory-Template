# TypeScript 7 with oxlint, `.ts` run by Node's type stripping

The workspace uses TypeScript 7 (`tsc --noEmit` only) and oxlint. There is no ESLint: `typescript-eslint` does not support TypeScript 7. Node 24 LTS (pinned in `.node-version` and `.prototools`) runs `.ts` scripts and the harness directly by type stripping, so no build step exists for `.factory/` or `scripts/`. pnpm 12 and Turborepo run the tasks (`generate`, `typecheck`, `lint`, `test`, `e2e`, `build`).

## Considered Options

- **Keep ESLint**: `typescript-eslint` does not accept TypeScript 7, so it would force the compiler back.

## Consequences

- Code that Node runs directly must use only erasable TypeScript syntax.
- Lint rules are oxlint's; `no-restricted-imports` enforces the Product/Skeleton boundary.
- Library versions are pinned in the pnpm catalog and checked against the official docs on the day they are added.
