---
name: skeleton-add-feature
description: Add a feature (screens, API, tables, texts) to a Product built on the Skeleton. Use when building new product behaviour in apps/<id>/.
---

# Add a feature

A feature is the only way to add behaviour without touching the Skeleton's core. Read `apps/<id>/AGENTS.md` and `packages/skeleton/AGENTS.md` first.

## Layout

```
apps/<id>/src/features/<feature>/
  index.ts          export const <feature> = defineFeature({ id: "<feature>", api(app) {...} })
  api.ts            routes (skill skeleton-add-endpoint)
  schema.ts         tables (skill skeleton-add-migration)
  routes/           signed-in screens, mounted at /<feature>
  public/           visitor screens, mounted at /<feature>
  messages.ts       texts per locale (en and pt-BR)
```

## Steps

1. Create the folder. `id` is unique in the Product and is also the folder name and the UI route prefix.
2. List the feature in `apps/<id>/src/features/index.ts` (mount order).
3. Add the API (`skeleton-add-endpoint`) and the tables (`skeleton-add-migration`). `seed(db)` inserts demo data for previews and E2E and must be safe to run twice.
4. Screens are TanStack Router files: `routes/index.tsx` is `/<feature>`. Use the generated Kubb hooks for data and `#ui/*` shadcn components. Import the Skeleton only through its package exports.
5. Texts: add `messages.ts` with `en` and `pt-BR` and spread it into `messages` in `product.config.ts`. Components read texts through the messages hook; no literal UI text.
6. Run `pnpm generate` (route tree, client, MSW handlers, tool snapshot) and commit the generated files that are tracked.
7. Tests, test-first with `tdd`: the Worker over HTTP, the screens in the browser with the generated handlers, and a Playwright E2E for the main flow (`skeleton-evidence-test`).
8. `pnpm factory:verify`.

## Do not

- Edit `packages/skeleton/`. If the interface is missing something, stop and say so (`needs-human`) or change it in a separate change.
- Read the user from anywhere but `c.var.identity`.
