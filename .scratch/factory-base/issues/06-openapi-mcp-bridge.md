# 06: Ponte OpenAPI → MCP

Spec: [../spec.md](../spec.md)

**What to build:** um usuário conecta um agente de IA ao Product pelo `/mcp`: o cliente descobre a autorização pelo 401, o usuário faz login, consente com `read` ou `write`, e o agente chama `getMe` com a identidade do usuário. Toda rota de `/api/*` vira uma tool sem código extra, e o CI segura tools sem descrição ou mudanças não vistas no `tools/list`.

**Blocked by:** 05

**Status:** ready-for-human

- [x] `workers-oauth-provider` + `createMcpHandler`, CIMD e DCR ligados, `legacy: "stateless"`, `OAUTH_KV` do Product. Token só com `userId`.
- [x] `/authorize` lê a sessão do Better Auth e mostra o consentimento com a escolha `read`/`write`.
- [x] O ponto único de identidade aceita também o token do MCP.
- [x] Gerador no `pnpm generate` sobre a OpenAPI composta: uma tool por operação (nome pelo `operationId`, descrição, schemas de entrada e saída, escopo e anotações pelo verbo), opt-out `x-mcp: false`, rotas do Better Auth fora.
- [x] A tool chama a rota Hono dentro do Worker com a identidade no `env`; sucesso → `structuredContent`, 4xx → `isError: true`; o `tools/list` esconde escrita de um token `read`.
- [x] O reset de senha passa a revogar todas as Connections (`revokeGrant`).
- [x] O `verify` falha se uma operação exposta não tiver `operationId`, `summary` ou `description`, e compara o `tools/list` com um snapshot commitado (seam 6).
- [x] Testes com o cliente MCP do SDK contra o Worker local: `read` não vê escrita, a identidade chega à rota, 4xx vira `isError`, 401 com `WWW-Authenticate` sem token (seam 3).
- [x] E2E do fluxo completo: login, consentimento, token, chamada de `getMe` (seam 5).
- [ ] Critério medido no ticket 14: CPU por request do `/mcp` no Workers Free.

## Comments

Implementado em 2026-10-19. Versões conferidas no npm registry (`npm view <pkg> version time peerDependencies`) e nas docs que vêm nos pacotes publicados (README, `docs/*.md` e `migration-1.x.md` do `workers-oauth-provider`, `docs/mcp-servers.md` do `agents`, tipos do SDK v2) nessa data, fixadas no `catalog`:

| Pacote | Versão | Publicado |
|---|---|---|
| @cloudflare/workers-oauth-provider | 1.2.3 | 2026-10-07 |
| agents (`agents/mcp/server`) | 0.28.1 | 2026-10-13 |
| @modelcontextprotocol/server / client | 2.3.1 | 2026-10-05 |
| @modelcontextprotocol/sdk (peer obrigatório do `agents`, não usado direto) | 1.32.1 | 2026-10-05 |

O que ficou:
- `createApp({ ..., routers?, mcpTools? })`: `/mcp`, `/oauth/token`, `/oauth/register` e `/.well-known/oauth-*` vão para um `OAuthProvider` (`platform/mcp/connections.ts`); `/oauth/authorize` é do Skeleton. CIMD (`clientIdMetadataDocumentEnabled` + flag `global_fetch_strictly_public` nos dois `wrangler.jsonc`) e DCR ligados, `scopesSupported: ["read","write"]`, `requiredScopes: ["read"]`, `createMcpHandler(..., { legacy: "stateless" })` com uma `McpServer` do SDK v2 por request. Binding `OAUTH_KV` no `wrangler.jsonc` (sem `id`: o bootstrap cria o namespace). `run_worker_first` do `example` ganhou `/mcp`, `/oauth/*`, `/.well-known/*`.
- Recurso por origem: `resourceMetadata.resource` é fixo no construtor do provider, e o Worker atende vários hostnames (produção, preview, `127.0.0.1:<porta>` nos testes). O provider é criado por origem do request (`<origin>/mcp`, issuer `<origin>`, cache de até 16), como o `baseURL` do Better Auth: um token só vale no hostname que o emitiu, e cada Product tem o seu `OAUTH_KV`.
- Consentimento (`platform/mcp/consent-page.ts`): HTML do Worker (não da SPA: precisa dos headers do `beginConsent`, `frame-ancestors 'none'` e o cookie `__Host-`), textos `connect.*` em `en`/`pt-BR`. Mostra nome do cliente (domínio verificado para CIMD, aviso de nome não verificado para DCR), host do redirect, aviso de loopback, quem está logado e a escolha `read` (só ler) / `write` (ler e escrever = `["read","write"]`); tudo que vem do cliente é escapado. Sem sessão → `/sign-in?redirect=/oauth/authorize?...`; o login volta com recarga de página (`isWorkerPath`). Deny → `access_denied` para o cliente. `completeAuthorization({ props: { userId } })`; o `userId` do grant vai por `encodeURIComponent` (a lib recusa `:`).
- Identidade: `platform/identity.ts` ganhou a fonte `mcpConnection` (primeira da lista; `via: "mcp"`). A tool chama a rota com `app.request(req, undefined, { ...env, [MCP_CONNECTION]: { userId } }, ctx)`: a chave é um `Symbol`, então nenhum binding, header ou cliente consegue setá-la, e o token do agente nunca chega à rota. A fonte lê o usuário no banco (o token só tem o id): usuário apagado → 401 → `isError`.
- Gerador (`src/node/mcp-tools.ts`, chamado pelo `skeleton generate`): uma tool por operação de `/api/*` (fora `/api/auth/*` e `x-mcp: false`), nome = `operationId` (validado `[A-Za-z0-9_.-]{1,64}`, sem repetição), `title` = `summary`, `description`, `inputSchema` com parâmetros de path e query no topo e o corpo JSON em `body`, `outputSchema` da resposta 2xx JSON (embrulhada em `{ result }` quando não é objeto), `$ref` resolvidos (clientes 2025 não seguem `$ref`), escopo `read` para GET e `write` para o resto, anotações `readOnlyHint` (GET), `destructiveHint` (DELETE), `idempotentHint` (PUT), `openWorldHint: false`, e `title`. Lista ordenada por nome. Grava `src/mcp-tools.gen.json` no Product (e `test/worker/mcp-tools.gen.json` na composição de teste), **commitado**: é o snapshot do `tools/list`, e o seam 6 do `verify` (`generate` + árvore inalterada) falha se ele mudar sem commit. Uma operação exposta sem `operationId`, `summary` ou `description` faz o `generate` falhar listando cada uma (conferido: tirar a `description` do `getMe` derruba o `generate --product`).
- Execução (`platform/mcp/server.ts`): 2xx → `structuredContent` + o JSON em `content`; qualquer outro status → `isError: true` com `"<CODE>: <message em inglês>"`. O `tools/list` e o `tools/call` só registram as tools do escopo do token: uma tool de escrita chamada com token `read` é "Tool createNote not found".
- Reset de senha: `revokers = [revokeConnections]` (`listUserGrants` paginado + `revokeGrant`), pelo `c.var.connections()` (helpers do provider da origem do request).
- `/api/health` saiu do MCP com `x-mcp: false` (sonda da plataforma, não ação de agente). O `example` expõe só `getMe`.
- Testes: seam 6 `test/mcp-tools.test.ts` (5: nome/entrada/saída, corpo e saída embrulhada, escopo e anotações por verbo, opt-out e Better Auth fora, erro listando o que falta). Seam 3 `test/mcp.test.ts` (11, cliente do SDK v2 contra a composição de teste com as rotas só de teste `getNote`/`createNote` em `test/worker/notes.ts`): 401 + `WWW-Authenticate` → metadata do recurso → metadata do AS (CIMD anunciado, DCR); `read` só vê `getMe`/`getNote` e não chama `createNote`; `write` vê tudo e a escrita chega à rota com o `authorId` do usuário; 4xx → `isError` com a mensagem; `tools/list` igual ao `mcp-tools.gen.json` commitado; cliente no protocolo 2026-07-28 (`versionNegotiation: auto`) e no 2025 (padrão); sem sessão → login; página escapa nome malicioso, mostra host e quem está logado, Deny → `access_denied`; cliente CIMD (documento servido pelo MSW) conecta sem registrar e a página mostra o domínio; usuário apagado → `UNAUTHENTICATED`; reset de senha → access tokens 401 e refresh tokens recusados (refresh conferido antes). Conferido em vermelho: sem o filtro de escopo e sem o `revokeConnections`, 3 testes falham. Seam 5 `e2e/specs/mcp-connection.spec.ts` `@evidence` (`mcp-consent`): conta verificada, o agente descobre e registra, o usuário abre o link, faz login pela tela, cai no consentimento, escolhe "só ler", Permitir, o agente troca o code e chama `getMe` com o nome e o email do usuário. `apps/example/test/worker.e2e.test.ts` confere no build de produção que `/mcp` responde 401 com o desafio e que `/oauth/authorize` não cai na SPA.
- `TURBO_FORCE=1 pnpm factory:verify` verde (12 tasks; skeleton 87 testes node+browser, harness 91, E2E do example 5 + 4 specs). Numa execução com a máquina sob carga alheia (load ~100 em 8 núcleos) dois testes do harness (`sandcastle-agent`, `work-failures`, que rodam git) estouraram o timeout; sozinhos e na execução seguinte passaram. Nada do `.factory/` mudou neste ticket.

Desvios e decisões:
- `agents` 0.28.1 procura um contexto verificado (`Symbol.for("cloudflare.workers-oauth-provider.verified-context.v1")`) que o `workers-oauth-provider` 1.2.3 ainda não grava; o provider só põe `ctx.props` e `ctx.auth`. Então o `apiHandler` lê `ctx.auth.scope` e `ctx.props.userId` direto e monta a `McpServer` com eles; `getMcpAuthContext()` não é usado.
- A biblioteca anuncia escopos mas não aplica: o filtro por escopo é nosso (`createMcpServer`), como as notas pediam.
- `legacy: "stateless"` é o padrão do `createMcpHandler`; fica explícito no código como a spec pede.
- `createApp` ganhou `routers` (routers extras em `/api`, para a composição de teste; o ticket 07 troca por `Feature`) e `mcpTools`.
- `skeleton generate` importa o Worker pelo `runnerImport` do Vite: o `workers-oauth-provider` importa `cloudflare:workers` dentro de `node_modules`, então ele passa por `environments.inline.resolve.noExternal` para pegar o stub; o stub também declara `globalThis.Cloudflare.compatibilityFlags` (sem isso a lib avisa no load, em Node, que o CIMD está desligado).
- pnpm 12: `allowBuilds: core-js-pure: false` (vem do `agents` → `mimetext`; o postinstall só imprime um banner).
- O redirect de teste do agente é `http://127.0.0.1:33418/callback`: o Chromium bloqueia portas "inseguras" como a 9 antes do `page.route`; o E2E lê a URL pelo `waitForRequest`.
- Bundle do Worker do `example`: `index.js` 2,9 MB (≈ 0,69 MB gzip), antes 2,2 MB (0,48 MB gzip). Cabe no limite de 3 MB comprimido do Free; startup e CPU entram na medição do ticket 14.
- O SDK v2 valida entrada e saída das tools com JSON Schema (`fromJsonSchema`, validador `@cfworker/json-schema` no workerd). Cada request registra as N tools de novo (o handler é stateless): é CPU por request no Free, medida no ticket 14.

Pending (human): medir na conta (ticket 14) o CPU por request do `/mcp` no Workers Free (registro das tools, validação, `app.request` interno e KV do provider). Único critério não marcado; por isso o Status é `ready-for-human`.
Pending (human): criar o namespace KV `OAUTH_KV` de produção (e o `PREVIEW_OAUTH_KV_ID` do preview) na conta real, pelo bootstrap (tickets 13–15); o `wrangler.jsonc` tem só o binding.

Revisão (US73): o teste "a token issued for one Product's /mcp is rejected by another Product's /mcp" em `packages/skeleton/test/mcp.test.ts` sobe uma segunda composição (outro banco, outro `OAUTH_KV`, outra origem) e mostra que o token de uma dá 200 na sua origem e 401 na outra. Nenhum critério novo marcado: o único aberto continua sendo a medição de CPU no Workers Free.
