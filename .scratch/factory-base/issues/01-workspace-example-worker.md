# 01: Workspace e Worker do `example` de pé

Spec: [../spec.md](../spec.md)

**What to build:** um dev clona o repo, roda `pnpm install` e `pnpm dev` e vê o Worker do Product `example` servir a SPA e responder no `/api/*`. Já existe o workspace com vários Products: `packages/skeleton/` (o Skeleton) e `apps/example/` (raiz de composição fina), com o Postgres local e as migrations do Skeleton separadas das do Product. `pnpm factory:verify` roda verde do zero.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workspace pnpm + Turborepo com catalog de versões fixadas, conferidas na documentação oficial atual e registradas com data neste ticket.
- [ ] Um Worker por Product: SPA em Static Assets + Hono em `/api/*` (`run_worker_first`), com uma rota de saúde.
- [ ] Postgres de teste por `docker compose`. `pg` + Drizzle `1.0.0-rc.4`, com schema Postgres e `migrationsTable` do Skeleton separados dos do Product; as do Skeleton rodam antes.
- [ ] `member_roles` com as linhas `owner` e `employee` numa migration do Skeleton.
- [ ] Tasks do Turborepo (`generate`, `typecheck`, `lint`, `test`, `e2e`, `build`) e `pnpm factory:verify`, que usa o `DATABASE_URL` se existir ou sobe o `docker compose`.
- [ ] Lint de imports: o Product só importa exports públicos do Skeleton, e o Skeleton nunca importa de `apps/`.
- [ ] `drizzle-kit check` + migrate num banco vazio com `no_changes` no `verify`, e uma checagem que falha se uma migration publicada mudar (seam 6).
- [ ] Teste de integração da rota de saúde com `createTestHarness()` contra o Postgres do container (seam 3).
