# Ferramentas do MCP da Reference App

Type: grilling
Status: open

## Question

Quais tools o servidor MCP expõe, e quais delas ficam no Skeleton? A autenticação e a revalidação já estão decididas: Better Auth + `workers-oauth-provider` + `createMcpHandler`, tokens com `userId` e `companyId`, e toda tool revalida Member e role no Postgres ([Trocas na stack](13-stack-swaps.md)). As permissões seguem a tabela de [Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md). Pontos a fechar:

- **Skeleton**: o MCP já existe no Skeleton, com tools de Company e conta (por exemplo, `whoami`, listar Members), ou só a infraestrutura sem tools?
- **Granularidade**: uma tool por operação da API (CRUD por entidade) ou tools por tarefa do usuário ("o que está comigo", "mover Tarefa", "registrar o que fiz")? Leitura e escrita juntas ou separadas?
- **Lista da Reference App**: Projects, Tarefas (criar, editar, mover, atribuir, Dependências), Sprints, Teams, comentários, anexos e métricas de tempo. Quais entram, e quais ficam de fora (por exemplo, apagar Project ou Company pelo MCP).
- **Company ativa**: o token é preso a uma Company escolhida no `/authorize`, ou o agente pode trocar de Company?
- **Formato**: resources e prompts além das tools; nomes e descrições das tools; paginação e tamanho das respostas.
- **Testes**: como o MCP é testado (cliente MCP contra o `createTestHarness()`), e se entra nos testes `@evidence`.
