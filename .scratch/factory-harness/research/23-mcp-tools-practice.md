# 23 — Tools MCP na prática: spec, scopes, granularidade e testes

Pesquisa feita em 2026-10-18, só com fontes primárias: a especificação MCP e o `schema.ts` dela, o código e as docs de `@cloudflare/workers-oauth-provider`, `agents` e do MCP TypeScript SDK v2, além das docs oficiais dos clientes e dos fornecedores. O contexto da stack está em [07](07-auth-on-workers-and-mcp.md) e o dos testes em [08](08-integration-and-e2e-testing.md).

**Versões verificadas (npm / GitHub, 2026-10-18):**

| Item | Versão | Data |
| --- | --- | --- |
| Especificação MCP | 2026-07-28 (commit `b488c166`) | 2026-07-28 |
| `@modelcontextprotocol/server` / `client` | 2.3.1 | 2026-10-05 |
| `@modelcontextprotocol/sdk` (v1) | 1.32.1 | 2026-10-05 |
| `@modelcontextprotocol/inspector` | 2.11.0 | 2026-10-14 |
| `agents` | 0.28.1 (repo no commit `7dd51c5`) | 2026-10-13 / 2026-10-16 |
| `@cloudflare/workers-oauth-provider` | 1.2.3 (repo no commit `602610c`) | 2026-10-07 |
| `wrangler` | 4.151.1 | 2026-10-16 |
| `github/github-mcp-server` | v2.0.2 | 2026-10-08 |

---

## 1. A spec 2026-07-28 para tools

Fontes: [server/tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [`schema/2026-07-28/schema.ts`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts) e [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), todas da versão 2026-07-28.

### Campos de `Tool`

- **`name`**: obrigatório. *SHOULD* ter de 1 a 128 caracteres, ser case-sensitive e usar só `A-Z a-z 0-9 _ - .`, sem espaços. Exemplos válidos na própria spec: `getUser`, `admin.tools.list`. A unicidade vale só dentro de um servidor; quem agrega vários servidores resolve colisão com prefixo.
- **`title`**: opcional, para exibição. A ordem de precedência é `title` → `annotations.title` → `name`.
- **`description`**: é a "hint" para o modelo.
- **`icons`**.
- **`inputSchema`**: JSON Schema com `type: "object"` na raiz; o padrão é 2020-12. Na 2026-07-28 qualquer keyword 2020-12 passou a ser aceita, inclusive `oneOf`, `$ref` e `if/then` (SEP-2106). Para uma tool sem parâmetros, o recomendado é `{ "type": "object", "additionalProperties": false }`.
- **`outputSchema`**: opcional. Quando existe, o servidor **MUST** devolver `structuredContent` conforme o schema, e o cliente **SHOULD** validar. Desde a 2026-07-28, `structuredContent` aceita qualquer valor JSON, inclusive um array. Para compatibilidade, *SHOULD* também ir o JSON serializado num bloco `text`.
- **`annotations`** (`ToolAnnotations`): o conteúdo é **idêntico** ao da 2025-11-25 (conferi com diff do `schema.ts`). São todas *hints*:
  - `readOnlyHint`: padrão `false`.
  - `destructiveHint`: padrão `true`; só tem sentido quando `readOnlyHint == false`.
  - `idempotentHint`: padrão `false`; só tem sentido quando `readOnlyHint == false`.
  - `openWorldHint`: padrão `true`. A spec dá como exemplo de domínio fechado uma tool de memória.

  O schema avisa: *"Clients should never make tool use decisions based on `ToolAnnotations` received from untrusted servers."*
- **`_meta`**: é onde os clientes leem chaves proprietárias (ver §1.4).
- **`x-mcp-header`** (novo, SEP-2243): espelha um parâmetro primitivo num header `Mcp-Param-{name}`. *SHOULD NOT* ser usado com dados sensíveis.
- **Removido na 2026-07-28:** o campo `execution.taskSupport`, que existia na 2025-11-25. Tasks viraram a extensão `io.modelcontextprotocol/tasks` (SEP-2663).

### `tools/list`

- Suporta paginação por cursor opaco (`nextCursor`). O tamanho da página é do servidor, e o cliente **MUST NOT** presumir um tamanho fixo ([pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination)). A paginação da spec cobre **só** as listagens (`tools/list`, `prompts/list`, `resources/list` e `resources/templates/list`). Não existe paginação de resultado de tool no protocolo: se uma tool precisa paginar, isso é parâmetro dela.
- **Novo:** o resultado traz `ttlMs` e `cacheScope` (`"public" | "private"`) obrigatórios (SEP-2549). `"private"` significa que o cache *"MUST NOT be shared across authorization contexts"*. O SDK v2 emite `ttlMs: 0, cacheScope: "private"` por padrão, e `cacheHints` permite mudar ([`server.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/server.ts), v2.3.1).
- **Novo:** a lista *"MUST NOT vary per-connection"*, mas *"MAY vary by the authorization presented on the request — for example, returning only the tools the caller's granted scopes permit"*. *SHOULD* vir em ordem determinística, para favorecer o prompt cache.
- **Novo:** não há mais sessão nem `initialize`. Todo request leva `_meta` com versão e capabilities. Estado entre chamadas usa *handles* explícitos devolvidos por uma tool e passados como argumento: *"a handle is a name, not a capability. The server should validate the caller's authorization against the handle on every call"* (seção "Stateful Tools", não normativa).
- **Novo no transporte:** os headers `Mcp-Method` e `Mcp-Name` (nome da tool) são **obrigatórios** em todo POST. O servidor que processa o body **MUST** validar que eles batem com o body; senão responde `HeaderMismatch` (-32020) ([streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)). Com isso, um middleware HTTP sabe qual tool está sendo chamada sem ler o JSON.

### Erros: `isError` vs erro de protocolo

- **Erro de protocolo** (JSON-RPC `error`): tool desconhecida, request malformado, erro de servidor. *"Clients MAY provide protocol errors to language models"*.
- **Erro de execução** (`isError: true` no resultado): falha de API, validação de entrada, regra de negócio. *"Clients SHOULD provide tool execution errors to language models to enable self-correction."* O `schema.ts` reforça: *"Any errors that originate from the tool SHOULD be reported inside the result object … Otherwise, the LLM would not be able to see that an error occurred."*
- No SDK v2, uma exceção lançada no handler vira `isError: true`, com a `message` como texto. Argumentos que falham no `inputSchema` também voltam como `isError: true`, sem rodar o handler ([docs/servers/errors.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/errors.md), [tools.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md), main de 2026-10-13).
- Seção de segurança: servidores **MUST** *"Validate all tool inputs, Implement proper access controls, Rate limit tool invocations, Sanitize tool outputs"*.

### Tamanho de resultado

A spec **não define limite** de tamanho de resultado. Os limites são dos clientes:

| Cliente | Limite | Fonte |
| --- | --- | --- |
| Claude Code | Aviso acima de 10.000 tokens. Limite padrão de 25.000 tokens (`MAX_MCP_OUTPUT_TOKENS`). Texto acima de 50.000 caracteres vai para um arquivo. `_meta["anthropic/maxResultSizeChars"]` sobe o limite da tool até 500.000. Resposta HTTP acima de 16 MiB falha. | [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) (lida em 2026-10-18) |
| claude.ai / Desktop | Cerca de 150.000 caracteres; timeout de 240 s por chamada | [claude.com/docs/connectors/building](https://claude.com/docs/connectors/building) (2026-10-18) |
| Diretório da Anthropic | *"Keep responses reasonably sized … don't return a full database dump"* | [review-criteria](https://claude.com/docs/connectors/building/review-criteria) |

O post da Anthropic recomenda *"some combination of pagination, range selection, filtering, and/or truncation with sensible default parameter values"* ([Writing effective tools, 2025-09-11](https://www.anthropic.com/engineering/writing-tools-for-agents)).

### Resources e prompts: para que servem

- **Tools** são *"model-controlled"*.
- **Resources** são *"application-driven"*: o host decide como incluí-los, por exemplo num seletor de contexto ([resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)).
- **Prompts** são *"user-controlled"*, tipicamente slash commands ([prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts)).
- Uma tool pode devolver `resource_link`, que *"not guaranteed to appear in … resources/list"*.
- Na 2026-07-28, `resources/subscribe` foi substituído por `subscriptions/listen`. Roots, Sampling e Logging foram **depreciados** (SEP-2577); a migração sugerida para Roots é *"pass directories or files via tool parameters"*.

### 1.4 Suporte real dos clientes

A matriz oficial de clientes foi **removida** do site em 2026-05-27 (commit `2075a21`), e `/clients` agora redireciona para a introdução. A última versão é de 2026-05-26 ([`docs/clients.mdx` @ `87993a6`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/87993a68166cfec740ca4d6a99cbe661f7aed32c/docs/clients.mdx)):

| Cliente | Na matriz de 2026-05-26 | Doc do próprio cliente (2026-10) |
| --- | --- | --- |
| Claude Code | Resources, Prompts, Tools, Roots, Elicitation, Instructions, Discovery, DCR | Resources via `@server:proto://path`, e o Claude Code *"automatically provides tools to list and read MCP resources"*. Prompts viram `/servername:promptname (MCP)`. Suporta CIMD. Tool search vem ligado por padrão: só nomes e *server instructions* carregam no início, *"doesn't impose a fixed per-server tool cap"*. Descrições são cortadas em 4.096 caracteres (tools carregadas no início) ou 16.384 (via tool search). `_meta["anthropic/alwaysLoad"]` e `_meta["anthropic/requiresUserInteraction"]` existem. Atende `list_changed`. ([mcp](https://code.claude.com/docs/en/mcp)) |
| Claude Desktop | Resources, Prompts, Tools, Roots, Apps, DCR | Os apps hospedados expõem *"Tools, prompts, and resources"*, mas não suportam *"Resource subscriptions, Sampling, Advanced or draft capabilities"*. Auth segue as specs 2025-03-26, 2025-06-18 e **2025-11-25** (a 2026-07-28 não está listada). ([building](https://claude.com/docs/connectors/building)) |
| claude.ai | Resources, Prompts, Tools, Apps, CIMD, DCR | O mesmo que o Desktop. As anotações *"determine auto-permissions in Claude. Read-only tools can run without per-call confirmation, and destructive tools always prompt."* ([review-criteria](https://claude.com/docs/connectors/building/review-criteria)) |
| Cursor | Prompts, Tools, Roots, Elicitation, DCR | Hoje marca como suportados Tools, Prompts, **Resources**, Roots, Elicitation e Apps. Não cita annotations nem limite de tools. ([cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp)) |
| VS Code (Copilot) | Resources, Prompts, Tools, Discovery, Sampling, Roots, Elicitation, Instructions, Apps, CIMD, DCR, Tasks | Resources via "Add Context > MCP Resources"; prompts via `/<server>.<prompt>`. ([mcp-servers, 2026-10-14](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)) |
| ChatGPT | Tools, Apps, DCR, CIMD, Instructions | A doc só trata de tools. Para Apps, `readOnlyHint`, `destructiveHint` e `openWorldHint` são **"Required"** (`idempotentHint` é opcional). *"These hints only influence how ChatGPT or Codex frames the tool call … servers must still enforce their own authorization logic."* ([plugins/reference](https://developers.openai.com/plugins/reference), [api/docs/mcp](https://developers.openai.com/api/docs/mcp/)) |

O diretório da Anthropic exige *"Every tool must include a `title` and the applicable hint"* e nomes de tool com até 64 caracteres ([review-criteria](https://claude.com/docs/connectors/building/review-criteria)).

---

## 2. Scopes e tenant

### O que a spec espera

Fonte: [basic/authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), seções *Scope Selection Strategy* e *Scope Challenge Handling*.

- O servidor *SHOULD* mandar `scope` no `WWW-Authenticate` do `401`. Sem isso, o cliente usa *"all scopes defined in `scopes_supported`"* da Protected Resource Metadata. Esse `scopes_supported` *"is intended to represent the minimal set of scopes necessary for basic functionality"*; o resto vem por step-up.
- **Step-up:** `403` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"`. A recomendação é *"include all scopes required for the current operation in a single challenge"*. Acumular scopes é responsabilidade do cliente.
- O guia de segurança recomenda um *"progressive, least-privilege scope model"*, com um escopo inicial mínimo do tipo `mcp:tools-basic` ([security_best_practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices), seção *Scope Minimization*).

### `workers-oauth-provider` 1.2.3

Fontes: [README](https://github.com/cloudflare/workers-oauth-provider/blob/main/README.md), [docs/authorization-server.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md#scopes-and-step-up-authorization) e [docs/resource-servers.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/resource-servers.md), todas da v1.2.3.

- `scopesSupported` é o catálogo inteiro (RFC 8414). `requiredScopes` é o baseline do recurso (RFC 9728) e entra automaticamente no `401`.
- A lib **não aplica scopes**: *"`requiredScopes` is advertised, not enforced: the handler decides whether a token is sufficient"*. O `/authorize` decide o que conceder via `completeAuthorization({ scope })`.
- O handler recebe `ctx.auth = { token, audience, expiresAt?, scope, userId?, clientId? }` e `ctx.props`. `insufficientScope(ctx.auth, scopes)` monta o `403` correto.
- No `createMcpHandler` do `agents`, o provider entrega um contexto verificado com `scopes` e `props`. As tools leem `context.http.authInfo.scopes` e `getMcpAuthContext().props` ([`auth-context.ts`](https://github.com/cloudflare/agents/blob/main/packages/agents/src/mcp/server/auth-context.ts), [exemplo `mcp-worker-authenticated`](https://github.com/cloudflare/agents/blob/main/examples/mcp-worker-authenticated/src/server.ts)).
- **Step-up por tool no SDK v2:** desde a 2.1.0, `registerTool(name, { scopeChallenge: requireScopes("x:write") }, …)` responde `403 insufficient_scope` antes de invocar a tool. A tool desafiada *"remain[s] visible in their list operations"* ([docs/serving/authorization.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md), CHANGELOG 2.1.0). **Não verifiquei** se o `resource_metadata` do desafio sai certo quando o `authInfo` vem do `OAuthProvider` via `agents`, em vez do `requireBearerAuth` do SDK.

### Clientes na prática

- **Claude Code:** sem `oauth.scopes`, *"doesn't request the full `scopes_supported` catalog from automatically discovered authorization server metadata"*. Ele acrescenta `offline_access` quando o AS o anuncia. Num `403 insufficient_scope`, *"the call fails with a `needs additional permissions` message that names the scope"*, e o servidor aparece como precisando de auth em `/mcp`. Ou seja, o step-up exige reautenticar manualmente via `/mcp` ([mcp](https://code.claude.com/docs/en/mcp)).
- **Claude (apps hospedados):** *"include a `scope` parameter in the `WWW-Authenticate` header on your `401`. If you don't, Claude requests the scopes your protected resource metadata advertises"*. O CIMD só é usado se o AS anunciar `client_id_metadata_document_supported: true` **e** `"none"` em `token_endpoint_auth_methods_supported`; senão o Claude cai para DCR. Também: *"Scope what each user can reach with your service's own per-user permissions rather than with a per-tenant OAuth app"* ([authentication](https://claude.com/docs/connectors/building/authentication)).
- **GitHub MCP remoto:** usa *scope challenges* por chamada; *"all tools are available, and the server requests additional scopes on-demand"*. Com PAT clássico, ele **esconde** as tools sem scope ([scope-filtering.md](https://github.com/github/github-mcp-server/blob/main/docs/scope-filtering.md), v2.0.2).
- **ChatGPT:** tem `_meta["mcp/www_authenticate"]` em resultados de erro *"to trigger OAuth"* ([plugins/reference](https://developers.openai.com/plugins/reference)).

### Prender o grant a um tenant no `/authorize`

- `completeAuthorization({ request, userId, metadata, scope, props })`: os `props` são livres (*"Application-specific properties to include with API requests"*) e ficam cifrados no KV. Então o `/authorize` pode mostrar um seletor de Company e gravar `props: { userId, companyId }` ([`oauth-provider.ts`](https://github.com/cloudflare/workers-oauth-provider/blob/main/src/oauth-provider.ts), `CompleteAuthorizationOptions`). O `userId` não pode conter `:`.
- **Ponto de atenção:** `revokeExistingGrants` é `true` por padrão. Por isso, *"revokes existing grants for the same user, client, and resource"*. Se o usuário autoriza o mesmo cliente de novo escolhendo outra Company, o grant da primeira é revogado. Para clientes CIMD, a revogação vale só para o mesmo `redirect_uri`. `revokeExistingGrants: false` permite grants simultâneos ([authorization-server.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md#authorization-endpoint)).
- Não existe helper para alterar os `props` de um grant já emitido. Só o `tokenExchangeCallback` devolve `newProps`, e só no code exchange ou no refresh ([advanced-configuration.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/advanced-configuration.md#token-exchange-callback)). A lista de `OAuthHelpers` em `oauth-provider.ts` não tem um `updateGrant`.

### Como os servidores oficiais lidam com vários tenants

| Servidor | Modelo | Fonte |
| --- | --- | --- |
| **Linear** | **Um workspace por autenticação**: *"each workspace needs its own separate authentication context"*. Há a URL `/mcp/readonly`, e *"Clients that request `read` are granted read-only access"*. | [linear.app/docs/mcp](https://linear.app/docs/mcp) (2026-10-18) |
| **Notion** | A conexão dá acesso ao *"selected Notion workspace"*. A doc não descreve múltiplos workspaces. | [get-started-with-mcp](https://developers.notion.com/guides/mcp/get-started-with-mcp) |
| **Atlassian Rovo** | **O agente escolhe por argumento**: `getAccessibleAtlassianResources` lista os sites com `cloudId`, *"Required first call for any tool because every tool call needs a `cloudId`."* | [supported-tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/) |
| **Stripe** | No consentimento OAuth, *"You can grant access to one or more live mode accounts or sandboxes and set different permissions for each environment"*. Ao mesmo tempo, *"By default, Stripe MCP tools operate on the Stripe account associated with your OAuth session"*. Connected accounts usam o header `Stripe-Account` com agent API key (sem OAuth). | [docs.stripe.com/mcp](https://docs.stripe.com/mcp) |
| **Cloudflare** | `account_id` é **argumento**, *"auto-resolved when possible (single account)"*. A tool `whoami` devolve `user:<id>` ou `account:<id>` e é marcada como *profile tool* da OpenAI. As permissões são escolhidas no consentimento (*"downscope the token to selected permissions"*). | [cloudflare/mcp README](https://github.com/cloudflare/mcp) (push de 2026-10-13), [blog Code Mode MCP, 2026-02-20](https://blog.cloudflare.com/code-mode-mcp/) |
| **GitHub** | O token é do usuário, e o tenant (`owner`, `repo`) é argumento de cada tool. | [README v2.0.2](https://github.com/github/github-mcp-server) |
| **ChatGPT (cliente)** | Multi-account: *"connect more than one account to the same plugin"*. O modelo *"selects the relevant account … Each tool call uses the selected account's credentials"*. A profile tool (`whoami`/`get_profile`, `_meta["openai/profile"]: true`, com `outputSchema`) deve *"Return exactly one profile … Do not require the caller to supply a user ID, email, or account selector"*. | [plugins/build/auth](https://developers.openai.com/plugins/build/auth) |

---

## 3. Granularidade de tools

- **Anthropic, "Writing effective tools for agents" (2025-09-11):**
  - *"More tools don't always lead to better outcomes"*.
  - *"A common error we've observed is tools that merely wrap existing software functionality or API endpoints"*.
  - Exemplos: `search_contacts` em vez de `list_contacts`, e `schedule_event` em vez de três tools separadas.
  - Recomenda namespacing por serviço e por recurso, e um enum `response_format` (`concise`/`detailed`).
  - Recomenda IDs legíveis (*"`user_id`"*) e erros acionáveis (*"rather than opaque error codes"*).

  [Fonte](https://www.anthropic.com/engineering/writing-tools-for-agents).
- **Anthropic, "Building agents that reach production systems with MCP" (2026-04-22):**
  - *"Don't wrap your API into an MCP server one-to-one—group tools around intent"*, com o exemplo *"A single create_issue_from_thread tool beats get_thread + parse_messages + create_issue + link_attachment."*
  - *"Fewer, well-described tools consistently outperform exhaustive API mirrors."*
  - Tool search *"tends to cut tool-definition tokens by 85%+"*.

  [Fonte](https://claude.com/resources/articles/building-agents-that-reach-production-systems-with-mcp).
- **Diretório da Anthropic: separar leitura e escrita.**
  - *"A single tool that accepts both safe HTTP methods … and unsafe methods … is rejected."*
  - *"Ideally, split write operations further by action type: create, update, and delete."*

  [Fonte](https://claude.com/docs/connectors/building/review-criteria).
- **Cloudflare:**
  - A [página Tools](https://developers.cloudflare.com/agents/model-context-protocol/protocol/tools/) (2026-08-18) só orienta sobre descrições. Ela não trata de granularidade.
  - [Code Mode (2025-09-26)](https://blog.cloudflare.com/code-mode/): *"If you present an LLM with too many tools … it may struggle to choose the right one"*.
  - [Code Mode MCP (2026-02-20)](https://blog.cloudflare.com/code-mode-mcp/): a API inteira (mais de 2.500 endpoints) cabe em **duas tools**, `search()` e `execute()`, com cerca de 1.000 tokens, contra 1,17 milhão nativamente. O texto delimita: *"Code Mode solves context costs for a single API."* O modo exige sandbox no servidor, o Worker Loader.
- **GitHub MCP server v2.0.2:**
  - Usa **toolsets**: o padrão é `context, repos, issues, pull_requests, users`, e o README diz *"Enabling only the toolsets that you need can help the LLM with tool choice and reduce the context size"*.
  - `--read-only` / `X-MCP-Readonly` / URL `/readonly` deixam *"only offer read-only tools"*.
  - As tools são **consolidadas por entidade e modo**: `issue_read` com `method: get | get_comments | get_sub_issues | …`, e `issue_write` com `method: create | update`. Leitura e escrita ficam separadas.
  - As listas têm `perPage` (máximo 100) e `fields`, para reduzir a resposta.

  [README](https://github.com/github/github-mcp-server), [remote-server.md](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md).
- **Atlassian:** as tools são agrupadas em grupos de permissão `read_*`, `write_*` e `delete_*`; *"`delete_jira` is disabled by default"*. Há também `executeRead`, `executeWrite` e `executeDestructive`, que *"apply agent-level confirmation"* ([supported-tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/)).
- **Stripe:** usa poucas tools genéricas (`stripe_api_search`, `stripe_api_details`, `stripe_api_read` para GET e `stripe_api_write` para POST, PATCH, PUT e DELETE). Exige *"human confirmation before it takes certain `stripe_api_write` actions, such as refunds"* ([docs.stripe.com/mcp](https://docs.stripe.com/mcp)).
- **Limite de quantidade:** nenhuma fonte primária desta rodada fixa um número máximo. O Claude Code diz explicitamente que não há teto por servidor, e o modo `ENABLE_TOOL_SEARCH=auto` adia as tools quando as definições passam de 10% do contexto ([mcp](https://code.claude.com/docs/en/mcp)). As docs do Cursor e do VS Code consultadas não citam limite.

---

## 4. Testes

### Cliente MCP real, em processo

A doc oficial do SDK v2 ([docs/testing.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md), main de 2026-10-13) recomenda *"Drive your server through a real `Client`, in-process — no port, no socket, no mock transport"*:

```ts
const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
  fetch: (url, init) => handler.fetch(new Request(url, init)),
});
const client = new Client({ name: "test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
await client.connect(transport);
```

- A doc diz que *"a handler failure resolves as an ordinary result with `isError: true`, not a thrown error"*.
- `InMemoryTransport.createLinkedPair()` *"connects 2025-era instances only"*. Para a 2026-07-28, a doc indica `handler.fetch`.
- O `agents` testa o seu `createMcpHandler` da mesma forma: `MCPClientConnection` com `transport.fetch` apontando para `handler.fetch`, exercitando tools, prompts e resources nos modos `auto` e `legacy` ([`v2-lifecycle.test.ts`](https://github.com/cloudflare/agents/blob/main/packages/agents/src/tests/mcp/v2-lifecycle.test.ts)).

### Injetar identidade sem passar pelo OAuth (nível unitário)

- `StatelessMcpHandler.fetch(request, { authInfo })` aceita um `authInfo` explícito. Se também houver contexto verificado do provider e os `clientId` divergirem, lança *"Conflicting verified OAuth client identity"* ([`handler-stateless.ts`](https://github.com/cloudflare/agents/blob/main/packages/agents/src/mcp/server/handler-stateless.ts), v0.28.1; testado em [`handler-stateless.test.ts`](https://github.com/cloudflare/agents/blob/main/packages/agents/src/tests/mcp/handler-stateless.test.ts)).
- Os `props` lidos por `getMcpAuthContext()` vêm da opção `authContext` de `createMcpHandler`, ou de `ctx.props` do Worker.
- O lado cliente pode receber um token pronto com `authProvider: { token: async () => "…" }` ([docs/clients/machine-auth.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/machine-auth.md)).

### Obter um token real no `createTestHarness()`

- O `workers-oauth-provider` **não** tem helper do tipo `createAccessToken`. Os `OAuthHelpers` são `parseAuthRequest`, `completeAuthorization`, consent e upstream, CRUD de clientes, `listUserGrants`/`revokeGrant`, `unwrapToken`, `exchangeToken` (RFC 8693, que **exige um token de origem**) e `purgeExpiredData` ([`oauth-provider.ts`](https://github.com/cloudflare/workers-oauth-provider/blob/main/src/oauth-provider.ts)). A busca por `client_credentials` nas docs da lib não retornou nada.
- O teste oficial [`examples/split-workers/e2e.test.ts`](https://github.com/cloudflare/workers-oauth-provider/blob/main/examples/split-workers/e2e.test.ts) roda os dois Workers com `createTestHarness({ workers: [...] })` e faz o fluxo inteiro via `worker.fetch`, sem browser:
  1. Lê o `401` e extrai `resource_metadata`.
  2. Busca a metadata do AS.
  3. Registra um cliente por DCR (`token_endpoint_auth_method: "none"`).
  4. Faz `GET /authorize` com PKCE S256 e `redirect: "manual"`.
  5. Lê o `code` no `Location`.
  6. `POST /oauth/token` com `resource`.

  Depois testa leitura com `mcp:read`, `403 insufficient_scope` na escrita e novo token com `mcp:read mcp:write`. Funciona porque o `/authorize` do exemplo aprova direto (`// TODO: replace with your own logic to sign the user in`, em [`auth-server/index.ts`](https://github.com/cloudflare/workers-oauth-provider/blob/main/examples/split-workers/auth-server/index.ts)). Com Better Auth, o teste teria de fazer login antes para obter o cookie de sessão e então submeter o consentimento. **Não verifiquei** esse caminho.
- A página da Cloudflare "Test a Remote MCP Server" (2026-06-03) só cobre o Inspector e clientes; *"no content on automated testing"* ([guia](https://developers.cloudflare.com/agents/model-context-protocol/guides/test-remote-mcp-server/)).

### MCP Inspector CLI (smoke)

Fonte: [tools/inspector/cli](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli), docs 2026-07-28; pacote 2.11.0.

- Comandos:
  - `npx @modelcontextprotocol/inspector --cli <url> --transport http --method tools/list`
  - `--method tools/call --tool-name X --tool-arg k=v` ou `--tool-args-json '{…}'`
  - `--header` para o token, e `--format json`.
- **Exit codes:**

  | Código | Significado |
  | --- | --- |
  | `3` | auth (401/403) |
  | `4` | inalcançável |
  | `5` | `isError: true` ou tool inexistente |
  | `6` | `--strict` achou problema de portabilidade de schema |

- Em CI: *"`--stored-auth-only`: never start interactive OAuth … This is the flag CI wants."* Sem TTY, a CLI falha rápido com `auth_required`.

---

## Implicações para o ticket 23

1. **Anotações em toda tool**: `title`, `readOnlyHint`, `destructiveHint` e `openWorldHint: false` (SaaS fechado), mais `idempotentHint` quando couber. O diretório do Claude e o do ChatGPT as exigem, e o Claude as usa para auto-aprovar. Elas não substituem a revalidação de Member e role no Postgres, que já está decidida.
2. **Separar leitura de escrita**, e a escrita idealmente por ação (create, update, delete). Uma tool "genérica" com `method` que misture leitura e escrita é rejeitada no diretório da Anthropic. Agrupar por *intenção* em vez de espelhar o CRUD 1:1 é a orientação explícita da Anthropic; a "operação destrutiva fora do MCP" (por exemplo, apagar a Company) não aparece como regra em nenhuma fonte, então é escolha de produto.
3. **`tools/list` pode variar por autorização**, porque a spec permite filtrar por scope ou credencial. Isso dá base para um modo read-only (scope `read`, como faz o Linear) ou para esconder tools de owner de um employee. Nesse caso, `cacheScope` deve ser `"private"` (o padrão do SDK).
4. **Scopes**: a lib da Cloudflare só anuncia; quem aplica é a app, via `ctx.auth.scope`/`authInfo.scopes` ou `scopeChallenge` do SDK 2.1+ (a compatibilidade com o `agents` não foi verificada). No Claude Code, o step-up exige reautenticação manual em `/mcp`. Um baseline pequeno com step-up segue a spec, mas aumenta a fricção nos clientes atuais.
5. **Company ativa**: os `props` do `completeAuthorization` aceitam `companyId` escolhido no consentimento. Mas `revokeExistingGrants` (padrão `true`) revoga o grant anterior do mesmo usuário, cliente e recurso ao reautorizar para outra Company; para tokens simultâneos por Company é preciso `false`. Não há API para mudar os `props` de um token vivo. A prática varia: Linear e Notion prendem um workspace por conexão, e o ChatGPT suporta várias contas por plugin. Atlassian, Cloudflare e GitHub passam o tenant como argumento da tool (com `cloudId` ou `account_id`).
6. **`whoami` como profile tool**: OpenAI e Cloudflare usam o mesmo formato, sem argumentos, read-only, com id estável, `outputSchema` e `_meta["openai/profile"]: true`. É barato e serve de prova de identidade e Company nos testes.
7. **Resources e prompts são opcionais e de suporte desigual**: o ChatGPT só documenta tools, e a matriz oficial saiu do ar. Tudo o que o agente precisa deve existir como tool; resources e prompts são extras.
8. **Respostas**: usar `outputSchema` + `structuredContent` + texto JSON, paginação por parâmetro (cursor ou limite) e erros acionáveis com `isError: true`. Ficar bem abaixo de 25.000 tokens (o limite do Claude Code) e de cerca de 150.000 caracteres (o do claude.ai).
9. **Testes**: (a) unitário/integração das tools com `Client` + `StreamableHTTPClientTransport({ fetch: handler.fetch })` e `authInfo`/`authContext` injetados; (b) um teste no `createTestHarness()` do fluxo OAuth completo (DCR + PKCE + token), seguindo `split-workers/e2e.test.ts`, com login Better Auth antes do `/authorize`; (c) smoke com o Inspector CLI (`--header Authorization`, checando os exit codes 3, 4 e 5). Não existe atalho para cunhar token na lib.
10. **Clientes e versão**: os apps hospedados do Claude ainda declaram auth até a 2025-11-25. Manter `legacy: "stateless"` e DCR como fallback (conforme o 07) continua necessário. O CIMD só é usado pelo Claude se o AS anunciar `"none"` em `token_endpoint_auth_methods_supported`.
