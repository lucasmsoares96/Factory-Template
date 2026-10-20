---
name: skeleton-add-migration
description: Add or change database tables with a Drizzle migration in a Product or in the Skeleton. Use when a feature needs a new table, column or index.
---

# Add a migration

The database only grows. A migration that reached the base branch is published: it may already run in production, so never edit, rename or delete one.

## Steps

1. Edit or add `schema.ts` in the feature (`apps/<id>/src/features/<feature>/schema.ts`). The Product's drizzle config picks every feature schema by glob. Skeleton tables live in `packages/skeleton/src/db/schema.ts`.
2. Make the change additive when data exists: a new nullable column or one with a default, a new table, a new index. To rename or drop, add the new shape, copy, and drop in a later migration.
3. Generate: `pnpm --filter <id> run db:generate` (Skeleton: `pnpm --filter @workspace/skeleton run db:generate`). It writes `drizzle/<timestamp>_<name>/migration.sql` and `snapshot.json`. Read the SQL.
4. Commit the whole migration folder with the schema change.
5. Check: `pnpm --filter <id> run test` runs `drizzle-kit check` and migrates an empty database, expecting no further changes. `pnpm --filter <id> run lint` runs `skeleton migrations check-published`, which fails if a published migration changed.
6. If you edited a published migration by mistake, put its content back exactly as it is on the base branch (`git show <base>:<path>`), then add a new migration.
7. Tests that need rows insert them through the feature's API or its `seed`. `pnpm factory:verify`.

## Do not

- Edit `snapshot.json` by hand.
- Change a migration after it merged to the base branch.
