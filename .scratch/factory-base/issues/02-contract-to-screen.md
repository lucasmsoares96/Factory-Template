# 02: Contrato ponta a ponta até a tela

Spec: [../spec.md](../spec.md)

**What to build:** uma rota Hono declarada com Zod e OpenAPI chega à tela sem código escrito à mão no meio. `pnpm generate` produz a OpenAPI, o cliente e os handlers MSW do Kubb e o `routeTree.gen.ts`, e uma página do `example` mostra o dado da rota pelo hook gerado, no idioma configurado. As quatro camadas de teste existem e passam no `verify`.

**Blocked by:** 01

**Status:** done

- [x] `pnpm generate` chama `app.getOpenAPI31Document()` e roda o Kubb; código do Kubb e `openapi.json` fora do git, `routeTree.gen.ts` commitado.
- [x] TanStack Router (rotas de feature por `physical()`), TanStack Query e shadcn com Base UI (`-b base`). Swagger UI servido pelo Hono.
- [x] i18n tipado `en`/`pt-BR` no Skeleton, idioma por variável de build, o Product sobrescreve textos por cima; uma chave faltando quebra o `tsc`.
- [x] Erros da API com código estável + mensagem em inglês; a SPA traduz pelo código.
- [x] MSW 3.0.x no workspace, com o peer do `@kubb/plugin-msw` liberado no `pnpm-workspace.yaml`.
- [x] Teste do front no Vitest Browser Mode com os handlers gerados (`parser: 'faker'`, seed fixo), fixture `scope: 'file'`, `resetHandlers` por teste, `onUnhandledFrame: 'error'`, `msw({ mode: 'worker-only' })` (seam 4).
- [x] Gate de Kubb + `tsc` + um teste com override de handler gerado.
- [x] E2E Playwright na stack local com a tag `@evidence`, prints num diretório fixo, elementos localizados por role + chave do i18n ou `data-testid` (seam 5).
- [x] O `verify` roda `pnpm generate` e exige `git diff` vazio (seam 6).

## Comments

Implementado em 2026-10-19. Versões conferidas no npm registry (`npm view <pkg> version time`) e nas docs dos pacotes nessa data, fixadas no `catalog`:

| Pacote | Versão | Publicado |
|---|---|---|
| kubb / @kubb/adapter-oas (core, cli) | 5.11.1 | 2026-10-18 |
| @kubb/plugin-ts / -fetch / -react-query | 5.0.14 / 5.7.0 / 5.5.3 | 2026-10-15 / 2026-10-16 / 2026-10-15 |
| @kubb/plugin-faker / -msw / -zod | 5.1.9 / 5.1.3 / 5.4.12 | 2026-10-15 |
| @faker-js/faker | 10.6.0 | 2026-08-14 |
| msw | 3.0.3 | 2026-10-10 |
| @tanstack/react-router / router-plugin / router-generator | 1.170.45 / 1.168.47 / 1.167.45 | 2026-10-16 |
| @tanstack/virtual-file-routes | 1.162.0 | 2026-05-15 |
| @tanstack/react-query | 5.104.4 | 2026-10-17 |
| @hono/swagger-ui | 0.6.1 | 2026-03-11 |
| shadcn (CLI + `shadcn/tailwind.css`) | 4.22.1 | 2026-10-18 |
| @base-ui/react | 1.9.0 | 2026-10-09 |
| cn | 0.5.0 | 2026-10-16 |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 2026-07-16 |
| tw-animate-css / class-variance-authority / lucide-react | 1.4.0 / 0.7.1 / 1.59.0 | — |
| @fontsource-variable/geist | 5.3.0 | 2026-07-19 |
| @vitest/browser-playwright / vitest-browser-react | 5.0.5 / 2.3.0 | 2026-10-15 / 2026-09-04 |
| @playwright/test / playwright | 1.64.1 (Chromium 1248) | 2026-10-14 |

O que ficou:
- `skeleton generate [--product <dir>]` (`src/node/generate.ts`): importa o app do Worker (`src/worker.ts`), grava `openapi.json` com `app.getOpenAPI31Document()`, roda o Kubb pela API (`createKubb().generate()`) em `src/gen/` e o gerador do TanStack Router em `routeTree.gen.ts`. O Skeleton gera o próprio cliente (usado pelas telas dele) e a árvore da SPA de teste (`test/spa/routeTree.gen.ts`); cada Product gera o seu sobre a OpenAPI composta. `src/gen/` e `openapi.json` no `.gitignore`; as `routeTree.gen.ts` commitadas.
- Rotas: `rootRoute(<skeleton>/client/root.tsx, [physical(<skeleton>/features/home/routes), ...rotas do Product])` (`src/vite/router.ts`), a mesma config no `generate` e no plugin do Vite.
- `@workspace/skeleton/vite`: `skeleton({ dir, routes? })` com TanStack Router, React, Tailwind e Cloudflare, e o `LOCALE` validado. O `vite.config.ts` do Product tem uma linha.
- `@workspace/skeleton/client`: `mountSpa({ routeTree, messages })`, `createSpa`, `useMessages`, `useErrorMessage`. QueryClient sem retry quando a API respondeu com `code`.
- shadcn: `components.json` no Skeleton (`base-nova`, aliases `#ui`/`#lib`/`#components`/`#hooks` pelo `imports` do `package.json`), `card`, `alert`, `button`, CSS do `init`. O `shadcn add` funciona com esses aliases (testado).
- i18n: `src/i18n/{en,pt-BR}.ts`, `Messages = typeof en`, `errors` com uma chave por `ErrorCode` (`satisfies`). `defineMessages()` no Product (`apps/example/src/client/messages.ts`). `test/i18n.types.ts` com `@ts-expect-error` prova que chave faltando, código de erro faltando, chave inventada e locale desconhecido quebram o `tsc`. `LOCALE=fr pnpm build` falha.
- Erros: `{ code, message }` (`platform/error-codes.ts`, sem imports para entrar no bundle da SPA), `createRouter()` (400 `VALIDATION_FAILED`), 404 `NOT_FOUND`, 500 `INTERNAL_ERROR`; o 503 do health virou `{ code: "DATABASE_UNAVAILABLE", message }`.
- Swagger UI em `/api/docs`, documento em `/api/openapi.json` (rotas simples, fora do documento).
- Testes: seam 3 `test/api-contract.test.ts` (documento, Swagger UI, 404); seam 4 `test/browser/home.browser.test.tsx` (projeto `browser` do Vitest; o segundo teste sobrescreve `getHealthHandler` com o `getHealthHandlerResponse503` gerado e confere o texto pt-BR); seam 5 `packages/skeleton/e2e/` (`defineE2EConfig`, fixtures `t` e `evidence(name)`, que exige a tag `@evidence`; global setup sobe o build de produção no `createTestHarness()` sobre Postgres migrado), rodado pelo `e2e` do `example` (`playwright.config.ts` de uma linha); seam 6 `filesChangedBy()` no `verify` (`test/generated-drift.test.ts`).
- `TURBO_FORCE=1 pnpm factory:verify` verde (12 tasks). Com uma `routeTree.gen.ts` editada, falha e lista o arquivo.

Desvios e decisões:
- Kubb 5: `@kubb/adapter-oas` (padrão do `createKubb`) no lugar do `@kubb/plugin-oas` v4, e `@kubb/plugin-fetch` como cliente do `plugin-react-query` (`returnType: 'data'`). `@kubb/plugin-zod` está no catalog, mas sem uso por enquanto (validação de resposta fica para quando houver body de request).
- `@kubb/plugin-msw` 5.1.3 ainda declara `msw ^2` (kubb-labs/plugins#1049 aberta): `peerDependencyRules.allowedVersions: { "@kubb/plugin-msw>msw": "3" }`. O handler gerado sem `data` sorteia entre os corpos de 200 e 503 (sempre com status 200); com a seed 42 sai o `ok`. Os testes que dependem de erro sobrescrevem o handler.
- shadcn: o `init -t vite -b base -p nova` foi rodado num diretório temporário e o resultado copiado para o Skeleton (o `init` cria um app Vite e um alias `@/`, que quebraria quando o Vite do Product compila arquivos do Skeleton). O shadcn 4.22 troca `clsx` + `tailwind-merge` pelo pacote `cn`.
- Idioma pela variável de build `LOCALE` (não `VITE_LOCALE`): o plugin do Skeleton valida e injeta `import.meta.env.LOCALE`; o Playwright usa o mesmo `LOCALE`. `LOCALE` entrou no `globalEnv` do Turborepo.
- `createApp()` agora pede `{ title }` (título do documento OpenAPI).
- Prints em `<repo>/test-results/evidence/<product>/<nome>.png` (constante `EVIDENCE_DIR` no Skeleton, igual ao `evidenceDir` do `.factory/src/config.ts`); `outputs` do `e2e` no Turborepo cobre a pasta.
- Seam 6: o `verify` compara o estado do `git status` antes e depois do `turbo run generate`. Num checkout limpo (CI, Factory) é o mesmo que `git diff` vazio; localmente, edições que o `generate` não toca não contam.
- Textos de features do Product (`messages.ts` por feature) e códigos de erro próprios do Product ficam para o ticket 07, quando entra a interface `Feature`.
- pnpm 12 acrescentou `minimumReleaseAgeExclude` para o kubb 5.11.1 (e pacotes `@kubb/*` da mesma versão) e o shadcn 4.22.1, publicados há menos de um dia; dá para tirar a partir de 2026-10-20.
