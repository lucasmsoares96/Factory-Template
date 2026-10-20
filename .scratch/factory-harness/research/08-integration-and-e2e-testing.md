# Pesquisa 08 — Testes de integração e E2E para esta stack

Ticket: [08-integration-and-e2e-testing](../issues/08-integration-and-e2e-testing.md)
Data da pesquisa: 2026-10-17. Só fontes primárias (docs oficiais, código-fonte, registry do npm, releases no GitHub).

## Resposta

**Princípio que guia tudo** (skill `tdd` do repo): testar pelo seam público, mockar só nas fronteiras do sistema, preferir banco de teste real a mock. Daí: no back o seam é a **API HTTP** (o contrato OpenAPI); no front é o **componente/rota renderizado num navegador real** com a rede mockada; no E2E é o **navegador contra a stack inteira**. As únicas coisas mockadas são as externas: Resend (sempre), Neon (trocado por Postgres local) e, no front, a API (pelos handlers gerados do OpenAPI).

### (a) Integração do back

- **Ferramenta**: `createTestHarness()` do `wrangler` (API nova, desde wrangler 4.99.0, junho de 2026), rodando em Vitest no Node. A Cloudflare recomenda hoje exatamente esta divisão: *Vitest integration para unit, `createTestHarness()` para integração* ([Testing, 2026-07-27](https://developers.cloudflare.com/workers/testing/)). O harness roda o build de produção do Worker, devolve `server.fetch()`, dá acesso aos bindings e **roteia todo `fetch()` de saída do Worker pelo `globalThis.fetch` do Node**. Assim o `msw/node` intercepta a chamada à API do Resend sem nenhum código de teste dentro do Worker.
- **`@cloudflare/vitest-pool-workers` morreu**: foi renomeado para `@cloudflare/vitest-plugin` (1.4.4), e o pacote antigo está marcado como `deprecated` no npm. Usar o plugin `cloudflareTest()` só para unit tests que precisem do runtime (bindings, Durable Objects), com MSW via `@msw/cloudflare`.
- **Banco**: Postgres real e local, **não** um branch do Neon. No CI comum e no E2E Stage, sobe um `postgres` como service container (GitHub Actions) ou um container local no runner da Factory. O Worker fala com ele pelo **binding Hyperdrive com `localConnectionString`** (ou pela env `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>`), que o `wrangler dev` e o harness usam para conectar direto ao banco por TCP. Migrations do Drizzle rodam no `globalSetup`.
  - Neon branch efêmero fica **só para o preview por PR** (ticket 05): o plano Free tem 10 branches por projeto, e Factory paralela + previews + CI esgotariam isso.
  - PGlite (via `pglite-socket`) é **plano B** para runner sem Docker: não tem SSL e serve várias conexões por um multiplexador sobre uma conexão única, que a própria doc diz que "not all cases might be covered".
- **Isolamento entre testes**: o isolamento de storage da Cloudflare (por arquivo de teste) **não cobre Postgres externo**. Recomendação:
  1. Isolar pelos dados: cada teste cria a própria Company e os próprios usuários, com e-mails e ids únicos, por meio de factories. O app é multi-tenant por Company, então testes paralelos não colidem.
  2. Banco novo a cada execução (o container é efêmero).
  3. Se ainda houver colisões, usar um banco por worker clonado com `CREATE DATABASE … TEMPLATE` de um template já migrado. Último recurso: `reset()` do `drizzle-seed` (TRUNCATE … CASCADE) com `maxWorkers: 1`.
- **Better Auth em teste**: plugin `testUtils()` (de `better-auth/plugins`, desde fev. 2026), registrado numa **instância de auth só de teste**. Ele dá factories (`createUser`), helpers de banco (`saveUser`, `addMember`) e `login`/`getAuthHeaders`/`getCookies` para pular o fluxo de login. Com `captureOTP` captura OTPs. Testes do próprio cadastro/login continuam usando o endpoint público.

### (b) Integração do front

- **Vitest Browser Mode** (estável desde o Vitest 4; Vitest 5.0.5 hoje) com o provider `@vitest/browser-playwright` (Chromium headless) e `vitest-browser-react` 2.3.0 para `render`. O Vitest chama Browser Mode de "the recommended approach for component testing" e lista os falsos positivos/negativos de jsdom/happy-dom. **Não usar jsdom/happy-dom.**
- **Testing Library**: no Browser Mode, o `vitest-browser-react` substitui `@testing-library/react`, mas segue os mesmos princípios: locators `getByRole` > `getByLabelText` > `getByText` > `getByTestId`, e `await expect.element(...)` com retry.
- **MSW + Kubb**: `@kubb/plugin-msw` (5.1.3) com `parser: 'faker'` e `handlers: true`, mais `@kubb/plugin-faker` com `seed` fixo. O Kubb gera um handler por operação do OpenAPI e um `handlers.ts`. No Browser Mode, um fixture `test.extend` com `setupWorker(...handlers)` e `auto: true`; cada teste sobrescreve só o que importa com `worker.use(getXHandler({...}))`.
- Seam do front: a rota/página renderizada com `QueryClientProvider` e router reais. A rede é a única fronteira mockada.

### (c) E2E

- **Playwright 1.64** contra a **stack local**, iniciada por um fixture de worker com `createTestHarness()`. Isso segue o exemplo oficial da Cloudflare "Playwright + MSW + createTestHarness": front (build do Vite) + API Worker, `baseURL` vindo de `server.listen()`, `server.reset()` e `network.resetHandlers()` depois de cada teste, e `server.debug()` quando um teste falha.
- **Autenticação**: o padrão do Playwright é o *setup project* com `storageState` em `playwright/.auth` (no `.gitignore`). Como os testes alteram estado no servidor, o recomendado é **uma conta por worker paralelo**. Neste stack, a conta vem de `testUtils().getCookies()` + `context.addCookies()`, o que dispensa a UI. Um teste dedicado cobre cadastro e login pela UI.
- **E-mails de convite**:
  - **Local (E2E Stage e CI)**: o `msw/node` no fixture intercepta `POST https://api.resend.com/emails`, guarda o payload (to/subject/html) e responde `200 {id}`. O teste extrai o link do convite do HTML e o abre. Nada sai para a rede e a cota não é consumida. Isso só funciona porque o harness proxia o `fetch` de saída pelo Node e o SDK `resend` usa `fetch` global.
  - **Preview (smoke pós-deploy)**: enviar para `qualquer-coisa@<id>.resend.app` (domínio de recebimento gerenciado pelo Resend) e ler pela API *List/Retrieve Received Email* (`html`, `text`). Os endereços `delivered@resend.dev` só simulam eventos de entrega e não permitem ler o conteúdo. **O Resend não tem modo sandbox.** Mesmo os e-mails de teste consomem cota, e no Free a cota é de 100/dia **contando enviados e recebidos**.

### O que roda onde

| Camada | Factory: Development Stage (loop TDD) | Factory: **E2E Stage** | CI comum (push/PR) | Pós-deploy do preview |
|---|---|---|---|---|
| Unit (Vitest node / `cloudflareTest`) | sim, só o que mudou | sim (suíte toda, rápida) | sim | — |
| Integração do back (`createTestHarness` + Postgres local + MSW Resend) | sim, seams afetados | sim (suíte toda) | sim | — |
| Integração do front (Vitest Browser Mode + MSW/Kubb) | sim, seams afetados | sim (suíte toda) | sim | — |
| E2E Playwright na stack local (harness + Postgres + MSW Resend) | não | **sim**: os critérios de aceite da issue + a suíte E2E toda; gera screenshots/trace para o PR (ticket 04) | sim (mesma suíte; é a evidência que o Merge Gate vê) | — |
| Smoke E2E no preview (URL do preview + branch Neon + Resend real para `*.resend.app`) | não | **não** (o preview só existe depois do PR) | — | sim, poucos testes (cadastro, criar Company, convite), sem bloquear o loop da Factory |

Resumo: o **E2E Stage roda tudo localmente e de forma determinística**, sem depender de rede externa, preview ou cota. Assim, uma falha volta para o Development com um sinal limpo e conta como uma das 5 voltas antes da Escalation. O CI repete a mesma coisa como evidência independente. Só o **smoke no preview** toca Neon e Resend de verdade.

## Esboços

### Back: Vitest + `createTestHarness` + Postgres + MSW (Resend)

```ts
// apps/api/test/setup/harness.ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw/http";          // MSW 3: entrypoint msw/http
import { createTestHarness } from "wrangler";

export const sentEmails: Array<{ to: string[]; subject: string; html: string }> = [];
export const network = setupServer(
  http.post("https://api.resend.com/emails", async ({ request }) => {
    const body = (await request.json()) as any;
    sentEmails.push({ to: [body.to].flat(), subject: body.subject, html: body.html });
    return HttpResponse.json({ id: crypto.randomUUID() });
  }),
);

// DATABASE_URL vem do globalSetup (container/service) já migrado com drizzle-kit
export const server = createTestHarness({
  workers: [{
    configPath: "./wrangler.jsonc",
    env: "test",
    secrets: { RESEND_API_KEY: "re_test", BETTER_AUTH_SECRET: "test-secret" },
  }],
});
// wrangler.jsonc (env test): hyperdrive[].localConnectionString = "postgres://postgres:postgres@127.0.0.1:5432/app_test"
//   ou export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=...
```

```ts
// apps/api/test/companies.test.ts
beforeAll(async () => { network.listen({ onUnhandledFrame: "error" }); await server.listen(); });
afterEach(async () => { network.resetHandlers(); sentEmails.length = 0; await server.reset(); });
afterAll(async () => { network.close(); await server.close(); });

test("owner can invite a member to their Company", async ({ expect }) => {
  const { headers } = await signedInOwner();                 // testUtils().login(...) numa auth de teste
  const company = await createCompany(headers, { name: "Acme" });
  const res = await server.fetch(`/api/companies/${company.id}/invitations`, {
    method: "POST", headers, body: JSON.stringify({ email: "ana@example.com" }),
  });
  expect(res.status).toBe(201);
  expect(sentEmails).toEqual([expect.objectContaining({ to: ["ana@example.com"] })]);
});
```

### Front: Vitest Browser Mode + Kubb/MSW

```ts
// kubb.config.ts
plugins: [
  pluginTs(),
  pluginFaker({ seed: [42] }),
  pluginMsw({ output: { path: "handlers", mode: "directory" }, parser: "faker", handlers: true }),
]

// apps/web/vitest.config.ts
import { playwright } from "@vitest/browser-playwright";
export default defineConfig({
  plugins: [react()],
  test: { setupFiles: ["./test/setup.ts"],
    browser: { enabled: true, provider: playwright(), headless: true, instances: [{ browser: "chromium" }] } },
});

// apps/web/test/test.ts — fixture recomendado pelo MSW para Browser Mode
import { test as base } from "vitest";
import { setupWorker } from "msw/browser";
import { handlers } from "../src/gen/handlers/handlers";
const worker = setupWorker(...handlers);
export const test = base.extend({
  worker: [async ({}, use) => { await worker.start({ quiet: true }); await use(worker); worker.resetHandlers(); }, { auto: true }],
});

// apps/web/src/routes/companies.test.tsx
test("shows an empty state when the user has no Companies", async ({ worker }) => {
  worker.use(listCompaniesHandler([]));
  const screen = await renderRoute("/companies");            // router + QueryClient reais
  await expect.element(screen.getByRole("heading", { name: "Nenhuma empresa ainda" })).toBeVisible();
});
```

### E2E: Playwright + harness + MSW + Better Auth testUtils

```ts
// e2e/fixtures.ts (adaptado do exemplo oficial da Cloudflare)
export const test = base.extend<{ inbox: Email[] }, { server: TestHarness; network: SetupServerApi }>({
  network: [async ({}, use) => { const n = setupServer(resendCapture); n.listen({ onUnhandledFrame: "error" }); await use(n); n.close(); }, { scope: "worker" }],
  server: [async ({}, use) => {
    const s = createTestHarness({ workers: [
      { configPath: "./dist/web/wrangler.json" },             // front buildado (Vite plugin)
      { configPath: "./apps/api/wrangler.jsonc", env: "test" },
    ] });
    await s.listen(); await use(s); await s.close();
  }, { scope: "worker" }],
  baseURL: async ({ server }, use) => use((await server.listen()).url.href),
  storageState: async ({ browser }, use) => { /* testUtils.getCookies({ userId }) por worker → addCookies */ },
});

// e2e/invite.spec.ts
test("invited member joins the Company from the email link", async ({ page, inbox }) => {
  await page.goto("/companies/acme/members");
  await page.getByRole("button", { name: "Convidar" }).click();
  await page.getByLabel("E-mail").fill("ana+w1@example.com");
  await page.getByRole("button", { name: "Enviar convite" }).click();
  const link = extractLink(inbox.find((m) => m.to.includes("ana+w1@example.com"))!.html);
  // abre em contexto novo, aceita, verifica membro na lista…
});
```

```ts
// playwright.config.ts
export default defineConfig({
  workers: process.env.CI ? 1 : undefined,                    // recomendação oficial para CI
  retries: process.env.CI ? 1 : 0,
  use: { trace: "on-first-retry", screenshot: "on" },        // insumo do ticket 04
});
```

### CI (GitHub Actions)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest            # service containers exigem Linux
    services:
      postgres:
        image: postgres:18
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: app_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: postgres://postgres:postgres@127.0.0.1:5432/app_test
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version: 22 }
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run db:migrate && npm test && npm run build && npx playwright test
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: { name: playwright-report, path: playwright-report/ }
```

## Achados detalhados

### Versões consultadas (npm registry, 2026-10-17)

| Pacote | Versão | Publicado |
|---|---|---|
| `@cloudflare/vitest-plugin` | 1.4.4 (peer `vitest ^4.1.0 \|\| ^5.0.0`) | criado 2026-08-20; última 2026-10-16 |
| `@cloudflare/vitest-pool-workers` | 0.23.0 (peer `vitest ^4.1.0`), **deprecated**: "renamed to @cloudflare/vitest-plugin" | 2026-10-07 |
| `wrangler` | 4.151.1 (`createTestHarness` desde 4.99.0) | 2026-10-16 |
| `vitest` / `@vitest/browser-playwright` | 5.0.5 (5.0.0 em 2026-09-03; exige Node 22 e Vite 6.4) | 2026-10-15 |
| `vitest-browser-react` | 2.3.0 (peer `vitest ^4 \|\| ^5`) | 2026-09-04 |
| `@testing-library/react` | 16.3.3 | 2026-08-27 |
| `msw` | 3.0.3 (3.0.0 em 2026-09-28) | 2026-10-10 |
| `@msw/cloudflare` | 0.2.0 (peer `msw >=3`) | 2026-09-28 |
| `@kubb/plugin-msw` / `@kubb/plugin-faker` | 5.1.3 (peer `msw ^2.0.0`) / 5.1.9 | 2026-10-15/16 |
| `@playwright/test` | 1.64.1 (1.64.0 em 2026-10-07) | 2026-10-17 |
| `hono` | 4.13.13 | 2026-10-10 |
| `better-auth` | 1.7.10 (1.8.0-beta.1 em pré-release) | 2026-10-15 |
| `drizzle-orm` / `drizzle-seed` | 0.45.4 `latest`, 1.0.0-rc.4 `rc` / 0.3.1 | 2026-10-08 |
| `@electric-sql/pglite` / `pglite-socket` | 0.5.10 / 0.2.13 | 2026-10-14 |
| `resend` | 6.34.1 | 2026-10-16 |
| `neondatabase/create-branch-action` | 6.3.1 | 2026-03-31 |

### Cloudflare Workers

1. **Divisão recomendada**: "For most projects, use the Workers Vitest integration for unit tests and the `createTestHarness()` API for integration tests." O harness dá "Confidence from exercising production Worker builds" e é compatível "with any Node.js test runner and tools such as Playwright or MSW." — [Testing](https://developers.cloudflare.com/workers/testing/) (atualizada 2026-07-27).
2. **`createTestHarness`**: `server.listen()/reset()/close()`. `reset()` "Recreates storage and restores the original Worker options". Também oferece `getWorker(name).getEnv()`, `getLogs()`, `debug()`, `vars`/`secrets` por Worker, `env` de Wrangler e vários Workers com roteamento por `routes`. Workers da Cloudflare Vite plugin entram pelo output de `vite build` (`./dist/<name>/wrangler.json`). — [Test harness](https://developers.cloudflare.com/workers/testing/test-harness/), [Configure](https://developers.cloudflare.com/workers/testing/test-harness/configure/) (2026-07-27). Entrou no wrangler 4.99.0 ([CHANGELOG](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/CHANGELOG.md), PR #14169, commit de 2026-06-08).
3. **Fetch de saída passa pelo Node**: "The test harness proxies outbound `fetch()` requests from your Workers through the `globalThis.fetch()` function in your Node environment." — [Prepare test state](https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/). No código, `outboundService: (request) => globalThis.fetch(request.url, request)` ([test-harness.ts](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/api/test-harness.ts)). O harness usa o mesmo `DevEnv` do `wrangler dev`.
4. **Exemplo oficial Playwright + MSW + harness**: fixtures `network` e `server` com `scope: "worker"`, `baseURL` vindo de `server.listen()`, e um `reset` automático que chama `server.debug()` quando o teste falha. — [Integrations](https://developers.cloudflare.com/workers/testing/test-harness/integrations/) e o [fixture create-test-harness-example](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/create-test-harness-example).
5. **Renomeação do pacote**: "The package API and Vitest configuration are unchanged"; há um codemod `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`. — [Migrate to Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/) (2026-08-20). A config usa `cloudflareTest()` dentro de `defineConfig({ plugins })`, `env`/`exports` vêm de `cloudflare:workers` e o teste chama `exports.default.fetch()`. "Custom Vitest `environment`s or `runner`s are not supported." — [Configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/), [Write your first test](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/) (2026-10-08).
6. **Isolamento do plugin**: "Storage isolation is per test file". Para compartilhar estado, `--max-workers=1 --no-isolate`. A página **não fala de bancos externos**. — [Isolation and concurrency](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/) (2026-10-12). Known issues: sem coverage V8 (usar Istanbul), `import()` dinâmico falha em `exports.default.fetch()`, e o `globalSetup` roda em Node, o que quebra Postgres.js (há workaround via `ssrLoadModule`). — [Known issues](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/) (2026-08-20).
7. **Mock de saída no plugin**: `@msw/cloudflare` (`setupNetwork()`, `network.enable()/resetHandlers()/disable()`) exige `msw@^3`. — [Mock outbound requests](https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/) (2026-10-08).
8. **Hyperdrive em teste**: com `localConnectionString` ou com `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>` (a env tem precedência), o `wrangler dev` conecta direto ao banco, sem pooling nem cache. — [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/) (2026-04-21). No plugin Vitest, `miniflare.hyperdrives` + `inject()` do `globalSetup` — [fixture hyperdrive](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-plugin-examples/hyperdrive).

### Hono

9. `app.request()` e o helper tipado `testClient(app)` (só infere tipos com rotas encadeadas). — [Testing guide](https://hono.dev/docs/guides/testing) (último commit 2026-03-19), [Testing helper](https://hono.dev/docs/helpers/testing) (2025-08-22). **Desatualizado**: o guia ainda recomenda `@cloudflare/vitest-pool-workers`. Ver Contradições.

### Banco (Neon / Postgres / PGlite / Drizzle)

10. **Neon branch por execução de teste**: "create a fresh branch for each run"; limpeza por expiração ou por action de delete. — [CI/preview workflows](https://neon.com/branching/ci-preview-workflows). A action `create-branch-action` 6.3.1 tem as entradas `expires_at`, `branch_type: schema-only` e `parent_branch`, e as saídas `db_url` e `db_url_pooled` — [action.yml](https://github.com/neondatabase/create-branch-action/blob/main/action.yml). **Limite: 10 branches por projeto nos planos Free e Launch** (25 no Scale; extras a US$1,50/branch-mês) — [Plans](https://neon.com/docs/introduction/plans).
11. **Neon Local** (Docker `neondatabase/neon_local`) é só um proxy para um branch do Neon na nuvem: precisa de `NEON_API_KEY`, e o driver serverless funciona só por HTTP, não WebSocket. Não serve como "Postgres offline". — [Neon Local](https://neon.com/docs/local/neon-local).
12. **Postgres em service container**: exemplo oficial com `--health-cmd pg_isready` e `ports: 5432:5432`, acessado em `localhost`. "You must use a Linux environment when using service containers." — [GitHub Docs](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
13. **PGlite**: Drizzle conecta com `drizzle-orm/pglite` em memória — [Drizzle + PGlite](https://orm.drizzle.team/docs/connect-pglite). Como o Worker roda em `workerd`, ele só alcançaria o PGlite pelo `pglite-socket` (servidor TCP). "SSL connections are NOT supported". A concorrência é "supported through a multiplexer over the single conn, therefore not all cases might be covered". — [pglite-socket](https://pglite.dev/docs/pglite-socket).
14. **Drizzle + Neon**: `neon-http` é para queries não interativas; para transações interativas use `neon-serverless` (WebSocket). As docs instalam `drizzle-orm@rc`. — [Connect Neon](https://orm.drizzle.team/docs/connect-neon). **Implicação**: se o app usar o driver `neon-http` direto, o teste local exige Neon de verdade, porque o Neon Local depende da nuvem. Com Hyperdrive + `pg`/`postgres`, o mesmo código funciona contra qualquer Postgres. Isso é insumo para o ticket 06.
15. **Reset**: `reset(db, schema)` do `drizzle-seed` gera `TRUNCATE … CASCADE` "in your test suites"; `seed(db, schema, { seed })` é determinístico. — [Drizzle Seed](https://orm.drizzle.team/docs/seed-overview).
16. **Template DB**: "one can copy any database in a cluster by specifying its name as the template", com a limitação "no other sessions can be connected to the source database while it is being copied". — [PostgreSQL 18 docs §22.3](https://www.postgresql.org/docs/current/manage-ag-templatedbs.html).

### Better Auth

17. **`testUtils()`**: "Testing utilities for integration and E2E testing". Factories (`createUser`, `createOrganization`), DB helpers (`saveUser`, `deleteUser`, `saveOrganization`, `addMember`), auth helpers (`login`, `getAuthHeaders`, `getCookies` no formato do Playwright) e `captureOTP`/`getOTP`/`clearOTPs`. Recomendação: "keep `testUtils` out of your production auth config and add it from a separate test-only auth instance". — [Test Utils plugin](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/test-utils.mdx) (doc atualizada em 2026-09-09; plugin adicionado no PR #7746, em 2026-02-11). Há uma issue aberta sobre cookieCache/JWE em setups stateless (#9271).

### Front

18. **Browser Mode**: "Browser Mode is the recommended approach for component testing"; jsdom/happy-dom "only simulate a browser environment … false positives or negatives in test results may occur"; e "does not completely replace standalone end-to-end test runners". — [Component testing](https://vitest.dev/guide/browser/component-testing), [Why Browser Mode](https://vitest.dev/guide/browser/why). Estável desde o Vitest 4 ("removing the `experimental` tag", [blog Vitest 4](https://vitest.dev/blog/vitest-4)). O Vitest 5 (2026-09-03) trouxe Browser Mode mais rápido e Trace View embutido ([blog Vitest 5](https://vitest.dev/blog/vitest-5)). A config usa `provider: playwright()` de `@vitest/browser-playwright` ([Browser Mode](https://vitest.dev/guide/browser/)).
19. **Migração Testing Library**: troque `render` de `@testing-library/react` pelo de `vitest-browser-react`, use `await expect.element()` e as interações de `vitest/browser` em vez de `user-event`. — [Component testing](https://vitest.dev/guide/browser/component-testing). O `vitest-browser-react` "follows `testing-library` principles" ([README](https://github.com/vitest-dev/vitest-browser-react)). Prioridade de queries: `getByRole` é "your top preference for just about everything"; `getByTestId` só como último recurso. — [Testing Library: queries](https://testing-library.com/docs/queries/about/) (2024-03-19).
20. **MSW**: o Vitest recomenda MSW com `onUnhandledRequest: 'error'` ([Mocking requests](https://vitest.dev/guide/mocking/requests)). Para Browser Mode, o fixture `test.extend` com `worker.start()`, `{ auto: true }` e sem `worker.stop()` — [MSW: Vitest Browser Mode](https://mswjs.io/docs/recipes/vitest-browser-mode) (2026-09-30).
21. **MSW 3 (2026-09-28)**: ESM-only, Node ≥ 22, `onUnhandledRequest` → `onUnhandledFrame`, `http`/`HttpResponse` agora documentados em `msw/http`, e cookies não são mais geridos em Node. — [Release v3.0.0](https://github.com/mswjs/msw/releases/tag/v3.0.0), [Migração 2→3](https://mswjs.io/docs/migrations/2.x-to-3.x). Verifiquei no tarball `msw@3.0.3` que a raiz `msw` **ainda exporta** `http`, `HttpResponse` e `HttpResponseResolver`, que são os imports gerados pelo `@kubb/plugin-msw` 5.1.3.
22. **Kubb**: o `pluginMsw` gera um handler tipado por operação. Com `parser: 'faker'`, "a handler called without data returns mock data from `@kubb/plugin-faker`". `handlers: true` gera `handlers.ts` para `setupServer`/`setupWorker`. "Install `msw` v2". Em Node, defina `baseURL`; no browser, caminhos relativos funcionam. `pluginFaker({ seed })` gera dados determinísticos; requer `@faker-js/faker` v10. — [plugin-msw](https://kubb.dev/extensions/kubb-labs/plugin-msw), [options](https://kubb.dev/extensions/kubb-labs/plugin-msw/options), [mock-api guide](https://kubb.dev/extensions/kubb-labs/plugin-msw/guides/mock-api), [plugin-faker](https://kubb.dev/extensions/kubb-labs/plugin-faker).

### Playwright

23. **Auth**: setup project + `storageState` em `playwright/.auth` (gitignored). A conta compartilhada é "recommended approach for tests without server-side state". Para testes que mudam estado no servidor: "tests must use different accounts", uma por worker, via `test.info().parallelIndex`. — [Authentication](https://playwright.dev/docs/auth).
24. **webServer** (alternativa ao harness): `command`, `url`, `reuseExistingServer: !process.env.CI`, vários servidores em array e `gracefulShutdown`. — [Web server](https://playwright.dev/docs/test-webserver).
25. **CI**: "We recommend setting workers to "1" in CI environments to prioritize stability and reproducibility"; para escalar, use sharding. O workflow oficial roda `npx playwright install --with-deps` e faz upload do `playwright-report`. — [CI](https://playwright.dev/docs/ci), [CI intro](https://playwright.dev/docs/ci-intro).

### Resend

26. **Endereços de teste**: `delivered@`, `bounced@`, `complained@` e `suppressed@resend.dev`, com labels `+x`. Eles simulam eventos. A doc diz para evitar "sending to fake email addresses" e "setting up a fake SMTP server". "Test emails count against your account's sending quota." — [Send test emails](https://resend.com/docs/dashboard/emails/send-test-emails).
27. **Recebimento**: o subdomínio gerenciado `<id>.resend.app` recebe "any address at your Resend domain". *List Received Emails* devolve referências, e *Retrieve Received Email* devolve `html`, `text` e headers. O webhook não traz o corpo. — [Receiving](https://resend.com/docs/dashboard/receiving/introduction), [Get email content](https://resend.com/docs/dashboard/receiving/get-email-content), [List received emails](https://resend.com/docs/api-reference/emails/list-received-emails).
28. **Restrições**: o `from` `onboarding@resend.dev` só envia para o e-mail do dono da conta; para outros destinatários é preciso um domínio verificado ([403 resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). Free: "100 emails/day and 3,000 emails/month. This quota includes both sent and received emails" ([Quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)). Rate limit padrão de 10 req/s por time ([Usage limits](https://resend.com/docs/api-reference/rate-limit)).
29. **SDK usa `fetch` global** com `baseUrl` configurável (`https://api.resend.com` por padrão, ou `RESEND_BASE_URL`) — [resend-node src/resend.ts](https://github.com/resend/resend-node/blob/main/src/resend.ts). É isso que torna a interceptação por MSW possível sem tocar no código do app.

## Contradições e silêncios das fontes

- **Hono × Cloudflare**: o guia de testes do Hono ainda manda usar `@cloudflare/vitest-pool-workers`, que está deprecated. Vale a doc da Cloudflare.
- **Cloudflare × npm sobre o Vitest 5**: as docs de instalação fixam `vitest@^4.1.0` ("requires Vitest 4.1 or later"), mas o peer do `@cloudflare/vitest-plugin` 1.4.4 já aceita `^5.0.0`. Não há nota oficial de suporte ao Vitest 5. Recomendo testar o Vitest 5 e, se quebrar, fixar o 4.x só no projeto do Worker.
- **Exemplos da Cloudflare usam API do MSW 2** (`onUnhandledRequest`, `http` de `msw`) na página do harness (julho/2026), enquanto a página do plugin (outubro/2026) exige `msw@^3`, onde a opção virou `onUnhandledFrame`.
- **Kubb × MSW 3**: o `@kubb/plugin-msw` declara peer `msw ^2.0.0` e a doc diz "Install msw v2". O `@msw/cloudflare` exige `msw >=3`. Os imports gerados ainda existem na raiz do MSW 3 (verificado no tarball), mas o Kubb não documenta suporte ao MSW 3.
- **`createTestHarness` + Hyperdrive**: as docs do harness não mencionam Hyperdrive nem bancos TCP. Pelo código, o harness usa o mesmo `DevEnv` do `wrangler dev`, então *presumo* que `localConnectionString` e a env `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_*` funcionem. **Não verificado.**
- **Isolamento de Postgres externo**: nenhuma fonte da Cloudflare trata disso. O isolamento dela vale só para storage simulado (KV, R2, D1, DO).
- **Better Auth `testUtils` contra um Worker**: os exemplos importam `auth` no mesmo processo do teste. Usar o plugin com o app rodando em outro processo (o harness) exige uma instância de auth de teste em Node com o **mesmo banco e o mesmo `secret`** para que os cookies assinados valham. A doc não diz isso explicitamente; é inferência.
- **Resend sandbox**: não existe modo de teste que retenha o envio. A doc só oferece endereços `resend.dev` (simulação de eventos) e recebimento real.

## Riscos em aberto

1. **Runner da Factory sem Docker** (depende do ticket 01): sem Docker não há Postgres em container no E2E Stage. O plano B é o `pglite-socket`, cuja compatibilidade com o Hyperdrive local do `workerd` (TCP, sem SSL, multiplexador) não foi verificada. A alternativa é um Postgres instalado no runner.
2. **Escolha do driver** (ticket 06): toda a estratégia local assume Hyperdrive + `pg`/`postgres`. Se a stack ficar com `neon-http` direto, os testes locais passam a precisar de branch do Neon a cada execução, batendo no limite de 10 branches do plano Free e adicionando latência e dependência de rede ao E2E Stage.
3. **Front em Pages × Workers static assets** (ticket 06): o harness carrega o front pelo output do Cloudflare Vite plugin (`dist/<name>/wrangler.json`). Se o front ficar no Cloudflare Pages, o E2E local precisa de `vite preview`/`webServer` do Playwright para o front, com o harness só para a API.
4. **Versões em transição**: Vitest 4→5, MSW 2→3 (Kubb ainda em v2) e Drizzle 0.45→1.0-rc. Vale um spike no Skeleton para confirmar a combinação `vitest@5 + @cloudflare/vitest-plugin + msw@3 + @kubb/plugin-msw` antes de escrever as specs.
5. **Cota do Resend no smoke do preview**: cada convite para `*.resend.app` conta como envio **e** recebimento. No Free (100/dia), poucas execuções paralelas da Factory esgotam a cota. O smoke real precisa ser mínimo, ou rodar só no merge, ou exigir plano pago.
6. **Instância de auth de teste fora do Worker**: se ficar frágil (secret, cookieCache; issue #9271 aberta), o fallback é o setup project do Playwright fazendo cadastro/login pela API pública (`request.post`) e salvando o `storageState` por worker.
7. **Flakiness × limite de 5 voltas**: um E2E instável faz a Factory gastar voltas e escalar sem motivo real. Use `retries: 1` + `trace: on-first-retry` no E2E Stage e distinga no relatório uma falha que passou no retry ("flaky") de uma falha determinística. Só a determinística deve contar como volta. Isso é decisão do harness (ticket 03/09).
