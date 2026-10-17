# 07 — Auth no Workers e MCP remoto autenticado

Pesquisa feita em 2026-10-17, só com fontes primárias: docs e repositórios do Better Auth, da Cloudflare e do Hono, a especificação MCP e issues/PRs com comentários de mantenedores.

**Versões verificadas (npm / GitHub, 2026-10-17):**

| Pacote | Versão | Data |
| --- | --- | --- |
| `better-auth` / `@better-auth/oauth-provider` / `@better-auth/mcp` / `@better-auth/cimd` | 1.7.10 (1.8.0-beta.1 em pré-release) | 2026-10-15 |
| `@better-auth/utils` | 0.5.0 | 2026-07-25 |
| `@cloudflare/workers-oauth-provider` | 1.2.3 | 2026-10-07 |
| `agents` (Cloudflare Agents SDK) | 0.28.1 | 2026-10-13 |
| `@modelcontextprotocol/server` (MCP TS SDK v2) | 2.3.1 (peer exato de `agents@0.28.1`) | 2026-10-05 |
| `hono` | 4.13.13 | — |
| Especificação MCP | 2026-07-28 (a mais recente; existe também `draft`) | — |

---

## Resposta

**O Better Auth funciona no Cloudflare Workers hoje.** Com Hono, Drizzle e Neon, é um alvo documentado e testado. A suspeita do usuário estava certa em 2025 e no começo de 2026, mas está **parcialmente desatualizada**. Os problemas graves foram corrigidos: o scrypt em JS puro estourava o limite de CPU, havia um `createRequire` que quebrava o bundle, e o `AsyncLocalStorage` (ALS) travava. Hoje restam três ressalvas concretas:

1. **Custo do hash de senha.** O scrypt nativo, com os parâmetros do Better Auth, leva cerca de 120 ms de CPU (medição local). O limite do plano Workers Free é 10 ms. Por isso, **login por email e senha exige o plano Workers Paid**. A alternativa é um login sem senha (magic link ou email OTP via Resend).
2. **Um bug de travamento ainda aberto.** Se a primeira requisição de um isolate for cancelada, todas as requisições seguintes daquele isolate podem travar (#11651; a correção está no PR #11716, ainda aberto). Um bug irmão já foi corrigido na 1.7.8.
3. **Arestas no lado OAuth/MCP do Better Auth quando roda no Workers** (detalhes abaixo).

**A "lib da própria Cloudflare" é a `@cloudflare/workers-oauth-provider`.** Ela é um framework de *authorization server* OAuth 2.1: emite e valida tokens para clientes MCP e implementa CIMD, DCR, PKCE, RFC 9728 e RFC 8707, guardando os dados em KV. **Ela não autentica usuários.** A página `/authorize` é responsabilidade da aplicação, que precisa logar o usuário por conta própria. Ou seja, ela **não substitui o Better Auth; ela se encaixa nele**. Não existe plugin da Cloudflare para Better Auth: o pacote `better-auth-cloudflare` é comunitário, mantido por zpg6, e a documentação da Cloudflare não menciona Better Auth.

**Mudança importante no "MCP nativo da Cloudflare":** o `McpAgent` está **deprecated e congelado** desde o Agents SDK 0.20.0. Para servidores novos, a Cloudflare manda usar `createMcpHandler` (stateless) com `@modelcontextprotocol/server` v2, que segue a especificação MCP 2026-07-28.

### Combinação recomendada (um único Worker)

- **Better Auth**: identidade da aplicação, sessões em Neon via Drizzle e o plugin `organization` (Company, convites, roles). Montado no Hono em `/api/auth/*`.
- **`@cloudflare/workers-oauth-provider`, no formato `OAuthProvider`**: é o authorization server do MCP.
  - `apiRoute: "/mcp"`.
  - `defaultHandler` é o app Hono.
  - A rota `GET/POST /authorize` do Hono lê a sessão do Better Auth com `auth.api.getSession`. Sem sessão, redireciona para o login. Com sessão, mostra o consentimento e chama `completeAuthorization({ userId, props: { userId, organizationId } })`.
  - `clientIdMetadataDocumentEnabled: true` liga o CIMD, e o DCR fica ativo como fallback.
- **Agents SDK `createMcpHandler(createServer)`** como `apiHandler`. Ele recebe `authInfo` e `props` automaticamente do provider. Manter o padrão `legacy: "stateless"`, para continuar compatível com clientes MCP da geração 2025.
- **Configuração do Wrangler**: `compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"]` e um KV com binding `OAUTH_KV`.

Esse é exatamente o formato do exemplo oficial `cloudflare/agents/examples/mcp-worker-authenticated`, com o Better Auth no lugar do handler de login de exemplo.

A **alternativa B** é usar o próprio Better Auth como authorization server MCP (`@better-auth/mcp` + `jwt()` + `@better-auth/cimd`). Ela é tecnicamente possível e mais elegante, porque deixa um único lugar com usuários e tokens. Mas hoje ela tem três bugs ou lacunas específicos de Workers:

- O `requireMcpAuth` retorna 500 quando o authorization server e o servidor MCP estão no mesmo Worker (#10888, aberto).
- O `@better-auth/cimd` não traz transporte para Workers; só existe o de Node.
- Alguns fetches usam `redirect: "error"`, que o workerd não aceita (#11328, aberto).

Vale reavaliar a alternativa B quando o épico #11604 ("local JWKS for co-located OAuth and MCP") fechar.

---

## Trocas propostas

Cada item abaixo é uma decisão do usuário.

1. **Detalhar "MCP nativo da Cloudflare" como `agents/mcp/server` → `createMcpHandler` + `@modelcontextprotocol/server` 2.x, e não `McpAgent`.** Adicionar `@cloudflare/workers-oauth-provider` à stack do backend e um KV com binding `OAUTH_KV`. Fixar a versão exata do SDK MCP v2 que o `agents` declara como peer.
2. **Manter o Better Auth.** Não há motivo para trocá-lo. Ele cuida da identidade da app e da organização; a lib da Cloudflare cuida só dos tokens do MCP.
3. **Login: escolher entre (a) email e senha com o plano Workers Paid obrigatório (US$ 5/mês) e (b) login sem senha (magic link ou email OTP do Better Auth, via Resend)**, que cabe no plano Free. A opção (b) também elimina reset de senha do Skeleton. A medição de CPU foi feita fora do workerd (ver o achado 3).
4. **Domínio: a página `/authorize` do Worker precisa receber o cookie de sessão do Better Auth.** Isso favorece servir front e API no mesmo site (subdomínios do mesmo domínio, ou o mesmo Worker servindo os assets). Pages em `*.pages.dev` com a API em `*.workers.dev` atrapalha. Afeta os tickets 05 (preview) e 06 (stack).

---

## Achados detalhados

### 1. O Better Auth suporta Workers oficialmente

- O guia de instalação tem uma aba `cloudflare-workers` e diz: *"Better Auth uses AsyncLocalStorage for async context tracking. To enable this in Cloudflare Workers, add the `nodejs_compat` flag"*. A alternativa é `nodejs_als`, se só o ALS for necessário. Fonte: [installation.mdx, linhas 329–362](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/installation.mdx) / https://www.better-auth.com/docs/installation
- A integração com Hono monta o Better Auth com `app.all("/api/auth/*", (c) => auth.handler(c.req.raw))`, sem adapter, e tem uma seção "Cloudflare Workers" que exige `nodejs_compat`. Fonte: https://www.better-auth.com/docs/integrations/hono. O guia foi reescrito em 2026-08-12 (PR #10763).
- A documentação do Hono tem o exemplo "Better Auth on Cloudflare" **com a stack exata** pedida: Hono, Better Auth, Drizzle e Neon (`@neondatabase/serverless`). Último commit em 2025-09-07. Fonte: https://hono.dev/examples/better-auth-on-cloudflare ([fonte no repositório](https://github.com/honojs/website/blob/main/examples/better-auth-on-cloudflare.md))
- O repositório do Better Auth roda smoke tests E2E em Cloudflare/workerd: PR #10839 (2026-08-20) e PR #10847, que cobre inicialização concorrente de contexto assíncrono no workerd (2026-08-20).
- A Cloudflare usa o Better Auth como fixture de compatibilidade: `cloudflare/workers-sdk/fixtures/vitest-plugin-examples/module-resolution` importa `better-auth`, e `cloudflare/vinext` tem `tests/fixtures/ecosystem/better-auth`. A documentação da Cloudflare, porém, não menciona Better Auth: uma busca de código em `cloudflare/cloudflare-docs` não retornou nenhum resultado.

### 2. Histórico de problemas no Workers: o que era verdade e o que já foi corrigido

| Problema | Status | Fonte |
| --- | --- | --- |
| Sem suporte a Workers sem `nodejs_compat` | Fechado; `nodejs_compat` ou `nodejs_als` é requisito documentado | [#1375](https://github.com/better-auth/better-auth/issues/1375) (2025-02) |
| `createRequire` quebrando o carregamento no Workers | Corrigido | [#6665](https://github.com/better-auth/better-auth/issues/6665) (2025-12), [#9983](https://github.com/better-auth/better-auth/issues/9983) (1.7.0-beta.4, 2026-06) |
| Sign-up com email e senha estourando o limite de CPU (scrypt em JS puro do `@noble/hashes`) | Corrigido pelo PR #8685 (merge em 2026-04-01) e pela condição `workerd` no `@better-auth/utils` 0.4.1 (2026-05-27) | [#8860](https://github.com/better-auth/better-auth/issues/8860), [#9649](https://github.com/better-auth/better-auth/issues/9649) |
| Requisições travadas depois de uma inicialização de ALS interrompida | Corrigido na 1.7.8 (PR #11711) | [#10315](https://github.com/better-auth/better-auth/issues/10315), [release v1.7.8](https://github.com/better-auth/better-auth/releases/tag/v1.7.8) |
| Verificação de schema em runtime travando o isolate quando a primeira requisição é cancelada | **Aberto**; correção no PR #11716, aberto | [#11651](https://github.com/better-auth/better-auth/issues/11651) (2026-10-08) |
| Custo de cerca de 480 ms por requisição (router recriado) | Fechado; o mantenedor (bytaesu) não conseguiu reproduzir na 1.6.20 | [#10188](https://github.com/better-auth/better-auth/issues/10188) |
| Instância do `auth` em escopo de módulo quebrando | Fechado; o mantenedor não reproduziu com Hono + `nodejs_compat` | [#9140](https://github.com/better-auth/better-auth/issues/9140) |

### 3. Hash de senha e limite de CPU

- O Better Auth usa scrypt por padrão. A justificativa na doc: *"We decided to use `scrypt` because it's natively supported by Node.js"*. É possível trocar o algoritmo com `emailAndPassword.password.{hash,verify}`. Fonte: https://www.better-auth.com/docs/authentication/email-password (linha 434) e https://www.better-auth.com/docs/reference/security
- Conferi o pacote publicado `@better-auth/utils@0.5.0`: o `package.json` mapeia `./password` primeiro para a condição `workerd`, apontando para `dist/password.node.mjs`. Esse arquivo usa `scrypt` de `node:crypto` (assíncrono) com `N=16384, r=16, p=1, dkLen=64`. Isso confirma que, com `nodejs_compat`, o Workers usa o scrypt **nativo**, e não o fallback em JS puro. Fonte: o tarball do npm, inspecionado em 2026-10-17.
- O `node:crypto` do Workers implementa scrypt; o que ele **não** suporta é `argon2`/`argon2Sync`. Ou seja, o exemplo de Argon2 com `@node-rs/argon2` da doc do Better Auth não serve para Workers. Fonte: https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- Limites de CPU por requisição HTTP: **10 ms no Free; no Paid, 30 s por padrão, configurável até 5 min**. Fonte: https://developers.cloudflare.com/workers/platform/limits/#cpu-time. A própria doc observa que *"workloads that handle authentication … typically use 10-20 ms"*.
- **Medição local (indicativa, não feita no workerd):** `crypto.scryptSync` com os mesmos parâmetros levou **≈121 ms** por hash (Node v26.3.0, x86_64). Mesmo com uma margem grande, isso fica bem acima de 10 ms. Na issue #9649, um usuário relata `exceededCpu` no Workers Free, mas ainda com o caminho em JS puro. **Não encontrei medição primária do scrypt nativo dentro do workerd.**

### 4. Instanciação, Drizzle e Neon

- O exemplo do Hono cria o `auth` **por requisição** (`auth(c.env)`, que chama `neon(env.DATABASE_URL)` e `drizzle(sql)`). A Cloudflare documenta `import { env } from "cloudflare:workers"` para acessar bindings em escopo global. Isso permite criar uma única instância por isolate. Fonte: https://developers.cloudflare.com/workers/runtime-apis/bindings/#importing-env-as-a-global. A doc do Better Auth usa esse import no exemplo com D1 ([concepts/database](https://www.better-auth.com/docs/concepts/database)).
- Trade-off: a instância por isolate evita recriar o objeto a cada requisição, mas é justamente o padrão afetado por #10315 (corrigido) e #11651 (aberto). Recomendação: **usar `better-auth` ≥ 1.7.8 e acompanhar o PR #11716**.
- Em ambientes sem CLI, como o Workers, as migrations do Better Auth podem rodar programaticamente (`getMigrations`). Com Drizzle, o normal é gerar o schema (`npx auth generate`) e migrar com o drizzle-kit. Fonte: concepts/database.mdx, linha 51.
- Transações: *"The Drizzle and Prisma adapters use transactions only when you pass `transaction: true`"*. Elas são usadas, por exemplo, para invalidar o token de reset, revogar sessões e trocar a senha de forma atômica. Fonte: email-password.mdx, linha 398. **Não verifiquei aqui** se o driver Neon escolhido (HTTP ou WebSocket) suporta as transações que o adapter abre; ver Riscos.

### 5. O plugin organization (Company, convites, roles)

- O plugin cobre organizações, organização ativa, convites (`sendInvitationEmail`, aceitar, rejeitar, cancelar), membros, troca de role, controle de acesso e teams. Fonte: https://www.better-auth.com/docs/plugins/organization
- Não encontrei limitação específica de Workers nas issues nem na documentação. O envio de email do convite é um callback da aplicação, que pode chamar o Resend.

### 6. `@cloudflare/workers-oauth-provider`: o que faz e o que não faz

Fontes: [README](https://github.com/cloudflare/workers-oauth-provider) e [docs/](https://github.com/cloudflare/workers-oauth-provider/tree/main/docs), v1.2.3 de 2026-10-07.

**O que faz:**

- Implementa um authorization server OAuth 2.1 para APIs HTTP e servidores MCP no Workers, seguindo *"MCP authorization 2026-07-28, OAuth 2.1, RFCs 6750, 7009, 7591, 7636, 8414, 8693, 8707, 9207, 9728, plus Client ID Metadata Documents"*.
- Oferece dois formatos:
  - **Split (recomendado)**: `OAuthAuthorizationServer` + `OAuthResourceServer`, com validação via Service Binding.
  - **`OAuthProvider`**: um único Worker, *"fully supported for one Worker that is both the authorization server and its only resource"*.
- Guarda tudo em KV (`OAUTH_KV`). Tokens, codes e secrets ficam só como hash; os `props` são cifrados com uma chave que só o portador do token consegue desembrulhar ([storage-schema.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/storage-schema.md)).
- Tem CIMD nativo no Workers. Para isso exige `global_fetch_strictly_public`, *"necessary for SSRF protection"* ([authorization-server.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md)). Também tem DCR, opcional via `clientRegistrationEndpoint`.
- Traz helpers de consentimento contra *confused deputy* e framing: `beginConsent`, `approveConsent` (com cookie `__Host-`) e `frame-ancestors 'none'` ([upstream-sign-in.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/upstream-sign-in.md)).
- Tem `listUserGrants` e `revokeGrant`, que confirmei nos tipos do pacote publicado. Servem para revogar o acesso MCP quando o usuário sai da Company.
- Pode aceitar tokens de outro issuer via `validateToken` customizado, mas *"at your own risk"* ([resource-servers.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/resource-servers.md#another-issuer-at-your-own-risk)).

**O que não faz:**

- Não loga usuários nem gerencia contas, sessões ou organizações: *"/authorize is yours: parseAuthRequest(), sign the user in and ask for consent, completeAuthorization()"*.
- Não aplica scopes: *"the library advertises the required scopes but doesn't enforce them"*. O handler precisa checá-los em `ctx.auth.scope`.
- O replay store usa KV e é *"best effort … because KV is eventually consistent"*. `accessTokenTTL` precisa ser ≥ 60 s *"because of KV limits"* ([advanced-configuration.md](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/advanced-configuration.md)).

**Segurança:** dois advisories em 2025-05-01: bypass de PKCE por downgrade (GHSA-qgp8-v765-qxx9) e falta de validação de `redirect_uri` (GHSA-4pc9-x2fx-p7vj). Nenhum advisory publicado em 2026.

**O que a doc da Cloudflare diz** em [MCP › Authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/): a biblioteca pode ser usada de quatro formas, incluindo *"Bring your own OAuth Provider"* e *"Your Worker handles authorization and authentication itself"*. Os parceiros listados são Stytch, Auth0, WorkOS e Descope. Better Auth não aparece.

### 7. Cloudflare Agents SDK: o `McpAgent` está deprecated

- *"Agents SDK v0.20.0 deprecates … `McpAgent`. It is deprecated and feature-frozen. Migrate at your earliest convenience. No removal version is announced."* Fonte: [Migrate to MCP SDK v2](https://developers.cloudflare.com/agents/model-context-protocol/guides/migrate-to-mcp-sdk-v2/)
- *"Use `createMcpHandler` for a new stateless server."* Os templates de deploy rápido *"still use the deprecated `McpAgent` path. Do not use that path for a new server."* Fonte: [Build a Remote MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- O transporte é Streamable HTTP. O handler v2 *"creates one server for each MCP request"*. O padrão `legacy: "stateless"` atende clientes antigos em tools, resources e prompts, mas sem sessão, sem GET/DELETE e sem sampling, elicitation ou roots empurrados pelo servidor. `legacy: "reject"` aceita só o protocolo 2026-07-28.
- Integração de auth: *"A compatible `@cloudflare/workers-oauth-provider` supplies verified standard `AuthInfo` to SDK v2 callbacks at `context.http.authInfo`"*. Os `props` da aplicação ficam disponíveis via `getMcpAuthContext()`. O handler *"does not derive [authInfo] from request headers or verify access tokens"*; quem verifica é o provider, ou outro wrapper que passe `authInfo`. Fonte: [Handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- O exemplo oficial [`examples/mcp-worker-authenticated`](https://github.com/cloudflare/agents/tree/main/examples/mcp-worker-authenticated) combina `createMcpHandler` + `OAuthProvider` + `OAUTH_KV` + `nodejs_compat` e encaminha `/mcp`, `/authorize`, `/oauth/*` e `/.well-known/*` para o Worker antes dos assets.
- Origin e Host: em domínio customizado, configurar `allowedHostnames` e `allowedOriginHostnames` explicitamente.

### 8. Especificação MCP 2026-07-28: autorização

Fonte: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization. Versões existentes no repositório: 2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25, 2026-07-28 e draft.

- O servidor MCP é um *OAuth 2.1 resource server*. O authorization server *"may be hosted with the resource server or a separate entity"*.
- MCP servers **MUST** implementar RFC 9728 (Protected Resource Metadata) e devem responder 401 com `WWW-Authenticate` apontando para ela. **SHOULD** incluir `scope` nesse header.
- Authorization servers **SHOULD** suportar CIMD. O DCR *"is deprecated and retained for backwards compatibility"* (**MAY**).
- Clientes **MUST** enviar `resource` (RFC 8707). Servidores **MUST** validar que o token foi emitido para eles (audience) e **MUST NOT accept or transit any other tokens**. Isso proíbe repassar o cookie de sessão do Better Auth, ou o token de outro serviço, ao servidor MCP.
- Escopo insuficiente: **SHOULD** responder 403 com `error="insufficient_scope"` e todos os scopes necessários num único desafio. O cliente faz step-up.

### 9. Better Auth como authorization server do MCP (alternativa B)

- `@better-auth/mcp`, construído sobre `@better-auth/oauth-provider`, faz a app virar authorization server e resource server para MCP. Ele requer o plugin `jwt()`, que fornece a JWKS. Para o perfil 2026-07-28, deve ser combinado com `@better-auth/cimd`. *"Better Auth never enables DCR implicitly."* Fonte: https://www.better-auth.com/docs/plugins/mcp
- `requireMcpAuth` verifica o JWT localmente pela JWKS (assinatura, `iss`, `aud`, `exp`, DPoP) e devolve 401 ou 403 nos formatos das RFCs 9728 e 6750. É compatível com o `createMcpHandler` do SDK v2.
- **Lacunas específicas de Workers (verificadas em 2026-10-17):**
  - **#10888 (aberto, labels `target: patch, platform`):** com authorization server e servidor MCP no mesmo Worker, o `requireMcpAuth` busca `${baseURL}/jwks` por HTTP. Esse fetch para o próprio Worker falha, e **toda requisição com token válido retorna 500**. O contorno publicado na issue é usar `verifyJwsAccessToken` com `jwksFetch` em processo e montar o desafio à mão. No `main` de 2026-10-17, `McpProtectedRequestHandlerOptions` ainda só aceita `jwksUrl` (conferi `packages/mcp/src/handler.ts`). O épico [#11604](https://github.com/better-auth/better-auth/issues/11604) (aberto) acompanha a correção.
    - Contexto da Cloudflare: sem `global_fetch_strictly_public`, um fetch para o próprio zone *"[is] routed to the zone's origin server, ignoring any Workers"*. Com a flag, ele *"will loop back to the 'front door' … possibly even looping back to the same Worker"*. Fonte: [compat flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public). **Não verifiquei** se ligar essa flag resolve o #10888.
  - **CIMD no Workers:** o `@better-auth/cimd` só exporta `.` e `./node`. A doc exige que *"Bun, Deno, Workers … must inject an equivalent transport that resolves each hostname once, rejects RFC 6890 special-use addresses, pins the approved address … and refuses redirects"*. Fonte: https://www.better-auth.com/docs/plugins/cimd. No Workers não há controle de DNS nem de pinning. A doc **não diz** se `fetch` com `global_fetch_strictly_public` satisfaz esse contrato; nisso ela é omissa.
  - **#11328 (aberto):** o `oauth-provider` usa `redirect: "error"` no back-channel logout e na busca de `jwks_uri` para `private_key_jwt`. O workerd rejeita essa opção. Para clientes MCP públicos comuns isso não importa, mas mostra que o caminho OAuth do Better Auth é menos exercitado no Workers.
  - **#10856 (aberto):** as entradas de resource server não conseguem usar a JWKS em processo.
- **Advisories recentes do Better Auth:** há vários, inclusive no `oauth-provider`. Exemplos: GHSA-p2fr-6hmx-4528 (2026-05-31), *"Access tokens can target APIs the user did not authorize"*; e GHSA-965c-763c-88jm (crítico, 2026-09-30). A cadência é alta, então manter dependências atualizadas é obrigatório. Fonte: https://github.com/better-auth/better-auth/security/advisories

### 10. Comparação das combinações

| Critério | **A: Better Auth + workers-oauth-provider + `createMcpHandler`** (recomendada) | **B: Better Auth `mcp()` + `requireMcpAuth` + `createMcpHandler`** |
| --- | --- | --- |
| Identidade da app e organização | Better Auth | Better Auth |
| Emissão de tokens MCP | Lib da Cloudflare (tokens opacos em KV) | Better Auth (JWT, tabelas `oauth*` no Postgres) |
| Funciona hoje no mesmo Worker | Sim; é o exemplo oficial | Só com contorno para o #10888 |
| CIMD no Workers | Nativo (`global_fetch_strictly_public`) | Exige escrever um transporte próprio; o contrato não está claro no Workers |
| DCR (clientes antigos: Cursor, Claude Code antigo) | Opcional (`clientRegistrationEndpoint`) | Opcional (`allowDynamicClientRegistration`) |
| Página de consentimento | Feita no Hono/React com os helpers da lib | Feita na app com `consentPage` do Better Auth |
| Fonte da verdade de tokens | **Duas**: sessões no Postgres e grants MCP no KV | **Uma** (Postgres) |
| Revogação ao remover membro | Chamar `listUserGrants` e `revokeGrant` | Nativa no Better Auth |
| Integração com `authInfo` do Agents SDK | Automática | Manual: converter claims em `AuthInfo` |

### 11. Pacote comunitário `better-auth-cloudflare`

- Mantido por zpg6, não pela Cloudflare (v0.4.1, 592 estrelas, último push em 2026-10-12). Integra Better Auth com D1, Hyperdrive, KV (secondary storage), R2, geolocalização e IP da Cloudflare, e traz um CLI. Fonte: https://github.com/zpg6/better-auth-cloudflare
- É provavelmente a origem da impressão de que "a Cloudflare tem lib para isso". **Não é necessário** para a stack pedida (Neon + Drizzle). Também não é da Cloudflare.

---

## Riscos em aberto

1. **Duas fontes de verdade (combinação A).** Remover um membro da Company ou apagar o usuário no Better Auth não revoga os grants MCP no KV automaticamente. Mitigações:
   - Guardar só `userId` e `organizationId` nos `props`.
   - Revalidar membership e role no Postgres a cada chamada de tool.
   - Chamar `revokeGrant` nos hooks do Better Auth.

   O KV é eventualmente consistente, então a revogação não é instantânea em todas as regiões.
2. **Cookies e domínios.** A página `/authorize` no Worker precisa ver a sessão do Better Auth. Com o front no Pages (outro origin), é preciso configurar `trustedOrigins`, CORS com `credentials` e talvez cookies entre subdomínios (https://www.better-auth.com/docs/concepts/cookies).

   O preview por PR (ticket 05) agrava o problema: cada preview tem uma URL diferente. Isso afeta `trustedOrigins`, o `issuer` e o `resource` do MCP, que precisa ser uma URL HTTPS canônica e bater com o `aud`.
3. **Suporte dos clientes MCP ao protocolo 2026-07-28.** Não verifiquei quais clientes (Claude Code, Cursor etc.) já falam 2026-07-28 ou suportam CIMD. Por isso: manter `legacy: "stateless"`, não usar `"reject"`, e ligar DCR como fallback. A doc do Better Auth cita Cursor e versões antigas do Claude Code como clientes que dependem de DCR.
4. **#11651 ainda aberto.** Um isolate pode travar se a primeira requisição for cancelada. Acompanhar o PR #11716 e atualizar quando sair.
5. **CPU no plano Free.** O número de 121 ms é uma medição local em Node, não no workerd. Validar com `wrangler tail` ou Workers Logs no primeiro deploy do Skeleton antes de fechar a decisão de plano.
6. **Transações com o driver Neon.** Confirmar no ticket 06 qual driver Neon e qual configuração do Drizzle suportam `transaction: true` do adapter do Better Auth no Workers (HTTP, WebSocket ou Hyperdrive). Não verifiquei aqui.
7. **Testes E2E do fluxo OAuth do MCP.** O fluxo envolve browser, consentimento e PKCE, então pede um cliente de teste. A lib da Cloudflare tem um teste E2E em workerd no exemplo `split-workers`, que pode servir de modelo. É assunto do ticket 08.
8. **Ritmo de advisories.** O Better Auth publicou mais de 10 advisories altos ou críticos entre maio e setembro de 2026, e a lib da Cloudflare teve 2 em 2025. O template precisa de atualização automática de dependências (Renovate ou Dependabot).
9. **Alternativa B no futuro.** Quando #10888, #11604 e um transporte CIMD para Workers forem resolvidos, B passa a ter um custo operacional menor (uma fonte de verdade, sem KV). Reavaliar antes de congelar a spec, se a data de implementação for distante.
