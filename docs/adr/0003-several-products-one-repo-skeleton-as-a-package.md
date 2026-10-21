# Several Products in one repository, the Skeleton as a shared package

The repository holds N Products. The Skeleton is the workspace package `packages/skeleton/`, and each Product is a thin composition root in `apps/<id>/` that only extends it: configuration (`product.config.ts`), theme tokens, i18n texts, its own features (`src/features/`) and extra roles. The template ships with one Product, `apps/example/`, and `pnpm new-product <id>` copies `packages/skeleton/template/` into a new one.

Each Product has its own Worker (SPA in Static Assets, Hono on `/api/*` and `/mcp`), its own Neon database, its own Durable Objects and `OAUTH_KV`, and its own secrets (prefix `<ID>_`). Migrations live in the package that owns them: the Skeleton's use their own Postgres schema and `migrationsTable` and run before the Product's. The Skeleton never imports from `apps/`; a lint rule (`no-restricted-imports`) makes a Product import it only through its package exports. CI builds a matrix of the affected Products for `verify`, preview, smoke and deploy; the Skeleton's E2E specs run inside every Product.

## Considered Options

- **One Product per repository, the Skeleton copied in**: each copy drifts, and a Skeleton fix would have to be ported by hand. A private `upstream` merge was designed and dropped: a rename or drop in the Skeleton of a table a Product uses escapes `drizzle-kit check`.
- **One Skeleton app with Products as feature flags**: one Worker and one database for unrelated products, no isolation of users, data or secrets.

## Consequences

- A Skeleton change reaches every Product, so `turbo run --affected` selects all of them when the Skeleton changes.
- Product code never edits `packages/skeleton/`; see ADR 0008.
- A published migration (one that reached the base branch) is immutable: no squash, no regenerate, no rename. Add a new one. CI checks it.
- Free-plan ceilings are per account, not per Product: Resend Free allows 3 domains (so 3 Products with real email), 100 emails a day in total; Workers allows 100k requests a day; a private repository has 2,000 Actions minutes a month shared by every Product's CI and Factory; Neon Free limits storage across projects. See `docs/measured-facts.md`.
