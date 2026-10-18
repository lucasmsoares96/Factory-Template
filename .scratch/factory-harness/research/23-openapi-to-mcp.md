# OpenAPI → MCP: como expor cada operação da API como tool

Ticket: [23-reference-app-mcp-tools](../issues/23-reference-app-mcp-tools.md)
Pesquisado em: 2026-10-18

Escopo: só as **opções de implementação** para que toda operação OpenAPI de `/api/*` vire uma tool em `/mcp`. Annotations, scopes, granularidade e testes ficam em [23-mcp-tools-practice.md](23-mcp-tools-practice.md).

Versões consultadas (via `npm view` / `npm pack` em 2026-10-18):

| Pacote | Versão | Publicada |
| --- | --- | --- |
| `@kubb/plugin-mcp` | 5.2.3 | 2026-10-15 (5.0.0 em 2026-08-19) |
| `@kubb/plugin-fetch` | 5.7.0 | — |
| `@hono/mcp` | 0.3.2 | 2026-08-18 |
| `@modelcontextprotocol/hono` | 2.0.2 | 2026-10-02 |
| `@modelcontextprotocol/server` (SDK v2) | 2.3.1 | 2026-10-05 |
| `mcp-from-openapi` | 2.8.0 | 2026-09-26 |
| `@orval/mcp` | 8.43.0 | 2026-10-14 |
| `@ivotoby/openapi-mcp-server` | 1.16.1 | 2026-06-15 |
| `@cloudflare/codemode` | 0.5.4 | 2026-10-13 |
| `agents` | 0.28.1 | 2026-10-13 |
| `hono` | 4.13.13 | — |
| `better-auth` | 1.7.10 | 2026-10-16 |

## Resposta curta

- **Não existe ponte pronta Hono/`@hono/zod-openapi` → MCP.** `@hono/mcp` e `@modelcontextprotocol/hono` cuidam só do transporte. O caminho viável é **gerar as tools a partir do documento OpenAPI 3.1** (no build com Kubb ou no runtime com `mcp-from-openapi`) e **executar cada tool chamando a rota Hono em processo** (`app.request(...)`), passando a identidade pelo `Env` do lado do servidor, sem repassar o bearer token.
- **Kubb v5 tem `@kubb/plugin-mcp`**, mas o que ele gera é um servidor **stdio** que chama a API **por HTTP** através de um client plugin. No Worker dá para reaproveitar só os handlers, trocando o `transport` do client por `app.request`. O client, porém, é global, então a identidade por request exige `AsyncLocalStorage`.
- **Code Mode (`openApiMcpServer`: tools `search` + `execute`) não serve no plano Free.** Ele depende de Dynamic Workers (binding `worker_loaders`), que são "currently only available on the Workers Paid plan". Além disso, hoje ele devolve um servidor do SDK v1 (legacy).
- **Contas no Better Auth:** `update-user`, `change-email`, `change-password` e `delete-user` existem, mas exigem uma **sessão** Better Auth (cookie/headers). Um token MCP não tem essa sessão. Para expor isso via MCP, é preciso criar rotas Hono próprias.
- **`createMcpHandler` recebe uma factory por request**, então registrar tools em loop a partir de uma lista é natural. O `McpServer` do SDK v2 **não pagina** `tools/list` e anuncia `listChanged: true` por padrão.

## 1. Gerar tools MCP a partir do OpenAPI/Hono

### 1a. Kubb `@kubb/plugin-mcp` (existe na v5)

- **Existe e acompanha a v5.** A versão 5.2.3 saiu em 2026-10-15, e a 5.0.0 em 2026-08-19. A primeira versão no npm foi a 3.7.7 (2025-04-14), e houve releases quase semanais em toda a linha 4.x. A compatibilidade declarada é `"kubb": ">=5.8.3"`, `"node": ">=22.12"`, com dependências `plugin-ts` e `plugin-zod`. Fontes: `npm view @kubb/plugin-mcp time`; `kubb-extension.json` no pacote 5.2.3; repositório [kubb-labs/plugins/packages/plugin-mcp](https://github.com/kubb-labs/plugins/tree/main/packages/plugin-mcp).
- **O que gera:** "Each API operation becomes a typed MCP tool". Cada tool usa schemas Zod do `@kubb/plugin-zod` como input e output. Fonte: [docs Kubb plugin-mcp](https://kubb.dev/extensions/kubb-labs/plugin-mcp) (`docs/overview.md` no pacote 5.2.3).
  - Na raiz de `output.path` ele escreve `server.ts`, `start.ts` e `.mcp.json`. O `start.ts` sobe um servidor **stdio**, e o `.mcp.json` roda `npx tsx start.ts`. Fonte: `docs/guides/server.md` (5.2.3).
  - O `server.ts` gerado exporta `getServer()`, que faz `new McpServer(...)` + `server.registerTool(...)` por operação, mais `export const server = getServer()` e `startServer()`, que chama `serveStdio` importado de `@modelcontextprotocol/server/stdio`. Fonte: template em `dist/index.js` do pacote 5.2.3, linhas ~353–405 e ~787–791.
  - O `outputSchema` gerado é `z.object({ data: <Response> })`, e o resultado traz `content: [{type:'text', text: JSON.stringify(...)}]` + `structuredContent: { data }`. Fonte: mesmo arquivo, componente `McpHandler`.
- **Chama por HTTP, não em processo.** "Each tool handler calls the function a client plugin generates for that operation" (`plugin-fetch`, `plugin-axios` ou `plugin-client`), e o `baseURL` é configurado no client plugin. Os handlers passam `signal: ctx.mcpReq.signal` e `throwOnError: true`, de modo que um não-2xx vira erro de tool. Fonte: `docs/options.md` (5.2.3) e template `McpHandler`.
- **Auth:** o handler gerado **não lê** `ctx.http.authInfo` e não passa `client` por chamada. Ele usa o client global. No `plugin-fetch`, a auth vem de `client.setConfig({ auth: () => token })`, aplicada conforme os `securitySchemes` do spec. Fonte: `@kubb/plugin-fetch` 5.7.0, `docs/guides/authentication.md`.
- **Dá para rodar em processo no Worker?** O `plugin-fetch` aceita um **`transport` customizado**: "Set a transport at runtime to replace the network send". O transport recebe um `ResolvedRequest` (`url`, `method`, `headers`, `body`, `signal`) e devolve `{ data, status, headers, request, response }`. É configurável por `client.setConfig({ transport })`, por `createClient`, ou por operação. Fonte: `@kubb/plugin-fetch` 5.7.0, `docs/guides/transport.md`. Com isso, um transport que faz `app.request(url, init, envComIdentidade)` evita a rede.
  - **Inferência, não testado:** como o handler gerado usa o client global, passar a identidade de cada request até o transport exige `AsyncLocalStorage`. Ele está disponível no Workers via `nodejs_compat`, que é padrão a partir da compatibility date 2026-08-04 ([CF docs AsyncLocalStorage](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/), atualizada em 2026-04-23).
  - Importar o `server.ts` gerado puxa `@modelcontextprotocol/server/stdio`. No Worker, o mais limpo é importar só os handlers por operação e registrá-los na própria factory do `createMcpHandler`.
- **Maturidade:** nenhum doc do Kubb menciona Workers nem HTTP/Streamable; o único caminho documentado é stdio local (fontes acima).

### 1b. Ecossistema Hono

- **`@hono/mcp` 0.3.2** (2026-08-18) oferece `StreamableHTTPTransport` para conectar um `McpServer` a uma rota Hono, mais `simpleMcpAuthRouter` para auth com um provedor externo. Ele **não gera tools a partir de OpenAPI**. O peer é `@modelcontextprotocol/sdk ^1.29.0` (SDK v1). Fonte: README e `package.json` do pacote 0.3.2; [honojs/middleware/packages/mcp](https://github.com/honojs/middleware/tree/main/packages/mcp).
- **`@modelcontextprotocol/hono` 2.0.2** (oficial, SDK v2) "is a thin Hono integration layer … It does **not** implement MCP itself": tem `createMcpHonoApp`, parse de body e validação de Host. Também não gera tools. Fonte: README do pacote 2.0.2 ([typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)).
- **`hono-openapi` 1.5.0** (2026-10-18) é um "OpenAPI schema generator for Hono", sem MCP (`npm view hono-openapi description`). Busquei `npm search "hono mcp"` e `"openapi mcp"` em 2026-10-18 e não encontrei nenhum pacote mantido que faça ponte `@hono/zod-openapi` → tools MCP.

### 1c. Bibliotecas que convertem um documento OpenAPI em tools

- **`mcp-from-openapi` 2.8.0** (2026-09-26, Apache-2.0; 1.0.0 em 2025-11-22) é a melhor candidata para runtime. Fonte: README do pacote 2.8.0 / [agentfront/mcp-from-openapi](https://github.com/agentfront/mcp-from-openapi).
  - Gera definições de tool a partir do spec (objeto JSON, URL, arquivo ou YAML).
  - Resolve conflitos de nome entre path, query e body, com um `mapper` explícito.
  - Infere `annotations` pelo verbo HTTP, com override por `x-mcp`.
  - Filtra por tag, método, glob de path, operationId ou `readOnlyOnly`.
  - `toSdkTool(tool, { fromJsonSchema })` registra no SDK v2, e `buildHttpRequest(tool, input)` monta `{ url, method, headers, body }`.
  - O README afirma "Works on Node and V8 isolates (Cloudflare Workers) alike". **Isso não foi verificado aqui.** A dependência `@apidevtools/json-schema-ref-parser` merece um teste de bundle.
  - Auth: um resolver por esquema de segurança, ou nenhum, se o executor for nosso (`buildHttpRequest` → `app.request`).
- **`@orval/mcp` 8.43.0** (2026-10-14) é codegen: o `server.ts` gerado traz `new McpServer` + `server.registerTool` por operação (`dist/index.mjs`, linhas ~177–210), e o README mostra uso por stdio/Docker. É análogo ao Kubb. Como o projeto já usa Kubb, não acrescenta nada.
- **`@ivotoby/openapi-mcp-server` 1.16.1** (2026-06-15) é um servidor **standalone** (stdio ou HTTP) que lê `OPENAPI_SPEC_PATH` + `API_BASE_URL` e injeta headers estáticos (`API_HEADERS="Authorization:Bearer …"`). Fonte: README do pacote. É um processo à parte, não embutível no Worker, e usa uma credencial fixa.

## 2. Cloudflare Code Mode (`search` + `execute`)

- **Como funciona:** o servidor MCP da API Cloudflare expõe a API inteira (mais de 2.500 endpoints) com duas tools, cerca de 1.000 tokens contra 1,17 milhão no modelo de uma tool por endpoint. Fonte: [blog Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/), publicado em 2026-02-20 e atualizado em 2026-07-15.
  - Em `search`, o modelo escreve JS que filtra o objeto `spec` (OpenAPI com `$ref` resolvidos).
  - Em `execute`, o JS chama `cloudflare.request()`.
  - As duas tools rodam num Dynamic Worker isolado, sem rede.
- **API genérica:** `openApiMcpServer({ spec, executor, request })` de `@cloudflare/codemode/mcp` cria um servidor com `search` + `execute`. O `request(options, context)` roda **no host** ("auth never enters the sandbox") e recebe `method`, `path`, `query`, `body`, `contentType` e `rawBody`. O `context` é o `RequestHandlerExtra` da chamada externa. Fonte: `dist/mcp.d.ts` do `@cloudflare/codemode` 0.5.4.
- **Requisitos:** binding `"worker_loaders": [{ "binding": "LOADER" }]` + `nodejs_compat`, e `new DynamicWorkerExecutor({ loader: env.LOADER })`. A doc avisa: "`openApiMcpServer()` currently returns an SDK v1 server. Serve it through the explicit legacy `createLegacyMcpHandler` API." Fonte: [guia "Build a search and execute MCP server"](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-openapi-mcp-server/), atualizado em 2026-10-12. Confirma isso o peer `@modelcontextprotocol/sdk ^1.25.0` no `package.json` 0.5.4.
- **Plano Free: não.** A doc diz "Dynamic Workers are currently only available on the Workers Paid plan". No Paid, o preço é 1.000 Dynamic Workers/mês incluídos + US$ 0,002 por Dynamic Worker por dia, com cobrança desde 2026-05-26. Fonte: [Dynamic Workers › Pricing](https://developers.cloudflare.com/dynamic-workers/pricing/), atualizada em 2026-06-11. A página de [limites do Workers](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-12) não menciona Dynamic Workers.
- **Exemplo oficial:** [`cloudflare/agents/examples/codemode-mcp-openapi`](https://github.com/cloudflare/agents/tree/main/examples/codemode-mcp-openapi) (commit `52e4f83`, 2026-10-14). Ele usa `createLegacyMcpHandler` + `openApiMcpServer` sobre o spec da API Cloudflare e repassa o bearer recebido para `api.cloudflare.com`. **Não achei exemplo oficial de Code Mode sobre uma app Hono/OpenAPI própria.**
- **Alternativa sem sandbox:** o `Executor` é uma interface mínima (`execute(code, providers)`) e a doc sugere "Node VM, QuickJS, containers". Fonte: `agents` 0.28.1, `docs/codemode.md`. No Free, só sobraria um executor próprio (por exemplo, QuickJS em WASM). Isso não foi avaliado, e a doc marca Codemode como "Experimental".

## 3. Chamada em processo da tool para a rota Hono

- **`app.request` é uma chamada de função.** Em `hono-base.ts` (4.13.13), `request = (input, requestInit, Env, executionCtx) => this.fetch(new Request(...), Env, executionCtx)`, e um path relativo vira `http://localhost/<path>`. Fonte: [honojs/hono src/hono-base.ts @ v4.13.13](https://github.com/honojs/hono/blob/v4.13.13/src/hono-base.ts) (`dist/hono-base.js`, linha 321).
  - A doc só apresenta o método como ferramenta de teste: "`request` is a useful method for testing" ([Hono API › request](https://hono.dev/docs/api/hono)). Não há doc oficial sobre "chamar rotas internamente".
  - A 3ª posição é o `Env`: "To set `c.env` for testing, you can pass it as the 3rd parameter to `app.request`" ([Hono › Testing › Env](https://hono.dev/docs/guides/testing)).
- **Identidade do lado do servidor:** como o `Env` é argumento de `app.request`, a tool pode chamar `app.request(path, init, { ...env, MCP_PRINCIPAL: { userId, companyId } }, ctx)`. Um middleware de `/api` aceita esse principal **só** se vier do `Env`, que um cliente externo não consegue forjar, ao contrário de um header. (Isso é inferência a partir da assinatura acima.) Com isso, não se repassa o token MCP para `/api`. A spec diz: "MCP servers **MUST** only accept tokens that are valid for use with their own resources. MCP servers **MUST NOT** accept or transit any other tokens." Fonte: [MCP spec 2026-07-28 › Authorization › Token Handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
- **No `createMcpHandler`, a identidade chega à tool** por `context.http?.authInfo` (`clientId`, `scopes`) e por `getMcpAuthContext().props` (as `props` do `OAuthProvider`). A doc avisa "Do not log or return `context.http.authInfo.token`". Fonte: `agents` 0.28.1, `docs/mcp-servers.md`, seção "Accessing Authenticated User Context".
- **Custo:**
  - Subrequest é "any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1". O Free tem 50 subrequests por invocação. Fonte: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), 2026-10-12.
  - `app.request` não usa `fetch()` (código acima), então **não conta como subrequest**. É inferência; a página de limites não trata de chamadas de um Worker para ele mesmo. As queries que a rota fizer contam normalmente.
  - Em CPU, tudo soma no mesmo limite de **10 ms por request HTTP no Free** (e 1 s de startup). Espera de rede não conta (mesma fonte).
  - Um `fetch()` para o próprio hostname "fails" sem binding no mesmo zone (mesma fonte). Por isso, o modo HTTP padrão do Kubb (`baseURL`) não serve no Worker.

## 4. Better Auth: rotas de conta e OpenAPI

- **Plugin `openAPI()`:** a referência fica em `/api/auth/reference`, o JSON em `/api/auth/open-api/generate-schema` ou `auth.api.generateOpenAPISchema()`, no formato OpenAPI 3.1.1. A doc mostra o schema como **fonte separada** no Scalar, ao lado da API principal ("add Better Auth as an additional source"), e não como merge. Ela também avisa que o plugin "is still in the early stages of development". Fonte: [Better Auth › Open API plugin](https://www.better-auth.com/docs/plugins/open-api) e [`src/plugins/open-api`](https://github.com/better-auth/better-auth/tree/v1.7.10/packages/better-auth/src/plugins/open-api).
- **Endpoints de conta** (fonte: `packages/better-auth/src/api/routes/update-user.ts` @ [v1.7.10](https://github.com/better-auth/better-auth/blob/v1.7.10/packages/better-auth/src/api/routes/update-user.ts), conferido no `dist`; flags em [Users & Accounts](https://www.better-auth.com/docs/concepts/users-accounts)):

| Operação | Endpoint | Middleware | Observação |
| --- | --- | --- | --- |
| Mudar nome/imagem | `POST /update-user` | `sessionMiddleware` | — |
| Mudar e-mail | `POST /change-email` | `sensitiveSessionMiddleware` | exige `user.changeEmail.enabled: true` + `sendVerificationEmail` |
| Mudar senha | `POST /change-password` | `sensitiveSessionMiddleware` | `currentPassword`, `newPassword`, `revokeOtherSessions` |
| Definir senha | `setPassword` | `serverOnly` | — |
| Apagar usuário | `POST /delete-user` | `sensitiveSessionMiddleware` | exige `user.deleteUser.enabled: true`; senha, sessão fresca ou verificação por e-mail |

- `sensitiveSessionMiddleware` "forces the endpoint to require a valid authoritative session" (`session.ts`). **Um token MCP não traz uma sessão Better Auth**, então esses endpoints não podem ser chamados a partir da tool sem fabricar uma sessão.
- **Para MCP, essas operações precisariam de rotas Hono próprias** (por exemplo, `PATCH /api/me`), que escrevem via `auth.$context` → `internalAdapter.updateUser(userId, data)` / `updatePassword` / `deleteUser`. Esses métodos existem na 1.7.10 ([`src/db/internal-adapter.ts`](https://github.com/better-auth/better-auth/blob/v1.7.10/packages/better-auth/src/db/internal-adapter.ts)). Escrever direto no banco também resolve. As rotas Hono próprias com `@hono/zod-openapi` entram no documento `getOpenAPI31Document()`. As rotas do Better Auth, não.

## 5. `createMcpHandler` / `McpServer`: registro dinâmico e `tools/list`

- **Factory por request:** "`createMcpHandler` requires a factory so concurrent Worker requests receive isolated server instances" e "The handler creates one MCP server for each request … Do not create one global server instance". Fontes: `agents` 0.28.1 `docs/mcp-servers.md`; [Handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/), atualizada em 2026-10-18.
  - Portanto, `for (const op of ops) server.registerTool(op.name, …)` dentro da factory é o padrão.
  - O custo de registrar N tools se repete em todo request: é **CPU dentro dos 10 ms do Free**, e precisa ser medido.
- **Variar por autorização é permitido:** "The set **MAY** vary by the authorization presented on the request … but **MUST NOT** vary per-connection". Os servidores "**SHOULD** return tools in a deterministic order". Fonte: [MCP spec 2026-07-28 › Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).
- **Paginação:** a spec diz que `tools/list` "supports pagination" (`cursor`/`nextCursor`; mesma fonte). Mas o `McpServer` do SDK v2 2.3.1 responde com **todas** as tools habilitadas, sem `nextCursor`: `setRequestHandler("tools/list", () => ({ tools: Object.entries(this._registeredTools).filter(... enabled) ... }))`. Fonte: [`packages/server/src/server/mcp.ts` @ v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.3.1/packages/server/src/server/mcp.ts) (`dist/mcp-*.mjs`, linha ~1761). Para paginar, seria preciso um handler de baixo nível.
- **`listChanged`:** o `McpServer` registra `tools: { listChanged: … ?? true }` (mesmo arquivo, linha ~1760). Para emitir a notificação, use `handler.notify.toolsChanged()`, com o handler criado **no escopo do módulo**. As notificações "are isolate-local" e só chegam a quem abriu `subscriptions/listen`. Fonte: Handler API, acima.

## Implicações para o ticket 23

1. **"Toda operação OpenAPI usável via MCP" é viável no Free** com: o documento de `app.getOpenAPI31Document()` → um gerador de tools → um handler que chama `app.request(path, init, envComPrincipal, executionCtx)` em processo. Não há rede, não há subrequest, e o token não é repassado. Uma rota Hono só vira tool depois de estar no OpenAPI.
2. **Há dois geradores candidatos:**
   - **Kubb `plugin-mcp`**, no build: tipado, já no pipeline, mas foi pensado para stdio + HTTP. Exige um `transport` customizado e `AsyncLocalStorage` para a identidade, e não se deve importar o `server.ts` gerado.
   - **`mcp-from-openapi`**, em runtime: registro direto no SDK v2, `annotations` inferidas e filtros por tag. Como dependência nova, precisa de um teste de bundle no Workers.
   - Um gerador próprio e fino sobre `getOpenAPI31Document()` também é plausível. Vale um protótipo curto que compare os três em CPU por request.
3. **Code Mode fica fora** enquanto o alvo for o plano Free (Dynamic Workers só no Paid) e enquanto `openApiMcpServer` for SDK v1/legacy. Reavaliar se o Skeleton passar a exigir o Paid ou se o número de operações tornar inviável uma tool por operação.
4. **O middleware de `/api` precisa aceitar dois principals:** a sessão Better Auth (cookie) ou um `MCP_PRINCIPAL` vindo **só** do `Env` injetado pela tool. A revalidação de Member/role no Postgres continua na rota, que é única para SPA e MCP.
5. **Conta via MCP:** nome e imagem exigem uma rota Hono própria (por exemplo, `PATCH /api/me` → `internalAdapter.updateUser`). Troca de e-mail, troca de senha e exclusão de usuário dependem de uma sessão sensível/fresca no Better Auth. A recomendação é deixá-las fora do MCP ou fazê-las só com step-up explícito; a decisão é do grilling, e a orientação de spec está em `23-mcp-tools-practice.md`.
6. **`tools/list` não pagina no SDK v2**, então todas as tools vão de uma vez. Filtrar por role/scopes na factory é permitido pela spec, mas a ordem precisa ser determinística. Se a lista mudar em deploy, `listChanged` exige o handler no escopo do módulo.

## Adendo (2026-10-18): equivalentes ao FastMCP em TypeScript

Pergunta do usuário: o FastAPI tem o FastMCP (`FastMCP.from_fastapi`); existe equivalente para esta stack?

- **`fastmcp` 4.23.2** (punkpeye, 2026-10-17) tem `fromOpenAPI()` em `fastmcp/openapi`: uma tool por operação de um documento OpenAPI 3.x, com `include`/`exclude`, `outputSchema` a partir da resposta `2xx` JSON e uma trava que lança erro acima de 40 operações sem filtro. Cada tool executa por `fetch` (substituível) contra `servers[0].url` ou `baseUrl`. A autenticação é `headers`, um objeto fixo ou uma função **sem argumentos**, então não há identidade por usuário ou por sessão. Não infere anotações. O retorno é um `FastMCP` (Node); a doc do `fromOpenAPI` não menciona o `EdgeFastMCP` (a variante para Workers), e o `EdgeFastMCP` não tem autenticação embutida ("Built-in authentication for EdgeFastMCP is planned"). Fontes: [README](https://www.npmjs.com/package/fastmcp) e [docs/openapi.md](https://github.com/punkpeye/fastmcp/blob/main/docs/openapi.md), lidos em 2026-10-18.
- **`@prefecthq/fastmcp-ts` 1.7.3** (2026-10-01), o porte oficial do FastMCP para TypeScript, depende de `express` e `@modelcontextprotocol/node`; o README não mostra conversão de OpenAPI. Fonte: [npm](https://www.npmjs.com/package/@prefecthq/fastmcp-ts).
- **`@orval/mcp` 8.43.0** (2026-10-14) é o equivalente do `@kubb/plugin-mcp` no Orval: gera código de servidor MCP a partir da OpenAPI. Fonte: [npm](https://www.npmjs.com/package/@orval/mcp).
- **O próprio FastMCP (Python) desaconselha espelhar a API**: "We recommend using the FastAPI integration for bootstrapping and prototyping, not for mirroring your API to LLM clients" e "LLMs achieve significantly better performance with well-designed and curated MCP servers". O `from_fastapi` usa uma credencial fixa via `httpx_client_kwargs`. Fonte: [gofastmcp.com/integrations/fastapi](https://gofastmcp.com/integrations/fastapi), lido em 2026-10-18.

**Implicação:** existe equivalente, mas nenhum atende aos dois requisitos que já estão decididos. O primeiro é a identidade do usuário em cada chamada, e todos usam uma credencial fixa. O segundo é rodar no Worker atrás do `workers-oauth-provider`: o `fastmcp` traz servidor e OAuth próprios, e a variante Edge não tem auth. O gerador próprio do ticket 23 é a mesma ideia do `fromOpenAPI`, sem esses dois limites.
