# Ferramentas do MCP do Skeleton

Type: grilling
Status: resolved

## Question

Quais tools o servidor MCP do Skeleton expõe? Desde [Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md), a Reference App é outro repo; aqui só entra o que o Skeleton traz e o padrão que as apps seguem para acrescentar tools. A autenticação e a revalidação já estão decididas: Better Auth + `workers-oauth-provider` + `createMcpHandler`, tokens com `userId` e `companyId`, e toda tool revalida Member e role no Postgres ([Trocas na stack](13-stack-swaps.md)). As permissões seguem a tabela de [Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md). Pontos a fechar:

- **Skeleton**: o MCP já existe no Skeleton, com tools de Company e conta (por exemplo, `whoami`, listar Members), ou só a infraestrutura sem tools?
- **Granularidade**: uma tool por operação da API (CRUD por entidade) ou tools por tarefa do usuário ("o que está comigo", "mover Tarefa", "registrar o que fiz")? Leitura e escrita juntas ou separadas?
- **Lista do Skeleton**: conta, Companies, Members e convites. Quais entram, e quais ficam de fora (por exemplo, apagar a Company pelo MCP).
- **Company ativa**: o token é preso a uma Company escolhida no `/authorize`, ou o agente pode trocar de Company?
- **Formato**: resources e prompts além das tools; nomes e descrições das tools; paginação e tamanho das respostas.
- **Testes**: como o MCP é testado (cliente MCP contra o `createTestHarness()`), e se entra nos testes `@evidence`.

## Progresso do grilling

Pesquisas: [research/23-mcp-tools-practice.md](../research/23-mcp-tools-practice.md) e [research/23-openapi-to-mcp.md](../research/23-openapi-to-mcp.md).

Decidido com o usuário (rodadas 1 e 2):

- **O Skeleton tem MCP, e ele espelha a OpenAPI.** A app inteira pode ser usada só pelo MCP. As tools não têm lógica própria: cada uma chama a rota Hono correspondente dentro do Worker (`app.request` com a identidade no `env`, sem repassar o token do agente). Validação, Member, role e erros são os mesmos da SPA.
- **Token do usuário, não da Company** (revê o `companyId` do token de [Trocas na stack](13-stack-swaps.md)). O agente passa a Company em cada chamada, como a SPA, e enxerga todas as Companies do usuário. O consentimento depende só do login. Sair da Company corta o acesso porque a rota recusa quem não é Member; o `revokeGrant` fica para a exclusão da conta.
- **Tudo vai para o MCP, com opt-out explícito na rota** (`x-mcp: false`). O Skeleton começa com: apagar a Company, transferir a posse. Email, senha, exclusão da conta, login, cadastro e verificação são rotas do Better Auth, que exigem sessão de navegador, e ficam fora. Trocar o nome ganha rota própria (`PATCH /api/me`) e entra.
- **Escopos `read` e `write`**, derivados do verbo HTTP e escolhidos uma vez no consentimento. O `tools/list` esconde as tools de escrita de um token só `read`.
- **Anotações pelo verbo**: `GET` → `readOnlyHint`; `DELETE` → `destructiveHint`; `PUT` → `idempotentHint`.
- **Qualidade no CI**: o `factory:verify` falha se uma operação exposta não tiver `operationId`, `summary` e `description`, e compara o `tools/list` gerado com um snapshot commitado.
- **Gerador próprio e fino** no `pnpm generate` (que já chama `app.getOpenAPI31Document()`): grava a lista de tools (nome, descrição, schema, anotação, escopo, opt-out). Uma tool por operação no Skeleton; agrupar por tag fica para quando um produto crescer. Code Mode está fora (Dynamic Workers só no plano Paid), e Kubb `plugin-mcp` e `mcp-from-openapi` não foram escolhidos. Medir a CPU por request do `/mcp` no Free entra como critério de aceite.
- **Rodada 3**: o FastMCP do Python tem equivalente em TypeScript (`fastmcp` 4.23.2, `fromOpenAPI()`), mas ele usa uma credencial fixa para todos e a variante para Workers não tem auth; ver o adendo da pesquisa. O próprio FastMCP desaconselha espelhar a API sem curadoria, o que reforça a checagem de descrições.

## Answer

Decidido em 2026-10-18 com o usuário.

- **O Skeleton tem MCP, e ele espelha a OpenAPI.** Toda operação de `/api/*` vira uma tool, e a app inteira pode ser usada só pelo MCP. A tool não tem lógica própria: chama a rota Hono dentro do Worker (`app.request(path, init, env)`), com a identidade resolvida pelo `/mcp` no `env`, sem repassar o token do agente. Validação, Member, role e erros são os da SPA.
- **Token do usuário**: o token carrega só o `userId`, e o agente passa a Company em cada chamada, como a SPA. Isso revê o `companyId` no token de [Trocas na stack](13-stack-swaps.md). O consentimento depende só do login. Sair de uma Company corta o acesso porque a rota recusa quem não é Member.
- **Opt-out por rota** (`x-mcp: false`): o Skeleton começa com apagar a Company e transferir a posse. Email, senha, exclusão da conta, login, cadastro e verificação são rotas do Better Auth (exigem sessão de navegador) e ficam fora. Trocar o nome ganha rota própria (`PATCH /api/me`), que entra.
- **Escopos `read` e `write`**, derivados do verbo HTTP e escolhidos uma vez no consentimento; o `tools/list` esconde as tools de escrita de um token `read`. **Anotações pelo verbo**: `GET` → `readOnlyHint`, `DELETE` → `destructiveHint`, `PUT` → `idempotentHint`.
- **Gerador próprio** no `pnpm generate`, a partir de `app.getOpenAPI31Document()`: grava a lista de tools (nome pelo `operationId`, descrição, schema de entrada e de saída, anotação, escopo). Uma tool por operação no Skeleton; agrupar por tag fica para quando um produto crescer. Descartados: Code Mode (Dynamic Workers só no Paid), Kubb `plugin-mcp`, `mcp-from-openapi` e `fastmcp`.
- **Quem constrói**: a ponte inteira fica na base, em `platform/`, junto com o harness. Entram ali o `OAuthProvider`, o `/authorize` com consentimento e a escolha `read`/`write`, o `/mcp`, o gerador e o ponto único que resolve o usuário pelo cookie da SPA ou pelo token do MCP. Toda rota que a Factory criar depois já sai como tool. O `mcp?(server)` da `Feature` fica só para o que não sai da OpenAPI (resources, prompts, tools feitas à mão por um produto).
- **Respostas**: sucesso como `structuredContent` com o schema de resposta da OpenAPI; erro da API (4xx) como resultado `isError: true` com a mensagem legível. Toda rota de lista usa `limit` (padrão 50) e cursor, convenção que vai para o `AGENTS.md` de `app/`.
- **Só tools** no Skeleton, sem resources nem prompts.
- **Conexões**: a feature de conta (feita pela Factory) ganha a página "Conexões", que lista os agentes autorizados (app, data, `read` ou `write`) e revoga cada um. Trocar ou resetar a senha e apagar a conta revogam todos (`revokeGrant`).
- **Testes**: (1) no `factory:verify`, falha se uma operação exposta não tiver `operationId`, `summary` e `description`, e o `tools/list` gerado é comparado com um snapshot commitado, que aparece no diff do PR; (2) cliente MCP do SDK dentro do teste contra o Worker local: token `read` não vê as tools de escrita, a identidade chega à rota e um 4xx volta como `isError`; (3) um E2E com Playwright do fluxo completo (login, consentimento, token, chamada de tool); (4) smoke no preview e na produção, que confere o 401 com `WWW-Authenticate` no `/mcp`. As features não escrevem testes de MCP, e o MCP não entra nos testes `@evidence`.
- **Critério de aceite da base**: medir a CPU por request do `/mcp` no plano Free.
