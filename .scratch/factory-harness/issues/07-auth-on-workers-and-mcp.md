# Auth no Workers e MCP remoto autenticado

Type: research
Status: resolved

## Question

O **Better Auth** funciona bem no Cloudflare Workers hoje (com Hono, Drizzle e Neon; limitações de runtime, `nodejs_compat`, hashing de senha, sessões, plugin de organization/convites/roles)? Qual é a "lib/plugin da própria Cloudflare" que o usuário mencionou (ex.: `@cloudflare/workers-oauth-provider`, Agents SDK `McpAgent`, ou outra) e o que ela faz e não faz? Como expor um **servidor MCP remoto** no Worker (Agents SDK / `McpAgent`, transporte Streamable HTTP) autenticado pelo mesmo usuário da aplicação via OAuth? Recomende uma combinação concreta (ex.: Better Auth para a app + workers-oauth-provider para o MCP; ou Better Auth como OAuth provider para MCP), com fontes, e diga se a stack pedida deve mudar.

## Answer

O Better Auth (1.7.10) funciona no Workers com Hono, Drizzle e Neon. Os problemas graves de 2025 até o começo de 2026 (scrypt em JS puro estourando a CPU, `createRequire`, travamentos do ALS) foram corrigidos. Resta uma ressalva de custo: o scrypt nativo leva cerca de 120 ms de CPU, então login com senha exige o plano Workers Paid; a alternativa é magic link ou OTP via Resend. Há também um travamento de isolate ainda aberto (#11651).
A "lib da Cloudflare" é a `@cloudflare/workers-oauth-provider` 1.2.3. Ela é um authorization server OAuth 2.1 para MCP (CIMD, DCR, RFC 9728, tokens em KV), mas não autentica usuários, então complementa o Better Auth em vez de substituí-lo.
O `McpAgent` está deprecated. O caminho atual é `createMcpHandler` stateless com o MCP SDK v2 (especificação 2026-07-28).
Recomendação: um único Worker com Better Auth (app e organization), `OAuthProvider` da Cloudflare (`/authorize` lê a sessão do Better Auth e pede consentimento) e `createMcpHandler`.
Usar o Better Auth como authorization server MCP (`@better-auth/mcp`) ainda tem bugs no Workers (#10888, CIMD sem transporte para Workers).
Troca proposta: trocar `McpAgent` por `createMcpHandler` e adicionar workers-oauth-provider e KV. Decisão pendente: plano Paid ou login sem senha.

[pesquisa](../research/07-auth-on-workers-and-mcp.md)
