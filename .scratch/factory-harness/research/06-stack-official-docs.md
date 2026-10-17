# Stack segundo a documentação oficial atual (outubro de 2026)

Pesquisa do ticket [06](../issues/06-stack-official-docs.md). Consultas feitas em 2026-10-17. Versões tiradas do npm (`npm view <pkg> version time`) e dos releases no GitHub nessa data. Toda afirmação aponta para a fonte que a sustenta. Quando a fonte não fala do assunto ou se contradiz, isso está dito.

## Resposta

A stack pedida continua válida, mas três peças precisam de ajuste e algumas precisam ser explicitadas:

1. **Front em Cloudflare Pages deve virar Workers com Static Assets.** A própria página do Pages manda começar projetos novos no Workers, e o Vite plugin e o recurso novo **Worker Previews** (preview isolado por branch/PR) existem só no Workers. A recomendação é **um único Worker** servindo a SPA React e a API Hono em `/api/*`.
2. **Acesso ao Neon dentro do Worker: usar Hyperdrive + `pg` (node-postgres) com `drizzle-orm/node-postgres`**, e não o driver serverless do Neon. Neon e Cloudflare recomendam isso. Fica um ponto em aberto para o ticket 05: Hyperdrive tem limite de configs por conta (10 no Free, 25 no Paid), o que pesa num preview por PR com branch Neon.
3. **Drizzle está num momento de transição.** O estável é 0.45.4, a v1 está em RC desde abril e a documentação já ensina a v1. É preciso decidir qual linha usar.

As outras peças continuam como estão e só ganham versões e formas atuais: Hono 4.13 (v5 está em RC, ainda não), `@hono/zod-openapi` 1.6 (exige **Zod 4**), `@hono/swagger-ui`, Zod 4.6, Kubb **v5** (reescrito, com `@kubb/plugin-react-query` + `@kubb/plugin-zod` + `@kubb/plugin-fetch`), TanStack Query 5.104, TanStack Form 1.33 (Standard Schema, sem adapter), shadcn/ui (agora com **Base UI** como padrão), Resend 6.34 + `react-email` 6 (o pacote `@react-email/components` foi descontinuado), pnpm 12 + Turborepo 2.11. Deploy por GitHub Actions com `cloudflare/wrangler-action@v4` + `wrangler deploy` continua sendo o caminho documentado. O CLI novo `cf` está em beta e substituirá o Wrangler no futuro, mas não agora.

## Trocas propostas

Cada item é uma decisão do usuário (ticket 13). "Recomendo" é só a recomendação desta pesquisa.

### T1. Cloudflare Pages → Workers + Static Assets + `@cloudflare/vite-plugin` (recomendo)
- **Por quê:** a página inicial do Pages abre com o aviso "Are you sure you want to use Pages?", diz que o Workers é "Cloudflare's primary platform for building applications" e orienta: "Start new projects with Workers". Pages não está deprecado e segue "Available on all plans". O guia de migração lista recursos que só o Workers tem: Vite plugin, gradual deployments, Workers Logs, source maps, Cron Triggers, rate limiting etc. O **Worker Previews** dá a cada branch/PR um ambiente próprio, com vars, secrets e bindings separados ("Previews do not inherit production settings"), o que atende ao "preview por PR obrigatório" do mapa.
- **Fontes:** [Pages overview](https://developers.cloudflare.com/pages/) (atualizada em 2026-08-25); [Migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) (2026-10-12); [Worker Previews](https://developers.cloudflare.com/workers/previews/) (2026-09-24).
- **Impacto:** o domínio custom precisa ter os nameservers na Cloudflare ("Workers does not support any domain whose nameservers are not managed by Cloudflare"). Preview passa a ser feito com `wrangler preview` (Wrangler ≥ 4.135.0) em vez de Pages preview deployments. Branch Deploy Controls têm suporte só parcial no Workers. A stack pedida já cita "GitHub Actions com `wrangler deploy`", o que bate com o Workers.

### T2. Front e API separados → um único Worker (SPA + Hono em `/api/*`) (recomendo)
- **Por quê:** é o padrão dos guias e templates oficiais. O guia React on Workers gera `worker/index.ts` com `/api/` junto da SPA. O template oficial `vite-react-template` é "React application with Vite, Hono, and Cloudflare Workers". A config é `assets.not_found_handling: "single-page-application"` + `run_worker_first: ["/api/*"]` (exige Wrangler ≥ 4.20 ou Vite plugin ≥ 1.7). Com front e API na mesma origem não há CORS, e os cookies de sessão do auth ficam mais simples (ver ticket 07). Navegações servidas como asset não são cobradas como invocação.
- **Fontes:** [React + Vite on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/) (2026-09-05); [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) (2026-10-12); [cloudflare/templates `vite-react-template`](https://github.com/cloudflare/templates/tree/main/vite-react-template).
- **Impacto:** um deploy, um preview e um `wrangler.jsonc` por ambiente. No monorepo, front e back podem continuar em pacotes separados, com o Worker importando o app Hono. A alternativa (dois Workers ligados por service binding) só compensa se front e back precisarem de deploys independentes. Previews chamam a **produção** do Worker ligado por service binding ("Service bindings from a Preview call the bound Worker's production deployment"), o que pesa contra dois Workers.

### T3. Driver serverless do Neon → Hyperdrive + `pg` + `drizzle-orm/node-postgres` (recomendo, condicionado ao ticket 05)
- **Por quê:** Neon diz que recomenda Hyperdrive para Workers e manda usar `pg` ou Postgres.js, não o driver serverless. A página da Cloudflare sobre Neon diz o mesmo. A página Drizzle + Hyperdrive diz que `pg` é "the recommended driver for Drizzle ORM with Hyperdrive" e que Drizzle + Postgres.js via Hyperdrive "is not currently supported". Com `pg`, transações interativas funcionam. No driver serverless em HTTP (`neon-http`) elas não existem: lá só há transações não interativas.
- **Fontes:** [Neon: Cloudflare Workers](https://neon.com/docs/guides/cloudflare-workers) (sem data); [Hyperdrive + Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/) (2026-04-21); [Hyperdrive + Drizzle](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/) (2026-10-01); [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver); [Drizzle connect-neon](https://orm.drizzle.team/docs/connect-neon).
- **Impacto e tensão:** Hyperdrive limita configs a **10 por conta no Free e 25 no Paid** ([limits](https://developers.cloudflare.com/hyperdrive/platform/limits/), 2026-06-09) e 100k queries/dia no Free ([pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), 2026-06-18). Uma config Hyperdrive por branch Neon por PR esgota isso depressa com issues rodando em paralelo. Saída possível, a validar no ticket 05: o **mesmo `pg`** conecta direto por TCP ao Neon, sem Hyperdrive. A Cloudflare documenta `pg` ≥ 8.16.3 direto por TCP no Workers ([Postgres tutorial](https://developers.cloudflare.com/workers/tutorials/postgres/), 2026-10-12). Assim, previews usariam um secret `DATABASE_URL` apontando para a branch Neon, e a produção usaria `env.HYPERDRIVE.connectionString`, com o mesmo código e o mesmo driver. O cliente deve ser criado por request. Com `nodejs_compat` (automático a partir de compatibility_date 2026-08-04).
- **Alternativa se o usuário preferir não usar Hyperdrive:** `@neondatabase/serverless` em HTTP (`drizzle-orm/neon-http`). É mais simples (só um secret) e o Neon o chama de "the fastest option for single queries", mas não tem transação interativa. Se a transação interativa for necessária (ex.: criar a Company e o membro owner com lógica entre os passos), seria preciso usar WebSocket `Pool`, que tem de ser aberto e fechado dentro do mesmo request.

### T4. Drizzle 0.45 (estável) ↔ Drizzle v1 RC (decisão aberta; recomendo v1 RC com versão exata, com ressalva)
- **Fatos:** `drizzle-orm` `latest` = **0.45.4** (2026-10-08) e `drizzle-kit` `latest` = **0.31.11** (2026-09-21). A v1 está em `rc` = **1.0.0-rc.4** (2026-06-27), e a primeira RC é de 2026-04-30. A documentação já ensina a v1: a página de upgrade instala com `@rc` e mostra "v1.0 98%". As mudanças da v1 incluem um formato novo da pasta de migrations (sem `journal.json`, uma pasta por migration, convertido com `drizzle-kit up`), Relational Queries v2 e `drizzle-orm/zod` embutido (export `./zod` presente no pacote rc.4). O `better-auth` 1.7.10 aceita as duas linhas (`^0.45.2 || >=1.0.0-rc.1 <2.0.0`).
- **Por que v1 RC:** um template novo e público evita migrar formato de migrations e API de relações logo depois. Os agentes que lerem a doc oficial vão escrever código v1.
- **Por que 0.45:** é o estável e ainda recebe patches. A v1 está sem RC nova há quase 4 meses (rc.4 em junho; existe só uma tag canary `rc5`), e não há data para a versão estável.
- **Fontes:** npm dist-tags (2026-10-17); [releases drizzle-orm](https://github.com/drizzle-team/drizzle-orm/releases); [Upgrade to v1](https://orm.drizzle.team/docs/upgrade-v1); [Migrations](https://orm.drizzle.team/docs/migrations).
- **Impacto:** se ficar em 0.45, o `AGENTS.md` precisa avisar os agentes de que a doc pública ensina v1.

### T5. shadcn/ui sobre Radix → shadcn/ui sobre Base UI (recomendo aceitar o padrão)
- **Por quê:** "Starting today, Base UI is the default component library in shadcn/ui". Radix "is not being deprecated" e quem quiser continuar nele usa `shadcn init -b radix`. Scripts não interativos precisam passar `-b` explicitamente.
- **Fonte:** [changelog julho 2026 – Base UI as the Default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default).
- **Impacto:** nenhum código existe ainda. A escolha precisa ficar fixa no bootstrap e no `components.json`.

### T6. `@react-email/components` → pacote único `react-email` (troca obrigatória, não opcional)
- **Por quê:** o npm marca `@react-email/components` (última versão 1.0.12, 2026-04-09) como "Package no longer supported". A doc atual importa `render` de `react-email` (`import { render } from 'react-email'`), versão **6.11.3** (2026-10-16).
- **Fontes:** `npm view @react-email/components deprecated`; [React Email render](https://react.email/docs/utilities/render).

### T7. (Adição, não troca) Roteador do front: a stack não define um
- A stack pedida não cita roteador para a SPA. O Vite plugin da Cloudflare lista TanStack Start e React Router v8 como frameworks oficialmente suportados ([Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)). Para uma SPA pura qualquer roteador client-side funciona. Recomendo **TanStack Router** (`@tanstack/react-router` 1.170.45) pela coerência com Query e Form. Isso é inferência minha, não está escrito em nenhuma fonte oficial. A alternativa é React Router 8.4.0.

### Trocas avaliadas e **não** recomendadas agora
- **Wrangler → CLI `cf`:** `cf` foi lançado em beta em 2026-09-28 (`cf@1.0.0-beta.18`). Quando o beta acabar, sai uma última versão major do Wrangler que direciona para o `cf`, e o Wrangler recebe manutenção por **18 meses** depois disso ([blog](https://blog.cloudflare.com/cloudflare-cf-cli-launch/), [changelog](https://developers.cloudflare.com/changelog/post/2026-09-28-cloudflare-cli-beta/)). O guia de GitHub Actions ainda usa só `wrangler-action@v4` ([GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), 2026-09-18). Fica Wrangler, e a troca é revista quando o `cf` sair do beta.
- **Kubb → Hono RPC (`hc`):** elimina o codegen, mas a doc do Hono admite que "the more routes you have, the slower your IDE will become", exige `strict` e versões de Hono iguais, e não gera Zod nem MSW a partir do OpenAPI ([Hono RPC](https://hono.dev/docs/guides/rpc)). Como o OpenAPI é requisito e o ticket 08 usa MSW gerado, fica Kubb.
- **Kubb → Orval / Hey API:** Orval 8.43.0 (2026-10-14) gera React Query + Zod + MSW, mas a home não confirma Zod 4 nem OpenAPI 3.1 ([orval.dev](https://orval.dev/)). `@hey-api/openapi-ts` está em 0.99.0 (2026-06-22, pré-1.0). Nenhum dos dois tem vantagem documentada sobre o Kubb v5.
- **Swagger UI → Scalar:** `@scalar/hono-api-reference` é publicado pela Scalar, não pelo Hono. Swagger UI tem middleware oficial do Hono. Fica Swagger UI.
- **Resend → Cloudflare Email Service:** o envio está em "Email Sending Beta" e exige Workers Paid para destinatários arbitrários ([Email Service](https://developers.cloudflare.com/email-service/), 2026-10-15). Fica Resend.
- **Turborepo → `pnpm pipeline`:** o pnpm 12.4+ tem um task runner com cache próprio, mas a doc diz "experimental: Its configuration and output may change" ([pnpm pipeline](https://pnpm.io/cli/pipeline)). Fica Turborepo, que também é o que `shadcn init --monorepo` gera.
- **Hono 4 → Hono 5:** `hono@next` = 5.0.0-rc.1 (2026-10-10), ESM-only e com breaking changes (`c.req.json()` retorna `unknown`, `query()` pode retornar `undefined` etc.) ([Migrating to v5](https://hono.dev/docs/guides/migrating-to-v5)). Começar em 4.13.x e migrar quando sair a versão estável.

## Achados por peça

### (a) Front: Cloudflare Workers + Static Assets + Vite plugin
| Pacote | Versão | Data |
|---|---|---|
| `wrangler` | 4.151.1 | 2026-10-16 |
| `@cloudflare/vite-plugin` | 1.64.0 (peer: `vite ^6.1 \|\| ^7 \|\| ^8`, `wrangler ^4.151.0`) | 2026-10-14 |
| `vite` | 8.3.4 | 2026-10-08 |
| `@vitejs/plugin-react` | 6.1.2 (peer `vite ^8`) | — |
| `react` | 19.3.1 | 2026-10-14 |
| `cloudflare/wrangler-action` | v4.1.3 | 2026-09-24 |
| `cf` (CLI) | 1.0.0-beta.18 | beta desde 2026-09-28 |

- O Vite plugin roda o Worker dentro do `workerd` em dev, com bindings locais e HMR. `vite build` gera `dist/client` e um `wrangler.json` de saída usado por preview e deploy ([React guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)). Ele suporta "single-page applications, with or without an integrated backend API" ([Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)). O blog do `cf` diz que "The Cloudflare Vite Plugin is the recommended way we suggest you build Workers".
- O peer de `@cloudflare/vite-plugin` 1.64.0 exige `wrangler ^4.151.0`. Os dois precisam subir de versão juntos (vale para o Renovate e para os agentes).
- **Preview por PR:** os "Version URLs" (antigos preview URLs, `wrangler versions upload --preview-alias`) não são indicados para PR. A doc diz "For isolated branch or pull request testing, use Previews" ([Version URLs](https://developers.cloudflare.com/workers/configuration/previews/), 2026-09-22). O **Worker Previews** (`wrangler preview`, `wrangler preview delete --name`) tem vars, secrets e bindings próprios (bloco `previews` no wrangler config), DO isolado, URL `<preview>-<worker>.<subdomain>.workers.dev` ou em domínio custom, e limite de 100 previews/Worker no Free e 500 no Paid. A página não diz se o recurso está em beta, e fontes secundárias dizem que sim ([Worker Previews](https://developers.cloudflare.com/workers/previews/), 2026-09-24). Detalhes ficam no ticket 05.
- **Deploy por Actions:** `cloudflare/wrangler-action@v4` com secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers") e `CLOUDFLARE_ACCOUNT_ID`. A página não cobre PR nem preview ([GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)).

### (b) Kubb v5 → hooks TanStack Query + schemas Zod
| Pacote | Versão | Data |
|---|---|---|
| `kubb` / `@kubb/core` / `@kubb/cli` | 5.11.0 | 2026-10-16 |
| `@kubb/plugin-react-query` | 5.5.3 (peer `@tanstack/react-query ^5.82`) | 2026-10-15 |
| `@kubb/plugin-zod` | 5.4.12 (peer `zod ^4`) | 2026-10-15 |
| `@kubb/plugin-oas` | 4.39.3, **substituído na v5 por `@kubb/adapter-oas`** | 2026-08-04 |

- O Kubb 5.0 saiu em 2026-08-20 e foi reescrito em torno de um adapter, uma AST e parsers. O config vem de `kubb/config`. O cliente gerado recebe um objeto `{ body, path, query, headers }` e retorna `RequestResult` com `throwOnError: true` por padrão. Exige Node ≥ 22 (a migração fala em 22.12) ([blog v5](https://kubb.dev/blog/v5.md), [migration](https://kubb.dev/docs/5.x/how-to/migration.md)).
- `plugin-react-query` não traz cliente HTTP. Ele precisa de `@kubb/plugin-ts` e de `@kubb/plugin-fetch` ou `@kubb/plugin-axios`, e com `hooks: true` gera `useQuery`/`useMutation` além de `queryOptions`. A validação Zod é configurada no plugin cliente ([plugin-react-query](https://kubb.dev/extensions/kubb-labs/plugin-react-query.md)).
- `plugin-zod` gera **Zod v4**. A opção `compile` exige zod ≥ 4.5 e `typeGuards` exige ≥ 4.6 ([plugin-zod](https://kubb.dev/extensions/kubb-labs/plugin-zod.md)).
- A doc do `adapter-oas` não informa se suporta OpenAPI 3.1. Ver riscos.

### (c) Hono + `@hono/zod-openapi` + Swagger UI + Zod 4
| Pacote | Versão | Data |
|---|---|---|
| `hono` | 4.13.13 (`next` = 5.0.0-rc.1) | 2026-10-04 |
| `@hono/zod-openapi` | 1.6.3 (peer **`zod ^4.0.0`**, `hono >=4.10.0`; usa `@asteasolutions/zod-to-openapi ^9.1.0`) | 2026-09-04 |
| `@hono/swagger-ui` | 0.6.1 (peer `hono >=4`) | 2026-03-11 |
| `@hono/zod-validator` | 0.9.1 (peer `zod ^3.25 \|\| ^4`) | 2026-08-31 |
| `zod` | 4.6.7 | 2026-10-12 |

- A pergunta sobre Zod 4 está respondida: `@hono/zod-openapi` 1.x **exige** Zod 4 (peer `^4.0.0`, via npm). `z` deve ser importado de `@hono/zod-openapi`. `app.doc()` gera OpenAPI 3.0, e `app.doc31()`/`getOpenAPI31Document()` geram 3.1 ([README zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)).
- Pegadinhas documentadas: o corpo da requisição é opcional por padrão (`required: false`), headers precisam estar em minúsculas, `.get()/.post()` retornam o tipo `Hono` e não `OpenAPIHono`, o status deve sempre ser passado para `c.json`, e cadeias longas de `.openapi()` deixam o type-check lento (dividir em sub-apps e usar `.route()`).
- Swagger UI: `app.get('/ui', swaggerUI({ url: '/doc' }))` ([Hono Swagger UI](https://hono.dev/examples/swagger-ui)). Com T2, `/api/doc` e `/api/ui` ficam sob `run_worker_first`.
- Zod 4 fica na raiz `zod`, Zod 3 em `zod/v3` e mini em `zod/mini` ([Zod versioning](https://zod.dev/v4/versioning)).

### (d) Drizzle + Neon no Workers
| Pacote | Versão | Data |
|---|---|---|
| `drizzle-orm` | 0.45.4 (`rc` = 1.0.0-rc.4, 2026-06-27) | 2026-10-08 |
| `drizzle-kit` | 0.31.11 (`rc` = 1.0.0-rc.4) | 2026-09-21 |
| `@neondatabase/serverless` | 1.2.0 | 2026-10-01 |
| `pg` | 8.23.1 (mínimo documentado para Workers: 8.16.3) | 2026-09-30 |
| `drizzle-zod` | 0.8.3 (peer `zod ^3.25 \|\| ^4`); na v1 vira `drizzle-orm/zod` | 2025-08-06 |
| `neondatabase/create-branch-action` | v6 (6.3.1) | 2026-03-31 |
| `neondatabase/delete-branch-action` | v3 (3.2.1) | 2026-03-31 |

- **HTTP x WebSocket x Hyperdrive.** Segundo o Neon: "Use the driver over HTTP by default", e WebSocket só para transação interativa, sessão ou compatibilidade com `pg`. No edge, "Pool or Client objects must be connected, used and closed within a single request handler" ([Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)). Para Workers, porém, Neon e Cloudflare recomendam Hyperdrive + `pg`/Postgres.js com a connection string **sem pooling** ([Neon CF Workers](https://neon.com/docs/guides/cloudflare-workers), [Hyperdrive + Neon](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/)). A página Drizzle + Hyperdrive restringe a `pg` ([Hyperdrive + Drizzle](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/)). Há uma contradição entre as fontes: a página do Neon aceita Postgres.js, e a da Cloudflare diz que Drizzle + Postgres.js via Hyperdrive não é suportado. Vale a da Cloudflare, que é dona do Hyperdrive.
- **Dev local com Hyperdrive:** `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>` ou `localConnectionString`. Localmente o Hyperdrive é contornado (sem pool nem cache) ([Hyperdrive local dev](https://developers.cloudflare.com/hyperdrive/configuration/local-development/), 2026-04-21). A página não fala do Vite plugin.
- **Migrations:** `drizzle-kit generate` + `drizzle-kit migrate` usando uma `DATABASE_URL` **direta** (não Hyperdrive) ([Hyperdrive + Drizzle](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/)). A doc do Drizzle descreve `push` ("best approach for rapid prototyping"), `generate`+`migrate` e migrate em runtime ([Migrations](https://orm.drizzle.team/docs/migrations)). Para CI com branch Neon por PR, `generate` (commitado) + `migrate` no job é o fluxo mais auditável. Isso é recomendação minha.
- **Branch Neon por PR:** `create-branch-action@v6` devolve `db_url` e `db_url_pooled`, e `delete-branch-action@v3` remove a branch ([Neon branching + Actions](https://neon.com/docs/guides/branching-github-actions), [README create-branch-action](https://github.com/neondatabase/create-branch-action)). O fluxo completo fica no ticket 05.
- O template oficial `react-postgres-fullstack-template` da Cloudflare usa Hyperdrive + Hono + React + Vite plugin ([cloudflare/templates](https://github.com/cloudflare/templates/tree/main/react-postgres-fullstack-template)).

### (e) Resend + React Email no Workers
| Pacote | Versão | Data |
|---|---|---|
| `resend` | 6.34.1 (peer `@react-email/render *`) | 2026-10-16 |
| `react-email` | 6.11.3 (peer `react ^18 \|\| ^19`) | 2026-10-16 |
| `@react-email/render` | 2.1.1 | 2026-10-16 |
| `@react-email/components` | 1.0.12, **descontinuado** | 2026-04-09 |

- O guia do Resend para Workers instala `resend`, usa `.tsx` e passa `react: <Template/>` ([Send with Cloudflare Workers](https://resend.com/docs/send-with-cloudflare-workers)). O exemplo oficial usa `compatibility_flags = ["nodejs_compat"]` ([resend-cloudflare-workers-example](https://github.com/resend/resend-cloudflare-workers-example), push em 2026-10-17).
- Há uma contradição. A referência da API diz que o parâmetro `react` é "Only available in the Node.js SDK" ([Send email API](https://resend.com/docs/api-reference/emails/send-email)), mas o guia oficial de Workers usa `react`. Para não depender disso, o mais seguro é renderizar com `await render(<T/>)` de `react-email` e mandar `html` (+ `text` via `toPlainText`) ([render](https://react.email/docs/utilities/render)). A página de `render` não fala de Workers nem do edge.
- O Resend suporta o header `Idempotency-Key` (24 h, até 256 caracteres), útil para retries de convite. O limite padrão é de 10 req/s por time. Endereços de teste `delivered@`/`bounced@resend.dev` ([Send email API](https://resend.com/docs/api-reference/emails/send-email)).

### (f) shadcn/ui + TanStack Query + TanStack Form com Vite/React 19
| Pacote | Versão | Data |
|---|---|---|
| `shadcn` (CLI) | 4.22.0 | 2026-10-16 |
| `tailwindcss` | 4.3.3 | 2026-07-16 |
| `@tanstack/react-query` | 5.104.3 (peer `react ^18 \|\| ^19`) | 2026-10-15 |
| `@tanstack/react-form` | 1.33.5 (peer `react ^17–^19`; `alpha` = 2.0.0-alpha.2) | 2026-08-11 |
| `@tanstack/zod-form-adapter` | 0.42.1, **parado desde 2025-02-20** | — |

- shadcn com Vite: `pnpm dlx shadcn@latest init -t vite`, com Tailwind via `@tailwindcss/vite` e `@import "tailwindcss"`. Em monorepo: `init -t vite --monorepo`, que gera `apps/web` + `packages/ui` com **Turborepo**, um `components.json` em cada workspace e imports `@workspace/ui/components/*` ([Vite](https://ui.shadcn.com/docs/installation/vite), [Monorepo](https://ui.shadcn.com/docs/monorepo)). Base UI é o padrão (ver T5).
- O shadcn tem guia oficial de **TanStack Form** com os componentes `Field`/`FieldError`, e o schema Zod vai direto em `validators` ([shadcn + TanStack Form](https://ui.shadcn.com/docs/forms/tanstack-form)). Os exemplos dessa página usam Zod v3. A doc do TanStack Form diz que suporta nativamente libs Standard Schema (Zod, Valibot, ArkType), então **não é preciso adapter**. Um schema no nível do form propaga os erros para os campos ([TanStack Form validation](https://tanstack.com/form/latest/docs/framework/react/guides/validation)). O pacote `@tanstack/zod-form-adapter` está parado desde 2025 e não deve ser usado.
- Nenhuma das páginas fala especificamente de React 19. A compatibilidade vem só dos peers no npm.

### (g) Monorepo: pnpm workspaces + Turborepo
| Pacote | Versão | Data |
|---|---|---|
| `pnpm` | 12.14.0 (linhas 10 e 11 ainda recebem patches) | 2026-10-15 |
| `turbo` | 2.11.9 | 2026-10-16 |
| `typescript` | 7.0.2 (`latest`) | — |

- pnpm 12.0.0 (2026-08-26): falha com `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS` quando há chave desconhecida em `pnpm-workspace.yaml` e o projeto fixa a versão do pnpm. Também removeu `--frozen-lockfile false`, e o store vai para `<project>/node_modules/.pnpm-store` em sandboxes de agente sem hardlink para fora do projeto ([release v12.0.0](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)). Isso importa para os runners da Factory.
- `pnpm pipeline` (12.4+, experimental) é um concorrente direto do Turborepo, com cache remoto compatível com a API do Turborepo Remote Cache desde 12.12.0 ([pnpm pipeline](https://pnpm.io/cli/pipeline)). Por ora fica Turborepo.
- Layout sugerido, a ser decidido no ticket de layout do monorepo: `apps/web` (SPA), `apps/api` (Hono) ou um único `apps/app` com Worker + SPA (T2), `packages/ui` (shadcn), `packages/db` (Drizzle schema + migrations), `packages/api-client` (saída do Kubb), `packages/emails` (react-email). No Turborepo, o pipeline precisa da ordem `openapi:generate → kubb → build`.

## Riscos em aberto

1. **Hyperdrive × preview por PR** (T3): o limite de 10/25 configs por conta torna inviável uma config por PR com paralelismo. Usar `pg` direto em previews e Hyperdrive só em produção é uma hipótese plausível, mas falta validar no ticket 05. A página de Worker Previews **não menciona Hyperdrive**.
2. **Hyperdrive no Vite plugin em dev:** nenhuma página consultada diz como o `@cloudflare/vite-plugin` trata o binding Hyperdrive localmente. Validar com um protótipo.
3. **Kubb + OpenAPI 3.1:** a doc do `@kubb/adapter-oas` não declara se suporta 3.1. Enquanto isso não for testado, gerar com `app.doc()` (3.0).
4. **Drizzle v1** (T4): a RC está parada desde junho e não há data para a versão estável. Em qualquer escolha, a doc pública e a versão instalada podem divergir.
5. **Resend `react` no Workers:** a referência da API diz "Node.js only" e o guia de Workers usa `react`. Mitigação: renderizar com `react-email` e enviar `html`. Falta testar o `render` do `react-email` 6 no `workerd`.
6. **Worker Previews é recente** (setembro de 2026) e a página não diz se está em beta. O guia de Actions da Cloudflare não cobre PR nem preview.
7. **Transição Wrangler → `cf`:** quando o beta do `cf` terminar, o Wrangler entra em manutenção por 18 meses. A config muda de `wrangler.jsonc` para `cloudflare.config.ts`, e o template vai precisar migrar algum dia.
8. **Hono 5 e TanStack Form 2** estão em pré-release. Hono 5 já tem guia de migração. Começar nas linhas estáveis (4.13 / 1.33) e fixar as versões.
9. **TypeScript 7.0** é o `latest`. Esta pesquisa não verificou se as ferramentas acima (Kubb, `hcWithType` do Hono, shadcn) funcionam com TS 7. Validar no Skeleton.
10. **Node ≥ 22.12** é exigido pelo Kubb v5 e pelo Hono 5. O runner da Factory e o CI precisam fixar essa versão.
11. Páginas sem data de atualização: Neon (CF Workers, serverless driver, branching), Drizzle (connect-neon), Hono (Swagger UI) e React Email (intro). O conteúdo foi lido em 2026-10-17.
