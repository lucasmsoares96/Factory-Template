# 04: Login, logout e `GET /api/me`

Spec: [../spec.md](../spec.md)

**What to build:** um usuário verificado entra com email e senha e vê o próprio nome na página inicial; depois sai. Tentativas em excesso do mesmo IP recebem 429. A fatia mínima `GET /api/me` atravessa todas as camadas e serve de modelo para toda rota futura.

**Blocked by:** 03

**Status:** done

- [x] Telas de login e logout; redirect para o login quando não há sessão.
- [x] Rate limit com `rateLimit.enabled: true`, `customStorage` num DO `RateLimiter` (SQLite) e `ipAddressHeaders: ["cf-connecting-ip"]`.
- [x] `GET /api/me` com Zod e OpenAPI (`operationId`, `summary`, `description`), hook do Kubb e página inicial logada com o nome. Nada de Company.
- [x] Ponto único que resolve o usuário pela sessão (o token do MCP entra no ticket 06).
- [x] Testes de integração: login ok, senha errada, 429 depois do limite, `/api/me` com e sem sessão (seam 3).
- [x] Teste da página inicial no Browser Mode (seam 4) e E2E `@evidence` cadastro → login → nome na tela → logout (seam 5).

## Comments

Implementado em 2026-10-19. Nenhuma dependência nova: tudo sai das versões já fixadas no `catalog` (better-auth 1.7.11, wrangler 4.151.2, @hono/zod-openapi 1.6.3, Kubb 5.11.1, TanStack Router 1.170.45 / Query 5.104.4 / Form 1.33.5), conferidas de novo nos tipos e no código publicados nessa data.

O que ficou:
- `RateLimiter` (`@workspace/skeleton/durable-objects`, binding `RATE_LIMITER`, migration de DO `v2` com `new_sqlite_classes`): um objeto por chave do Better Auth (`<ip>|<path>`, `getByName`), contador no SQLite do DO pela API síncrona `ctx.storage.kv` (ler-decidir-gravar atômico), alarm que apaga a chave quando a janela fecha. `rateLimitStorage(pool)` é o `customStorage.consume` (tipado estruturalmente, como o `PasswordHasherPool`). `authOptions()` liga `rateLimit.enabled: true` e `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`; regras padrão do Better Auth (sign-in/sign-up: 3 a cada 10 s).
- O 429 do Better Auth não tem `code`: `/api/auth/*` responde `{ code: "TOO_MANY_REQUESTS", message }` com `Retry-After` (e `X-Retry-After`). Novos códigos: `UNAUTHENTICATED`, `TOO_MANY_REQUESTS`, e `INVALID_EMAIL_OR_PASSWORD` nos códigos do Better Auth que as telas traduzem.
- `c.var.auth()`: a instância do Better Auth do request, criada no primeiro uso (`authContext`), usada por `/api/auth/*` e pelo resolvedor.
- Ponto único da identidade: `platform/identity.ts`. `resolveIdentity(c)` percorre uma lista de fontes (`session` hoje; o token do MCP entra como mais uma fonte no ticket 06, sem mexer nos chamadores) e devolve `Identity = { user: { id, name, email }, via }`. `requireIdentity` (middleware de rota) seta `c.var.identity` ou responde 401 `UNAUTHENTICATED`; `unauthenticatedResponse` é o 401 que a rota declara. A sessão renovada pelo Better Auth sai no `set-cookie` da resposta. Exportados no `@workspace/skeleton` junto com `errorResponse(description, ...codes)`.
- `GET /api/me` (`features/me/api.ts`): schema `Me` nomeado, `operationId: getMe`, `summary`, `description`, respostas 200 e 401, `middleware: [requireIdentity]`; o handler lê só `c.var.identity`. O comentário no topo descreve o molde para as próximas rotas. Hook `useGetMe` e handlers MSW `getMeHandler*` saem do Kubb.
- SPA: layout `/_signed-in` (`client/signed-in.tsx`, por `layout()` do virtual-file-routes) que faz `ensureQueryData(getMeQueryOptions())` no `beforeLoad` e manda para `/sign-in?redirect=...` no 401; mostra o nome e o botão "Sair". A home (`Olá, {name}`) e as rotas de feature do Product ficam dentro dele. Tela `/sign-in` (TanStack Form; erro traduzido pelo código; `EMAIL_NOT_VERIFIED` oferece o link para `/check-email`; volta para o `redirect` só se for caminho relativo da própria SPA). Sair: `signOut`, vai para `/sign-in?signedOut=true` ("Você saiu.") e limpa o cache do Query. Links entre cadastro e login, e de "email verificado" para o login.
- Testes: seam 3 `test/me.test.ts` (com sessão, sem sessão, cookie forjado e sessão revogada, operação no documento OpenAPI) e `test/sign-in.test.ts` (login ok → `/api/me`, senha errada e email desconhecido iguais em 401, 429 depois de 3 tentativas mesmo com a senha certa, limite por `cf-connecting-ip` sem efeito do `x-forwarded-for`, logout invalida o cookie). Conferido por mutação que os testes de 429 falham com o rate limit desligado e com a decisão do DO ignorada. Seam 4 `test/browser/home.browser.test.tsx` e `test/browser/sign-in.browser.test.tsx` (handler gerado `getMeHandlerResponse401` como override). Seam 5 `e2e/specs/account.spec.ts` `@evidence` (`sign-up`, `check-email`, `email-verified`, `home`, `signed-out`) e `home.spec.ts` (`sign-in`, redirect sem sessão).
- `TURBO_FORCE=1 pnpm factory:verify` verde (12 tasks; skeleton 58 testes, harness 91, E2E do example 4 + 2 specs).

Desvios e decisões:
- Janela fixa no `RateLimiter` (abre na primeira tentativa, `retryAfter` até ela fechar), em vez da janela do Better Auth que recomeça a cada tentativa aceita. Mesma regra de 3 a cada 10 s, sem retry em `.retryable` (o `consume` não é idempotente).
- O `workerd` local mantém um `CF-Connecting-IP` enviado pelo cliente (a Cloudflare sobrescreve na borda). Por isso o `startTestWorker` sorteia um IP por request e os testes de rate limit fixam um, e o E2E dá um IP por teste (`extraHTTPHeaders`), para um teste nunca bloquear outro.
- A home não mostra mais o status da API (`getHealth` segue como rota e no contrato); os textos `home.apiStatus*` saíram do i18n.
- As rotas de feature do Product (`routes` do `skeleton({ routes })`) passam a ficar dentro do layout logado. Uma página pública de Product, se aparecer, pede crescer a interface (ticket 07).
- `sendOnSignIn` continua `false`: o login de um não verificado recusa e a tela oferece o reenvio.

Pending (human): conferir na conta (ticket 14, smoke) que o 429 aparece por IP atrás da Cloudflare e que as linhas gravadas pelo `RateLimiter` cabem nas cotas de DO do Free.
