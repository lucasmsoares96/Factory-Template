# Lista final de arquivos de harness

Type: grilling
Status: open
Blocked by: 21

## Question

Quais arquivos de harness o template entrega, onde fica cada um e o que diz? As convenções já estão em [Convenções de arquivos de harness](09-harness-conventions.md): sem `CLAUDE.md`, `AGENTS.md` na raiz e por pacote, skills em `.agents/skills` e `.claude/skills`, allowlist no CI por `settings:`/`--allowedTools`, MCPs headless e Playwright CLI + skill. O código da Factory (`.factory/`, workflows `factory-*`) está em [Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md). Pontos a fechar:

- **`AGENTS.md`**: quais diretórios ganham um (segundo o layout de [Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md)) e o conteúdo de cada um, incluindo a convenção para apps construídas sobre o Skeleton ([Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md)).
- **Skills próprias da stack** (por exemplo, criar endpoint Hono + OpenAPI + Kubb, criar migration, criar tool MCP, teste `@evidence`) × skills do Matt já presentes; quais das skills em `.agents/skills` hoje ficam no template público.
- **Subagents**, `.mcp.json` (local e CI), `.claude/settings.json` e hooks (por exemplo, `git-guardrails`).
- **Imagem do container** de execução local (`pnpm factory local NN`): base, ferramentas e como fica em dia com o `ubuntu-latest`.
- **Como cada arquivo é mantido**: o que a Factory pode editar sozinha e o que exige humano.
