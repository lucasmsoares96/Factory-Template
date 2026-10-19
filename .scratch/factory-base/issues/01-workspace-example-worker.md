# 01: Workspace e Worker do `example` de pé

Spec: [../spec.md](../spec.md)

**What to build:** um dev clona o repo, roda `pnpm install` e `pnpm dev` e vê o Worker do Product `example` servir a SPA e responder no `/api/*`. Já existe o workspace com vários Products: `packages/skeleton/` (o Skeleton) e `apps/example/` (raiz de composição fina), com o Postgres local e as migrations do Skeleton separadas das do Product. `pnpm factory:verify` roda verde do zero.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workspace pnpm + Turborepo com catalog de versões fixadas, conferidas na documentação oficial atual e registradas com data neste ticket.
- [x] Um Worker por Product: SPA em Static Assets + Hono em `/api/*` (`run_worker_first`), com uma rota de saúde.
- [x] Postgres de teste por `docker compose`. `pg` + Drizzle `1.0.0-rc.4`, com schema Postgres e `migrationsTable` do Skeleton separados dos do Product; as do Skeleton rodam antes.
- [x] `member_roles` com as linhas `owner` e `employee` numa migration do Skeleton.
- [x] Tasks do Turborepo (`generate`, `typecheck`, `lint`, `test`, `e2e`, `build`) e `pnpm factory:verify`, que usa o `DATABASE_URL` se existir ou sobe o `docker compose`.
- [x] Lint de imports: o Product só importa exports públicos do Skeleton, e o Skeleton nunca importa de `apps/`.
- [x] `drizzle-kit check` + migrate num banco vazio com `no_changes` no `verify`, e uma checagem que falha se uma migration publicada mudar (seam 6).
- [x] Teste de integração da rota de saúde com `createTestHarness()` contra o Postgres do container (seam 3).

## Comments

Implementado em 2026-10-19. Versões conferidas no npm registry (`npm view <pkg> version time`) e nas docs oficiais nessa data, fixadas no `catalog` do `pnpm-workspace.yaml` (`catalogMode: strict`):

| Pacote | Versão | Publicado |
|---|---|---|
| Node (`.node-version`) | 24.22.0 (LTS "Krypton") | 2026-10-14 |
| pnpm (`packageManager`) | 12.14.0 | 2026-10-15 |
| turbo | 2.11.9 | 2026-10-16 |
| typescript | 7.0.2 | 2026-07-08 |
| oxlint | 1.88.0 | 2026-10-13 |
| wrangler | 4.151.2 | 2026-10-19 |
| @cloudflare/vite-plugin | 1.64.0 (peer `wrangler ^4.151.0`) | 2026-10-14 |
| vite / @vitejs/plugin-react | 8.3.4 / 6.1.2 | 2026-10-08 / 2026-10-05 |
| react / react-dom | 19.3.1 | 2026-10-14 |
| hono / @hono/zod-openapi / zod | 4.13.13 / 1.6.3 / 4.6.7 | 2026-10-04 / 2026-09-04 / 2026-10-12 |
| drizzle-orm / drizzle-kit | 1.0.0-rc.4 (exato) | 2026-06-27 |
| pg / @types/pg | 8.23.1 / 8.23.1 | 2026-09-30 / 2026-08-17 |
| vitest | 5.0.5 | 2026-10-15 |
| postgres (Docker) | 18.6-alpine | 2026-09-21 |

O que ficou:
- `packages/skeleton/` (`@workspace/skeleton`): `createApp()` (Hono + `@hono/zod-openapi`, `GET /api/health`, um cliente `pg` por request), schema `skeleton` com `member_roles` (`owner`, `employee`), migrations em `packages/skeleton/drizzle/` com journal `drizzle.__skeleton_migrations`; `defineProductDrizzleConfig()` para o Product (tabelas em `public`, journal `drizzle.__product_migrations`); CLI `skeleton` (`dev`, `db migrate`, `db check`, `migrations check-published`).
- `apps/example/`: `wrangler.jsonc` (Static Assets com `single-page-application` + `run_worker_first: ["/api/*"]`, `secrets.required: ["DATABASE_URL"]`), Vite + `@cloudflare/vite-plugin`, SPA React mínima, `drizzle.config.ts` de uma linha.
- `pnpm factory:verify` (`scripts/verify.ts`): `turbo run typecheck lint test e2e` (`--affected` com a flag ou com `CI`), usa `DATABASE_URL` ou sobe o `docker compose` num projeto `<dir>-verify` com porta aleatória e o remove no fim. Verde do zero (sem cache, sem `dist`, sem `DATABASE_URL`) em ~60 s.
- Seam 6: `skeleton db check` (no `test` de cada Product) roda `drizzle-kit check`, migra um banco novo e exige `push --explain` = `no_changes` nos dois configs; `skeleton migrations check-published` (no `lint`) compara com o merge base de `origin/$GITHUB_BASE_REF`, `origin/main` ou `main` e falha em migration publicada editada, renomeada ou apagada.
- Seam 3: `packages/skeleton/test/health.test.ts` com `createTestHarness()` numa composição só de teste (`test/worker/`). O `e2e` do `example` roda o build de produção no harness (SPA, fallback de rota, `/api/health`, 404 sem SPA em `/api/`).
- Lint de imports no `.oxlintrc.json` (`no-restricted-imports`), com teste que roda a config real numa árvore temporária. Subpaths fora do `exports` do Skeleton já são barrados pelo `tsc` e pelo bundler.

Desvios e decisões:
- TypeScript 7.0.2 (o `latest`): o `tsc` nativo não tem a API JS clássica, e o `typescript-eslint` 8.71.2 exige `typescript <6.1.0`. Por isso o lint é o **oxlint**, não ESLint. O Kubb traz o seu TS 6 como dependência própria, sem conflito.
- Node 24 LTS em vez do 26 (ainda "Current"). Scripts `.ts` rodam com o type stripping nativo do Node, sem `tsx`.
- A migration `member_roles` é gerada pelo `drizzle-kit generate` com o `INSERT` acrescentado no mesmo `migration.sql` (antes de publicar).
- O `example` não tem tabelas próprias: o `db check` aceita "sem schema e sem migrations" para o Product; com migrations e sem schema, falha.
- Os journals das duas pastas ficam no schema `drizzle` (tabelas diferentes), para o `push --explain` com `schemaFilter` de cada config não enxergá-los como deriva.
- `pnpm dev` hoje roda o `dev` de todos os `apps/*`; "um só vs. `pnpm dev <id>`" fica no ticket 07.
- pnpm 12 exige `allowBuilds` (`esbuild`, `workerd`) no `pnpm-workspace.yaml`. Localmente, o pnpm 10 global não consegue trocar sozinho para o 12 (binário nativo); usei o pnpm 12.14.0 instalado pelo proto.
- Merge com o ticket 08: o catalog fica com `@types/node` 24.19.2 (o 08 tinha 26.6.5), para casar com o Node 24 do `.node-version`; o `.factory` passa no `typecheck` e nos testes com ele.
- pnpm 12 tem `minimumReleaseAge` de um dia por padrão e acrescentou sozinho `minimumReleaseAgeExclude` para o wrangler 4.151.2 e o workerd publicados hoje; dá para tirar a partir de 2026-10-20.
