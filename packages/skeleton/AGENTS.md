# Skeleton

The shared package every Product builds on: a Hono + OpenAPI Worker, Better Auth on Postgres, an MCP server generated from the OpenAPI document, and the base React SPA. Products pin it through `workspace:*`, so a change here reaches all of them. Rules of the repo are in the root `AGENTS.md`.

## Layout

- `src/platform/`: Worker side (`app.ts` `createApp`, `feature.ts` the `Feature` interface, auth, db, email, rate limit, `mcp/`). `identity.ts` resolves who calls (`requireIdentity`), `member.ts` who they are in the Company of the path (`requireMember`: the only permission check of `/api/companies/{companyId}/...`, exported for the Products' routes; a non-Member gets 404; `requireOwner` after it answers 403 `FORBIDDEN` to any role but Owner), `pagination.ts` the `limit` + cursor of every list.
- `src/features/`: Skeleton features (`auth`, `home`, `me`, `account`, `companies`, `invitations`, `billing`), written like a Product's. `account`, `companies` and `invitations` are `Feature`s that `createApp()` mounts in every Product before the Product's own; the signed-in shell (`src/client/signed-in.tsx`) renders every feature's `nav` from `GET /api/nav` (`src/platform/nav.ts`) and the Company switcher. `companies` serves the Company page at `/c/<companyId>` (the active Company comes from the URL), with the features' `companyPage` sections and the Members: the Owner changes a role or removes a Member, anyone but the Owner leaves, and a Member gone that way gets 404 from `requireMember` on the next call, agents included (no Connection is revoked); the signed-in root (`home`) goes to the Company used last. `invitations` adds the Owner's Invitations section to that page, the Invitation email, and its link's public page (`public/$token.tsx`, `/invitations/<token>`), where the invited address accepts (sign-up, verification and sign-in carry `redirect` back to it) and every feature's `memberJoined` runs; `createInvitation` (its service, exported) lets a Product's route build Invitations with rules of its own.
- `src/features/billing/`: `billing({ entitlements })`, a feature a Product lists in its `features` (ADR 0015). It runs `@better-auth/stripe` in user mode: `GET /api/billing/plan` (an MCP tool), `POST /api/billing/subscribe` (`x-mcp: false`), Account › Plan at `/account/plan` (linked from the account page through `accountPage` in `GET /api/nav`), and a Plan is a Stripe product tagged with the Product's id. Seats: `src/platform/seats.ts` counts them (one per distinct address across the Companies a person owns: Owner, Members, pending Invitations); a feature limits them through `Feature.seatLimit` (billing answers the Plan's number, 1 on the free Plan), and `createInvitation` / `acceptInvitation` refuse with 409 `NO_FREE_SEAT` under an advisory lock, so a Product's invite route handles that code too. `GET /api/billing/seats` (an MCP tool) feeds the Company page's "N of M" (Owner only) and Account › Plan's people list. Without billing nothing is limited. It is on only with `STRIPE_SECRET_KEY` (or `STRIPE_FAKE=true`): otherwise no billing route answers. `fake-stripe/` is a Stripe that lives in the Worker (state in `skeleton.fake_stripe`, a Checkout page and controls under `/api/fake-stripe`), used by `pnpm dev` and the tests; `test/billing.test.ts` drives it over HTTP.
- `src/client/`: SPA shell and shadcn components. `src/i18n/`: messages per locale.
- `src/db/schema.ts` and `drizzle/`: Skeleton tables and their migrations (a Product's migrations come after these).
- `src/node/`: Node-only tooling (`skeleton generate`, `db`, `migrations`, Postgres helper, test helpers).
- `src/vite/`: the Vite plugin and route generation. `template/`: what `new-product` copies.
- `test/`: Vitest. `test/browser/`: Browser Mode screens. `e2e/`: Playwright specs that every Product runs (a Product adds its own in `apps/<id>/e2e/`, run after these).

## Rules

- The Skeleton core does not know any Product. Product behaviour goes through `Feature`, never through an `if` on a product id.
- Every API route has an `operationId`, a `summary`, a `description`, every response it can return, and stable error codes. `limit` defaults to 50 with a cursor. `x-mcp: false` keeps a route out of MCP. Better Auth routes are not exposed as tools.
- The database only grows. A published migration is never edited, renamed or deleted (`skeleton migrations check-published` enforces it). `drizzle-kit check` must pass. The chain stays linear: two snapshots with the same parent, or a missing parent, fail `skeleton migrations check-chain` (in `lint`); delete the folder it names and generate the migration again on top of the newest one.
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
