# 06: Ponte OpenAPI → MCP

Spec: [../spec.md](../spec.md)

**What to build:** um usuário conecta um agente de IA ao Product pelo `/mcp`: o cliente descobre a autorização pelo 401, o usuário faz login, consente com `read` ou `write`, e o agente chama `getMe` com a identidade do usuário. Toda rota de `/api/*` vira uma tool sem código extra, e o CI segura tools sem descrição ou mudanças não vistas no `tools/list`.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] `workers-oauth-provider` + `createMcpHandler`, CIMD e DCR ligados, `legacy: "stateless"`, `OAUTH_KV` do Product. Token só com `userId`.
- [ ] `/authorize` lê a sessão do Better Auth e mostra o consentimento com a escolha `read`/`write`.
- [ ] O ponto único de identidade aceita também o token do MCP.
- [ ] Gerador no `pnpm generate` sobre a OpenAPI composta: uma tool por operação (nome pelo `operationId`, descrição, schemas de entrada e saída, escopo e anotações pelo verbo), opt-out `x-mcp: false`, rotas do Better Auth fora.
- [ ] A tool chama a rota Hono dentro do Worker com a identidade no `env`; sucesso → `structuredContent`, 4xx → `isError: true`; o `tools/list` esconde escrita de um token `read`.
- [ ] O reset de senha passa a revogar todas as Connections (`revokeGrant`).
- [ ] O `verify` falha se uma operação exposta não tiver `operationId`, `summary` ou `description`, e compara o `tools/list` com um snapshot commitado (seam 6).
- [ ] Testes com o cliente MCP do SDK contra o Worker local: `read` não vê escrita, a identidade chega à rota, 4xx vira `isError`, 401 com `WWW-Authenticate` sem token (seam 3).
- [ ] E2E do fluxo completo: login, consentimento, token, chamada de `getMe` (seam 5).
- [ ] Critério medido no ticket 14: CPU por request do `/mcp` no Workers Free.
