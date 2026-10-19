# 02: Contrato ponta a ponta até a tela

Spec: [../spec.md](../spec.md)

**What to build:** uma rota Hono declarada com Zod e OpenAPI chega à tela sem código escrito à mão no meio. `pnpm generate` produz a OpenAPI, o cliente e os handlers MSW do Kubb e o `routeTree.gen.ts`, e uma página do `example` mostra o dado da rota pelo hook gerado, no idioma configurado. As quatro camadas de teste existem e passam no `verify`.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `pnpm generate` chama `app.getOpenAPI31Document()` e roda o Kubb; código do Kubb e `openapi.json` fora do git, `routeTree.gen.ts` commitado.
- [ ] TanStack Router (rotas de feature por `physical()`), TanStack Query e shadcn com Base UI (`-b base`). Swagger UI servido pelo Hono.
- [ ] i18n tipado `en`/`pt-BR` no Skeleton, idioma por variável de build, o Product sobrescreve textos por cima; uma chave faltando quebra o `tsc`.
- [ ] Erros da API com código estável + mensagem em inglês; a SPA traduz pelo código.
- [ ] MSW 3.0.x no workspace, com o peer do `@kubb/plugin-msw` liberado no `pnpm-workspace.yaml`.
- [ ] Teste do front no Vitest Browser Mode com os handlers gerados (`parser: 'faker'`, seed fixo), fixture `scope: 'file'`, `resetHandlers` por teste, `onUnhandledFrame: 'error'`, `msw({ mode: 'worker-only' })` (seam 4).
- [ ] Gate de Kubb + `tsc` + um teste com override de handler gerado.
- [ ] E2E Playwright na stack local com a tag `@evidence`, prints num diretório fixo, elementos localizados por role + chave do i18n ou `data-testid` (seam 5).
- [ ] O `verify` roda `pnpm generate` e exige `git diff` vazio (seam 6).
