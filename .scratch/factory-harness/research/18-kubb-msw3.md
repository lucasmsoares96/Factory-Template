# Pesquisa 18: Kubb + MSW 3

Ticket: [18-kubb-msw3](../issues/18-kubb-msw3.md) · Pesquisado em 2026-10-17 · Só fontes primárias:
- registry do npm (`npm view … peerDependencies peerDependenciesMeta dist-tags time`, consultado em 2026-10-17);
- tarballs `msw@3.0.3`, `msw@2.15.0` e `@kubb/plugin-msw@5.1.3`;
- issues, PRs e `package.json` de `kubb-labs/plugins` (é lá que o `@kubb/plugin-msw` vive hoje, em `packages/plugin-msw`, e não em `kubb-labs/kubb`);
- releases e issues de `mswjs/msw`, o fonte das docs em `mswjs/mswjs.io` e o blog do MSW 3;
- docs do Vitest e do pnpm.

Quando a conclusão vem de um experimento local, e não de documentação, isso aparece como **(teste)**.

Versões consultadas: `msw` **3.0.3** (2026-10-10; 3.0.0 em 2026-09-28; a última da linha 2 é 2.15.0, de 2026-07-08). `@msw/cloudflare` **0.2.0** (2026-09-28). `kubb` **5.11.0**. `@kubb/plugin-msw` **5.1.3** (2026-10-15) e canary `5.2.0-canary.20261016T150304`. `@kubb/plugin-faker` 5.1.9. `@kubb/plugin-ts` 5.0.14. `vitest` / `@vitest/browser-playwright` **5.0.5**. Playwright 1.64.1. TypeScript 6.0.3. pnpm 10.28.1 local (a `latest` no npm é 12.14.0).

## Resposta

**1. Funciona com MSW 3. Nenhuma versão do Kubb declara `msw ^3`.**
- O código gerado pelo `@kubb/plugin-msw` 5.1.3 importa só `http` e `type HttpResponseResolver` da raiz `'msw'`, e responde com `new Response(...)` nativo.
- O MSW 3 mantém esses exports na raiz por compatibilidade, e **só vai tirá-los no próximo major (v4)**.
- **(teste)** Gerei handlers com `parser: 'faker'` e `handlers: true` e instalei `msw@3.0.3`. O `tsc --strict` passou, e 10 testes passaram em Vitest 5 Browser Mode (Chromium). Os testes cobriram:
  - dado do faker;
  - override com dado;
  - override com resolver usando `HttpResponse` de `msw/http`;
  - helper de 422;
  - DELETE 204.
- O peer `msw ^2.0.0` continua igual no stable 5.1.3, no canary de 2026-10-16 e no `main`.
- Existe a issue **aberta** [kubb-labs/plugins#1049](https://github.com/kubb-labs/plugins/issues/1049) ("upgrade msw from 2 to 3", aberta pelo mantenedor em 2026-10-08). Ela não tem PR.

**2. Breaking changes do MSW 3 que pesam aqui:**
- **Nenhuma quebra o código gerado.** Os imports da raiz continuam valendo, `Response` é padrão web e a assinatura `http.<método><Params, Body>(path, resolver)` é a mesma.
- **O que quebra é o código de teste em volta:**
  - `onUnhandledRequest` virou `onUnhandledFrame`;
  - `worker.stop()` agora devolve uma Promise;
  - e o mais grave: **`worker.start()` chamado de novo agora lança exceção**, quando no MSW 2 só avisava. **(teste)** A receita oficial "Vitest Browser Mode" do MSW 3 chama `worker.start()` num fixture por teste e, com 3.0.3, quebra a partir do 2º teste de cada arquivo.
  - O fixture da pesquisa 08 tem o mesmo problema. A correção é um fixture com `scope: 'file'` (testado).
  - Além disso, o `mockServiceWorker.js` deve vir do plugin `msw/vite` (`mode: 'worker-only'`), e não de uma cópia em `public/`, que iria parar nos Static Assets de produção.

**3. Duas versões convivem no pnpm, mas não vale a pena.**
- **(teste)** Num workspace pnpm com `web` em `msw@2.15.0` e `api` em `msw@3.0.3`, o pnpm cria variantes separadas de `vitest` e `@vitest/mocker` por versão do MSW. O `@vitest/mocker` aceita `msw ^2.4.9 || ^3.0.0` como peer opcional, e cada app resolve o seu MSW.
- Só que essa convivência exige SPA e API em **pacotes separados**. A decisão 13 é um único Worker (SPA + Hono), então, se for um pacote só, só cabe uma versão.
- Também deixaria a stack com duas APIs do MSW, e a linha 2 está parada desde julho.
- O override seguro é o inverso: **MSW 3 em todo o workspace**, mais `peerDependencyRules.allowedVersions: { "@kubb/plugin-msw>msw": "3" }`. O peer do Kubb é opcional e só gera aviso (o `strictPeerDependencies` é `false` por padrão).

## Recomendação para a parte de testes da spec do Skeleton

1. **Uma versão só: `msw` 3.0.x** (pinado via catalog do pnpm) no front e no back. No back: `msw/node` com o `createTestHarness`, e `@msw/cloudflare` 0.2.0 nos unit tests com `cloudflareTest()`.
2. **`@kubb/plugin-msw` 5.1.x** com `parser: 'faker'` e `handlers: true`. Em `pnpm-workspace.yaml`:
   ```yaml
   peerDependencyRules:
     allowedVersions:
       "@kubb/plugin-msw>msw": "3"
   ```
   Isso silencia só esse peer, só nesse pacote. Não use `allowAny` nem `strictPeerDependencies: false` global.
3. **Código de teste escrito à mão importa das entrypoints do MSW 3:**
   - `http`, `HttpResponse` → `msw/http`;
   - `delay` → `msw/utils/delay`;
   - `setupWorker` → `msw/browser`;
   - `setupServer` → `msw/node`.

   Use sempre `onUnhandledFrame: 'error'`. O código gerado fica como o Kubb emite: `from 'msw'` na raiz vale até o MSW 4.
4. **Fixture do Browser Mode** (substitui o da pesquisa 08), com a sintaxe builder do Vitest ≥ 4.1:
   ```ts
   // apps/web/test/test.ts
   import { test as base } from 'vitest'
   import { setupWorker } from 'msw/browser'
   import { handlers } from '../src/gen/handlers/handlers'

   export const test = base
     .extend('worker', { scope: 'file', auto: true }, async () => {
       const worker = setupWorker(...handlers)
       await worker.start({ onUnhandledFrame: 'error', quiet: true })
       return worker
     })
     .extend('resetMsw', { auto: true }, async ({ worker }, { onCleanup }) => {
       onCleanup(() => worker.resetHandlers())
     })
   ```
   No `vitest.config.ts` do front, acrescente `plugins: [msw({ mode: 'worker-only' })]` (de `msw/vite`), sem `msw init public/`.
5. **Node usa URL absoluta.** Os handlers gerados usam caminho relativo (`'/companies'`). No browser isso casa com a origem da página. Em Node, eles **não** casam com `http://localhost:8787/companies` **(teste)**. Se algum teste em Node usar os handlers do Kubb, configure `baseURL` no `pluginMsw`. Para o Skeleton isso não importa: em Node só se mocka o Resend, com handler escrito à mão.
6. **Um item de gate no Skeleton:** o `kubb generate` + o `tsc` + um teste de Browser Mode com o handler gerado sobrescrito (`worker.use(xHandler(...))`) precisam passar no CI. É o que denuncia uma quebra quando o Kubb resolver a #1049 ou quando o MSW 4 sair.

## Achados detalhados

### A. Kubb (`@kubb/plugin-msw`)

- **A1. O peer continua `msw ^2.0.0`, e é opcional.**
  - `npm view @kubb/plugin-msw@5.1.3 peerDependencies` → `{ msw: '^2.0.0', kubb: '^5.10.3' }`; `peerDependenciesMeta` → `{ msw: { optional: true } }`.
  - O canary `5.2.0-canary.20261016T150304` (2026-10-16) declara o mesmo.
  - No `main`, o [`packages/plugin-msw/package.json`](https://github.com/kubb-labs/plugins/blob/main/packages/plugin-msw/package.json) tem devDependency `msw ^2.15.0` e peer `^2.0.0` (lido em 2026-10-17).
  - O repositório do pacote é `kubb-labs/plugins` (`repository.directory = packages/plugin-msw`).
- **A2. A doc manda "Install `msw` v2".** O texto está no `docs/overview.md` do tarball 5.1.3, que é o mesmo de [kubb.dev/extensions/kubb-labs/plugin-msw](https://kubb.dev/extensions/kubb-labs/plugin-msw): "Install `msw` v2 in the app that uses the generated code." O `kubb-extension.json` declara compatibilidade só com `kubb >=5.8.3` e `node >=22.12`, sem nada sobre o MSW.
- **A3. Issue aberta e nenhum PR.**
  - A [kubb-labs/plugins#1049](https://github.com/kubb-labs/plugins/issues/1049) "chore(deps): upgrade msw from 2 to 3" foi aberta por Stijn Van Hulle (mantenedor) em 2026-10-08 e continua aberta. O plano descrito nela: "Updating the `msw` version in `packages/plugin-msw` and the examples", "Checking the generated handler output against the msw 3 API and updating snapshots" e "Checking `@mswjs/http-middleware` compatibility". A atualização de dependências da #1048 deixou o msw em 2.15.0 "on purpose".
  - Há um comentário (Ericlm, 2026-10-09) pedindo para gerar `HttpResponse` em vez de `Response`.
  - Nenhum PR com "msw" no título depois de 2026-09-27 trata do upgrade. Os PRs recentes são #992, #1082 (correções) e #1020 (base URL em runtime, aberto).
- **A4. O que o gerador emite** (fonte: `dist/index.js` do 5.1.3, componentes `Mock`/`Response` e `mswGenerator`; conferido também nos arquivos gerados **(teste)**):
  - `import { http } from 'msw'` e `import type { HttpResponseResolver } from 'msw'`;
  - `http.<método><Record<string, string>, Body>('<path>', function handler(info) { if (typeof data === 'function') return data(info); return new Response(JSON.stringify(data ?? createXResponse(data)), { status, headers }) })`;
  - helpers `xHandlerResponse<status>(data)` para cada resposta declarada;
  - um `handlers.ts` com `export const handlers = [aHandler(), bHandler(), …] as const`.

  O plugin, ele mesmo, **não importa `msw`**. Só importa `kubb/kit`, `kubb/jsx`, `@kubb/plugin-faker` e `@kubb/plugin-ts`. O peer só descreve o alvo do código gerado.
- **A5. Issues abertas do plugin que afetam testes:** [#1019](https://github.com/kubb-labs/plugins/issues/1019) e o PR [#1020](https://github.com/kubb-labs/plugins/pull/1020): o `baseURL` é fixado na geração e não pode ser resolvido em runtime, e o parser `faker` usa aspas simples onde o `data` usa template literal. Para o browser, com caminho relativo, isso não importa.

### B. MSW 3

- **B1. Breaking changes** ([Release v3.0.0](https://github.com/mswjs/msw/releases/tag/v3.0.0), 2026-09-28):
  - ESM-only;
  - Node ≥ 22 (o `engines` do 3.0.3 diz `>=22.12.0`);
  - TypeScript ≥ 5.9;
  - `worker.stop()` devolve Promise;
  - `graphql` em `msw/graphql`;
  - `handleRequest()` removido;
  - cookies não são mais geridos em Node;
  - `connection` → `websocket:connection`;
  - **`onUnhandledRequest` → `onUnhandledFrame`**;
  - o `setTimeout` não é mais patcheado (fake timers precisam avançar);
  - `request.headers.get('cookie')` devolve `null`.

  Novidades: `msw/utils`, o plugin `msw/vite` e a interceptação no nível de socket em Node.
- **B2. Entrypoints.** O [guia de migração 2→3](https://mswjs.io/docs/migrations/2.x-to-3.x) (atualizado em 2026-09-30) tem uma tabela: `http`, `HttpResponse` → `msw/http`; `delay` → `msw/utils/delay`; `bypass` e `passthrough` → `msw/utils/*`. "`setupWorker`/`setupServer` are still exported from `msw/browser` and `msw/node`". O guia não diz que a raiz continua exportando.
- **B3. Mas a raiz continua exportando.** O [blog "Introducing MSW 3.0"](https://mswjs.io/blog/introducing-msw-3.0) (2026-09-30) diz: "We are keeping root-level `msw` exports intact for backward-compatibility" e que vão "refactor them not to include anything you can import from designated entrypoints in the next major release". Confirmado no tarball: o `lib/core/index.d.ts` do `msw@3.0.3` (alvo de `exports["."]`) exporta `http`, `HttpResponse`, `HttpResponseResolver`, `delay`, `passthrough`, `bypass` e outros, sem `@deprecated`.
- **B4. O `msw/http` não existe na linha 2.** O `exports` do `msw@2.15.0` traz `.`, `./browser`, `./node`, `./native`, `./core/http` e outros, mas não `./http`. Ou seja: se o Kubb passar a gerar `from 'msw/http'` para fechar a #1049, o código gerado vai **exigir** MSW 3. É provável que o upgrade venha como peer `^3`.
- **B5. Um `worker.start()` repetido agora lança exceção.**
  - No 3.0.3 (`src/browser/setup-worker.ts`): `invariant(network.readyState === NetworkReadyState.DISABLED, 'Failed to call "worker.start()": the worker is already started. …')`.
  - No 2.15.0, o mesmo caso só fazia `devUtils.warn('Found a redundant "worker.start()" call…')` e `return`.
  - O `enable()` do `defineNetwork` tem o mesmo invariant. O `network` do `virtual:msw` só tolera `enable()` repetido porque embrulha a chamada quando existe `import.meta.hot` (`src/vite/runtime.ts`).
- **B6. A receita oficial do Vitest Browser Mode quebra com MSW 3 (teste).**
  - A página [Vitest](https://mswjs.io/docs/recipes/vitest-browser-mode) (fonte em [`src/content/guides/integrations/vitest.md`](https://github.com/mswjs/mswjs.io/blob/main/src/content/guides/integrations/vitest.md), commit "new site for msw 3.0 release", 2026-09-30) usa um fixture `test.extend` com `await worker.start()` por teste, `auto: true`, e recomenda pular o `worker.stop()`.
  - Com `msw@3.0.3` + Vitest 5.0.5, o 1º teste do arquivo passa e os seguintes falham com "the worker is already started".
  - Com o fixture `scope: 'file'` (sintaxe builder, [Vitest: Test Context](https://vitest.dev/guide/test-context), v5.0.5) e `resetHandlers()` num fixture de teste, os 10 testes em 2 arquivos passam.
  - Também passam 5/5 com `msw()` + `virtual:msw` e `network.enable()` por teste, mas isso depende do wrapper de HMR (B5).
- **B7. A página diz que a integração Vite "automatically covers Vitest"** ([Vite integration](https://github.com/mswjs/mswjs.io/blob/main/src/content/guides/integrations/vite.md)). O plugin serve o `/mockServiceWorker.js` direto do pacote, não grava o arquivo no build de produção e tem `mode: 'worker-only'` para quem usa `setupWorker` próprio. **(teste)** Com `msw({ mode: 'worker-only' })` no `vitest.config.ts` e sem `public/`, os 10 testes passam. Sem o plugin e sem `public/`, falham com "Service Worker script does not exist at the given path".
- **B8. Issues do 3.x que pesam aqui:**
  - [#2801](https://github.com/mswjs/msw/issues/2801) (**aberta**): "Worker stops intercepting requests after ~5 minutes in Chromium (3.0.1)".
    - A reprodução é em Vitest Browser Mode.
    - Um colaborador aponta a #2724 como causa: o worker espera `sendToClient` em mensagens de mão única dentro de `waitUntil`.
    - O mantenedor diz que é a mesma causa da #2635 e que o script do worker "it's yours" para patchear.
    - Há usuários com `pnpm patch`.
  - [#2803](https://github.com/mswjs/msw/issues/2803) (fechada no 3.0.3): a interceptação por socket expõe preflight/CORS em JSDOM. O autor relata que os testes em Browser Mode não falharam.
  - [#2806](https://github.com/mswjs/msw/issues/2806) e [#2807](https://github.com/mswjs/msw/issues/2807): `quiet` era ignorado. Corrigido no 3.0.3.
  - [#2815](https://github.com/mswjs/msw/issues/2815) (aberta): headers proibidos, como `Cookie`, se perdem em "browser-like environments" (JSDOM). Não afeta o Browser Mode real.
- **B9. `@msw/cloudflare` sempre exigiu MSW recente.** A 0.2.0 (2026-09-28) declara peer `msw >=3`. A 0.1.0 (2026-09-25) e a 0.0.1 declaravam `>=2.14.1`. Ficar na 0.1.0 com MSW 2 seria possível, mas é anterior ao 3.0 e não tem suporte documentado ([Mock outbound requests](https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/), 2026-10-08, pede `msw@^3`).

### C. Experimento local (teste)

Feito em diretório temporário, sem tocar no repo:
- OpenAPI com `GET /companies` (200, array), `POST /companies` (201 + 422, com body) e `DELETE /companies/{id}` (204);
- `pluginTs()`, `pluginFaker({ seed: [42] })` e `pluginMsw({ output: { path: 'handlers', mode: 'directory' }, parser: 'faker', handlers: true })`;
- `kubb@5.11.0`, `@faker-js/faker@10.6.0`, `msw@3.0.3`, `typescript@6.0.3`, `vitest@5.0.5` e `@vitest/browser-playwright@5.0.5` (Chromium).

| Verificação | Resultado |
|---|---|
| `pnpm add` | só aviso: `unmet peer msw@^2.0.0: found 3.0.3` |
| `kubb generate` | 16 arquivos. Observação: o Kubb 5.11 rejeita `input: { path }` (`KUBB_LEGACY_INPUT`); use `input: './openapi.yaml'` |
| `tsc --strict` (gerado + uso com `setupWorker`, `setupServer`, `worker.use(...)`, resolver com `request.json()` tipado e `HttpResponse.json` de `msw/http`, `onUnhandledFrame`) | passa |
| Browser Mode, fixture por teste (receita oficial) | 1 passa, 4 falham ("already started") |
| Browser Mode, fixture `scope: 'file'` | 10/10 |
| Browser Mode, `msw({ mode: 'worker-only' })` sem `public/` | 10/10 |
| Browser Mode, `msw()` + `virtual:msw` | 5/5 |
| Node, `setupServer` + handler gerado relativo × `fetch('http://localhost:8787/companies')` | não casa (comportamento documentado do Kubb: "In Node, set `baseURL`") |

### D. Duas versões num monorepo pnpm

- **D1. (teste)** Workspace com `apps/web` (`msw@2.15.0`, `@kubb/plugin-msw`, `vitest`, `@vitest/browser-playwright`) e `apps/api` (`msw@3.0.3`, `@msw/cloudflare@0.2.0`, `vitest`). O pnpm 10.28.1 instala `msw@2.15.0` e `msw@3.0.3` e cria duas variantes de `vitest@5.0.5` e de `@vitest/mocker@5.0.5`, uma por versão do MSW (sufixos `_msw@2…` e `_msw@3…` no `.pnpm`). Cada pacote enxerga o próprio MSW, e os tipos não se misturam porque cada `tsconfig` resolve o `node_modules` do seu pacote.
- **D2.** O `@vitest/mocker@5.0.5` declara peer **opcional** `msw: "^2.4.9 || ^3.0.0"` (npm). O Vitest usa o MSW internamente na Browser Mode ("Vitest actually ships with MSW built-in" — doc do MSW, B6), mas aceita as duas.
- **D3. Limites:**
  - Duas versões só funcionam com SPA e API em **pacotes diferentes**. Num pacote só, o código gerado importa `'msw'` literalmente, e um alias `npm:msw@2` não ajuda.
  - A decisão 13 é um único Worker com `@cloudflare/vite-plugin` (SPA + Hono). Se o Skeleton puser os dois num pacote, a convivência deixa de existir.
  - Um `vitest.config` raiz com `projects` cobrindo os dois apps carrega um só `vitest`. Não testei esse caso.
- **D4. Configuração do pnpm** ([Peer dependency settings](https://pnpm.io/settings/peer-dependencies), docs da v12):
  - `strictPeerDependencies` tem padrão `false`;
  - `autoInstallPeers` tem padrão `true`;
  - `dedupePeerDependents` tem padrão `true`, mas não deduplica quando os peers conflitam;
  - `peerDependencyRules.allowedVersions` aceita o seletor `"pai>peer"`, por exemplo `"card>react": "17"`. Com ele, o aviso só some para aquele pai.

  As settings ficam em `pnpm-workspace.yaml`: "Only auth and registry settings are read from `.npmrc`" ([Settings](https://pnpm.io/settings)).

## Riscos em aberto

- **R1. #2801 (aberta): o worker para de interceptar depois de ~5 min no Chromium.** Uma suíte de Browser Mode longa, ou um `vite dev` com mocks, pode começar a mandar requests para a rede sem aviso. Com `onUnhandledFrame: 'error'` o teste falha em vez de passar em silêncio, mas fica flaky. Mitigações:
  - acompanhar a correção;
  - deixar cada arquivo de teste curto (cada arquivo registra o worker de novo);
  - se aparecer, aplicar `pnpm patch` no script do worker, como sugerem na issue.
- **R2. Upgrade do Kubb (#1049).** O mais provável é passar a gerar `msw/http` e `HttpResponse` com peer `^3`. Isso resolve o aviso, mas pode mudar a assinatura dos handlers e os nomes dos helpers. O gate do item 6 da recomendação pega isso. Fixe a versão do Kubb no catalog e atualize de propósito.
- **R3. MSW 4 tira os exports da raiz (B3).** O código gerado atual (`from 'msw'`) quebra no v4. Não há data. Não suba para o v4 antes de o Kubb gerar `msw/http`.
- **R4. A doc oficial do MSW está errada para o 3.0.3 (B6).** Agentes da Factory que seguirem a receita oficial vão escrever o fixture por teste e quebrar. A spec do Skeleton precisa fixar o fixture `scope: 'file'` e citar a armadilha no guia de testes do repo.
- **R5. A interceptação por socket em Node (B1, #2803).** No back, com `createTestHarness`, o `fetch` de saída do Worker passa pelo `globalThis.fetch` do Node (pesquisa 08), e agora é interceptado no nível do socket. Pode aparecer request que antes não aparecia, como preflight ou chamadas internas do wrangler. Com `onUnhandledFrame: 'error'`, isso vira falha. Não testei o `createTestHarness` + MSW 3: continua sendo o spike da pesquisa 08 (risco 4).
- **R6. O layout do monorepo não está decidido.** Se o Skeleton tiver SPA e API num pacote só (um Worker), "duas versões" não é opção. A recomendação (MSW 3 em todo lugar) vale nos dois layouts.
- **R7. `virtual:msw` em teste.** Funciona, mas o `enable()` repetido só passa por causa do wrapper de HMR (B5). Não use como base do fixture.
