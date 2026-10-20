# Skeleton

The shared package every Product builds on: a Hono + OpenAPI Worker, Better Auth on Postgres, an MCP server generated from the OpenAPI document, and the base React SPA. Products pin it through `workspace:*`, so a change here reaches all of them. Rules of the repo are in the root `AGENTS.md`.

## Layout

- `src/platform/`: Worker side (`app.ts` `createApp`, `feature.ts` the `Feature` interface, auth, db, email, rate limit, `mcp/`).
- `src/features/`: Skeleton features (`auth`, `home`, `me`), written like a Product's.
- `src/client/`: SPA shell and shadcn components. `src/i18n/`: messages per locale.
- `src/db/schema.ts` and `drizzle/`: Skeleton tables and their migrations (a Product's migrations come after these).
- `src/node/`: Node-only tooling (`skeleton generate`, `db`, `migrations`, Postgres helper, test helpers).
- `src/vite/`: the Vite plugin and route generation. `template/`: what `new-product` copies.
- `test/`: Vitest. `test/browser/`: Browser Mode screens. `e2e/`: Playwright specs that every Product runs.

## Rules

- The Skeleton core does not know any Product. Product behaviour goes through `Feature`, never through an `if` on a product id.
- Every API route has an `operationId`, a `summary`, a `description`, every response it can return, and stable error codes. `limit` defaults to 50 with a cursor. `x-mcp: false` keeps a route out of MCP. Better Auth routes are not exposed as tools.
- The database only grows. A published migration is never edited, renamed or deleted (`skeleton migrations check-published` enforces it). `drizzle-kit check` must pass.
- Generated files: the Kubb client, `openapi.json` and `worker-configuration.d.ts` are not committed; `routeTree.gen.ts` and `src/mcp-tools.gen.json` are. Changing a tool changes the snapshot in the same commit.
- UI strings live in `src/i18n/en.ts` and `pt-BR.ts` (typed objects, so `tsc` flags a missing key). The locale is the `LOCALE` build variable. The API returns a stable error code plus an English message; the SPA translates by code.
- Library versions are pinned exactly in the `pnpm-workspace.yaml` catalog. Check the official docs before bumping one.

## Tests

- `test/*.test.ts` drive the Worker over HTTP against Postgres with the outbound `fetch` mocked. Do not mock the database.
- `test/browser/` renders screens with the generated MSW handlers.
- `e2e/specs/` use Playwright; mark screenshots with `@evidence`. Locate elements by role plus the i18n key.
- Run `pnpm --filter @workspace/skeleton test` or the root `pnpm factory:verify`.

## Skills

`skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-add-feature`, `skeleton-evidence-test` in `.agents/skills/`.
