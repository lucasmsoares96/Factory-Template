# Fronteira entre a base e o backlog da Factory

Type: grilling
Status: resolved

## Question

O que exatamente o usuário implementa à mão (a **base**) e o que vira issue `ready-for-agent` para a Factory, em que ordem essas issues são liberadas, e como as duas partes viram spec? É a última decisão antes do `to-spec` e do `to-tickets`. [Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md) traçou a linha por alto (base = harness, `platform/`, `factory:verify`, deploy e preview; Factory = cadastro, conta, Companies, convites), mas as peças decididas depois cruzam essa linha. Pontos a fechar:

- **Auth na base ou na Factory**: Better Auth, os DOs `PasswordHasher` e `RateLimiter` ([Medir o hash de senha num Durable Object no Free](20-do-password-hash-cpu.md)), o outbox de email do preview ([Segurança do CI do PR com código da Factory](19-pr-ci-security.md)) e a ponte do MCP, que já está na base e precisa de usuário logado para o E2E ([Ferramentas do MCP do Skeleton](23-reference-app-mcp-tools.md)). Onde termina a `platform/` e começa a feature `auth/` (telas de cadastro, login, verificação, reset)?
- **O que a base precisa para a Factory rodar e ser verificada**: uma app mínima com quais rotas, telas e testes, para que `factory:verify`, preview, smoke, prints `@evidence` e a ponte do MCP tenham algo real a exercitar.
- **Primeira issue da Factory**: um canário pequeno antes das features do Skeleton, ou o cadastro direto?
- **Ordem de liberação e bloqueios** das issues do Skeleton (auth → conta → Companies → convites?), e o que pode rodar em paralelo.
- **Forma da entrega**: uma spec só com duas partes, ou duas specs (harness + base, e PRD do Skeleton); onde moram os tickets da base (o usuário implementa com o Claude Code local: `.scratch/` ou GitHub `ready-for-human`?), e onde ficam os critérios de aceite da base já levantados (CPU do `/mcp`, pull da imagem contra `setup.sh`, permissões do token da Cloudflare, GHCR, environments no Free, login real no smoke).

Depois deste ticket, o mapa chega ao destino: o que resta é rodar `to-spec` e `to-tickets`.

## Answer

Decidido em 2026-10-19 com o usuário.

**Base** (o usuário, com o Claude Code local; tickets em `.scratch/factory-base/`):
- harness: `.factory/` (seams `Tracker`, `CodeHost`, `Agent`, `Verify`; Sandcastle; jobs `claim` → `work` → `publish`), os cinco workflows, os `AGENTS.md`, skills, `.claude/settings.json`, `.mcp.json`, imagem + `setup.sh`;
- `pnpm bootstrap` (Produção, Previews, Factory, `doctor`, `destroy`);
- `platform/`: Hono, banco, Better Auth, DOs `PasswordHasher` e `RateLimiter`, outbox e envio de email, ponte do MCP (`OAuthProvider`, `/authorize`, `/mcp`, gerador);
- **auth completa**, com telas e emails: cadastro, login, verificação de email, reset de senha;
- **fatia mínima**: `GET /api/me` (Hono + Zod + OpenAPI), hook do Kubb, página inicial logada com o nome, teste de integração do back, teste do front com MSW, E2E `@evidence` e a tool `getMe`. Nada de Company;
- CI: `factory:verify`, deploy, preview por PR, smoke;
- os critérios de aceite da base já levantados (CPU do `/mcp`, pull da imagem × `setup.sh`, `actions/checkout` com `USER 1001`, permissões do token da Cloudflare para Worker Preview, visibilidade do GHCR, environments e ruleset num privado Free, login real no smoke) entram nos tickets;
- **último ticket**: ADRs e docs em `docs/`, antes da primeira issue da Factory. Depois disso o `.scratch/` é apagado.

**Base pronta** = os três módulos com `doctor` verde, deploy de teste, PR de teste com preview e smoke, e os critérios medidos. Só então a Factory recebe a primeira issue, para que uma falha dela aponte para o harness.

**Skeleton** (a Factory, no Actions): PRD no GitHub como issue pai, com sub-issues `ready-for-agent` (a seção Testing Decisions dá os seams). Todas marcadas de uma vez, com dependências nativas; o agendador libera.
1. "Trocar o nome" (`PATCH /api/me` + tela), sozinha.
2. Depois do merge, em paralelo: Companies (criar e listar, Company ativa pela URL, renomear, roles, transferir a posse, apagar) e o resto da conta (trocar email, trocar senha, "Conexões").
3. Convites e apagar a conta, bloqueados por Companies (a exclusão da conta é recusada enquanto o usuário for Owner).

A granularidade das sub-issues fica para o `to-tickets`.

**Revisão de [Modelo de organização da Reference App](10-organization-model.md)**: no Skeleton, só com Owner e Employee, o antigo Owner vira **Employee** na transferência de posse (não Manager).

## Comments

**Rodada 1 (2026-10-19)**
- **Auth inteira na base**: Better Auth, DOs `PasswordHasher` e `RateLimiter`, outbox, envio de email e as telas de cadastro, login, verificação de email e reset de senha. A Factory começa pela conta.
- **Fatia mínima da base**: `GET /api/me` (Hono + Zod + OpenAPI), hook do Kubb, página inicial logada com o nome, teste de integração do back, teste do front com MSW, E2E `@evidence` e a tool `getMe` saindo do gerador. Nada de Company na base.
- **Primeira issue da Factory**: "trocar o nome" (`PATCH /api/me` + tela).
- **Duas specs**: a da base, com tickets locais em `.scratch/factory-base/` que o usuário implementa com o Claude Code, e o PRD do Skeleton no GitHub (issue pai + sub-issues `ready-for-agent`). Os critérios de aceite da base já levantados entram nos tickets da base.
- **ADRs e docs no fim**, depois da base pronta.

**Rodada 2 (2026-10-19)**
- **Base pronta = tudo**: os três módulos do bootstrap com `doctor` verde, deploy de teste, PR de teste com preview e smoke, e os critérios de aceite medidos. Só então a Factory recebe a primeira issue.
- **ADRs são o último ticket da base**, antes da primeira issue da Factory, que já trabalha com `docs/adr/`.
- **Ordem do backlog**: "trocar o nome" sozinha; depois do merge, Companies e o resto da conta (email, senha, "Conexões") em paralelo; convites e apagar a conta bloqueados por Companies (a exclusão da conta é recusada enquanto o usuário for Owner, [Modelo de organização da Reference App](10-organization-model.md)). Tudo marcado `ready-for-agent` de uma vez, com dependências nativas; o agendador libera. A granularidade fica para o `to-tickets`.
