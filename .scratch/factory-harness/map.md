# Map: Factory Template — harness, Skeleton e Reference App

Type: wayfinder:map

## Destination

Duas specs prontas para implementar: (1) **spec do harness + Skeleton**: motor da Factory, Stages, agendador de Blocked Issues, preview por PR, prints no PR, testes, arquivos de harness, Strip e bootstrap; (2) **PRD da Reference App** quebrado em issues `ready-for-agent` no GitHub, liberadas só depois que o harness estiver implementado, para a própria Factory construí-las como teste de aceitação.

## Notes

- **Tracker deste esforço: Markdown local** (`.scratch/factory-harness/`), seguindo as convenções de `.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md`. O GitHub Issues fica reservado para trabalho que a Factory executa; só o backlog final da Reference App vai para lá. `docs/agents/issue-tracker.md` continua apontando para o GitHub.
- `.scratch/` é commitado durante o trabalho; no fim, o que tem valor duradouro vira ADR/docs em `docs/` e o `.scratch/` é apagado antes de publicar o template.
- Achados de pesquisa: `.scratch/factory-harness/research/<NN>-<slug>.md`, com fonte primária citada em cada afirmação.
- Vocabulário: `GLOSSARY.md` na raiz (Factory, Template, Reference App, Skeleton, Strip, Stage, Merge Gate, Escalation, Blocked Issue).
- Skills a consultar: `grilling` + `domain-modeling` para tickets de grilling; `research` para tickets de pesquisa; `codebase-design` para fronteiras de módulo; `to-spec` e `to-tickets` no fim.
- Toda escolha técnica deve ser checada na **documentação oficial mais recente** (outubro de 2026), registrando versão e data.

### Decisões tomadas no charting

- **Template público**: nada fixo no código; tudo via secrets/variáveis; precisa de bootstrap guiado.
- **Reference App vem dentro do template** como exemplo; um comando de Strip remove-a e deixa o Skeleton verde. Skeleton = stack ponta a ponta + cadastro + criação de Company + deploy + testes. Sai no Strip: Teams, Manager, Pipelines, Projects, Tarefas, Sprints, registros de tempo, anexos.
- **Portões humanos**: o humano marca a issue como pronta (`ready-for-agent`) e faz o merge (Merge Gate). Deploy automático na `main`. Preview por PR obrigatório (ainda não existe).
- **Stages**: Exploration → Development → E2E → Review; falha em E2E ou Review volta para Development. Limite de **5 voltas**, depois Escalation (PR em draft + comentário na issue + label `ready-for-human`).
- **Concorrência**: issues prontas rodam em paralelo, cada uma no seu branch/PR; Blocked Issues (dependência nativa do GitHub) só começam quando todos os bloqueadores forem mergeados; um agendador dispara as destravadas a cada merge.
- **Review**: só o Review stage interno, antes de abrir o PR. O `claude-code-review.yml` atual sai.
- **Portabilidade**: `AGENTS.md` é a fonte da verdade (Claude atual lê nativamente); instruções e skills portáveis; o motor da Factory é Claude Code.
- **MCP**: a Reference App expõe um servidor MCP remoto no Worker, autenticado. Suspeita do usuário: Better Auth não funciona bem no Workers e existe lib da Cloudflare para isso; verificar.
- **Stack é negociável**: a pesquisa pode propor troca; cada troca vira decisão do usuário.
- **Idioma**: harness, código, commits, PRs e `AGENTS.md` em inglês; mapa/tickets em português; UI da Reference App em português, sem i18n.
- **Portabilidade de forja**: preferir sempre a opção mais simples de migrar do GitHub para outra forja (por exemplo, Forgejo). Lock-in em recurso exclusivo do GitHub só com justificativa. O usuário já tem um Forgejo auto-hospedado.
- **100% gratuito**: a infra da app (Workers Free, KV, R2, Neon Free, Resend Free) e a forja não podem custar nada; o Claude da Factory fica fora da regra e domínio próprio é opcional. Peça que só funciona em plano pago precisa de alternativa gratuita. Decidido em [Trocas na stack](issues/13-stack-swaps.md).
- **Workflow dinâmico** (se for o motor): JavaScript pronto para executar, sempre com paralelismo = 1.

### Stack pedida

- Frontend: TypeScript, React, shadcn/ui, Kubb, TanStack Query, TanStack Form, Cloudflare Pages
- Backend: TypeScript, Hono, Zod, OpenAPI, Swagger UI no Hono, MCP nativo da Cloudflare, Better Auth, Cloudflare Workers
- Banco: Neon Postgres, Drizzle
- CI/CD: GitHub Actions com `wrangler deploy`
- Email: Resend

## Decisions so far

<!-- one line per resolved ticket: [title](issues/NN-slug.md): gist -->

- [Sandcastle em runner hospedado do GitHub](issues/01-sandcastle-hosted-runner.md): roda em `ubuntu-latest` com `noSandbox()` (exemplo oficial no próprio repo do Sandcastle); é biblioteca, então Stages, limite de voltas, PR e Escalation ficam por nossa conta; PR com `GITHUB_TOKEN` exige PAT/GitHub App para disparar outros workflows.
- [Prints anexados ao PR](issues/04-screenshots-in-pr.md): branch órfão + links `blob/...?raw=true` funcionam com qualquer token e respeitam repo privado; `gh --attach` (≥ 2.99.0) só com PAT/OAuth; R2/gist vazam prints de repo privado; prints via Playwright `@evidence` contra o preview, num comentário único editado a cada volta.
- [Dynamic workflow headless no GitHub Actions](issues/02-dynamic-workflow-headless.md): roda via `claude -p` num step (não via `claude-code-action`, que sai na primeira `result`); paralelismo 1 com `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=1`; disparo depende do modelo, então o job verifica no `stream-json` que o `Workflow` foi chamado; research preview, pede spike; fallback é orquestrador TS com Agent SDK.
- [Auth no Workers e MCP remoto autenticado](issues/07-auth-on-workers-and-mcp.md): Better Auth 1.7.x funciona no Workers (problemas antigos corrigidos; um bug aberto). A "lib da Cloudflare" é `workers-oauth-provider`, que só emite tokens do MCP e complementa o Better Auth. `McpAgent` está deprecated: usar `createMcpHandler`. Hash de senha (~121 ms de CPU) estoura o plano Free, então é preciso escolher entre plano Paid e login sem senha.
- [Gatilho por label e agendador de Blocked Issues](issues/03-trigger-and-scheduler.md): `issues: labeled` (`ready-for-agent`) + `workflow_dispatch`, concorrência por issue, guard que exige todos os bloqueadores `closed`+`completed` (lista `blocked_by`, não o summary) e cria o ref `factory/issue-N` como trava. O agendador escuta `issues: closed` e despacha via `gh workflow run` com o próprio `GITHUB_TOKEN`. O PR precisa sair por token de App (Claude App ou App própria), senão o CI espera aprovação. Push em `.github/workflows/` falha com o token da Claude App.
- [Convenções de arquivos de harness](issues/09-harness-conventions.md): sem nenhum `CLAUDE.md` (o Claude ≥ 2.1.277 só lê `AGENTS.md` nativamente quando não existe `CLAUDE.md`). `AGENTS.md` na raiz e por pacote; skills em `.agents/skills` (Codex) e `.claude/skills` (Claude). No CI, `permissions.allow` do `.claude/settings.json` é ignorado: a allowlist vai em `settings:` ou `--allowedTools`. MCPs headless: Cloudflare Docs, Context7, shadcn, Cloudflare API (somente leitura), Neon (somente leitura). Para E2E e prints, Playwright CLI + skill em vez do MCP.
- [Testes de integração e E2E para esta stack](issues/08-integration-and-e2e-testing.md): back com `createTestHarness()` do wrangler (o `vitest-pool-workers` está deprecated), Postgres local em container (conexão por `pg` direto, revista em [Trocas na stack](issues/13-stack-swaps.md)) e Resend mockado por MSW. Front com Vitest Browser Mode + handlers MSW gerados pelo Kubb. E2E com Playwright na stack local. Preview, Neon e Resend reais (inbox `*.resend.app`) ficam só no smoke pós-deploy. Isolamento por dados próprios em cada teste; `testUtils()` do Better Auth. Conflito de versão: Kubb `msw ^2` × MSW para Workers `>=3`.
- [Stack segundo a documentação oficial atual](issues/06-stack-official-docs.md): a stack continua válida, com 7 trocas propostas (T1–T7), que viram decisão em "Trocas na stack": Pages → Workers + Static Assets; um único Worker (SPA + Hono em `/api/*`); Hyperdrive + `pg` (revisto: `pg` direto); Drizzle estável × v1 RC; shadcn com Base UI; `react-email` 6; adicionar TanStack Router. Hono + zod-openapi exigem Zod 4; Kubb v5, TanStack, Resend, pnpm e Turborepo ficam.
- [Ambiente de preview por PR](issues/05-pr-preview-environments.md): Worker Previews (`wrangler preview --name pr-N`, ≥ 4.135, open beta), isolado e com URL estável, e não Version URLs. Branch Neon por PR (`create-branch-action@v6`) + `drizzle-kit migrate` + `DATABASE_URL` via `--secrets-file`. Limpeza no `closed`. O input `secrets:` do `wrangler-action` grava na produção. Neon Free (10 branches por projeto) limita a cerca de 9 previews simultâneos. Resend redirecionado para `*.resend.app`. Reforça T1/T2 (um único Worker).
- [Portabilidade GitHub → Forgejo](issues/14-forgejo-portability.md): migrar é viável para Forgejo próprio (v16.0.x) com runner próprio com Docker. As operações de forja ficam num adaptador REST (cerca de 20 operações mapeadas). Exclusivos do GitHub: `claude-code-action`, `gh`, `state_reason`, `queue: max`, lock por `git/refs`, draft. O `fj` 0.7.0 não sobe anexos, mas a REST do Forgejo tem endpoints de assets.
- [Escolha do motor da Factory](issues/12-factory-engine-choice.md): Sandcastle com `noSandbox()` em `ubuntu-latest`, versão fixada, sem motor alternativo. Identidade = machine user + `FACTORY_TOKEN` (fora do processo do agente). Um adaptador de forja (só GitHub implementado; cabe no Forgejo). Prints por anexo nativo. Auth do Claude por API key ou OAuth token. E2E local dentro do job. O `claude-code-action` sai da Factory.
- [Modelo de organização da Reference App](issues/10-organization-model.md): várias Companies por usuário, a ativa vem da URL (`/c/<id aleatório imutável>`). Roles da Company: um Owner (manda em tudo, transfere a posse) e Employee; o Manager (líder dos seus Teams) e o acesso por Team foram revistos no ticket seguinte. Convites de 7 dias presos ao email verificado. Quem sai deixa Tarefas sem responsável e perde o MCP na hora. Companies, Owner/Employee, convites e conta ficam no Skeleton; o Strip remove Teams e Manager.
- [Modelo de projetos, Tarefas e fluxo](issues/11-projects-and-flow-model.md): "Tarefa" substitui "Ticket". Project da Company, ligado a 0..N Teams, que definem quem o vê; segue um Pipeline da Company (colunas de entrada, fila, em andamento, concluído). Um responsável por vez, só em coluna em andamento; registros de tempo por coluna, responsável e Sprint (filas incluídas, para gargalos). Sprints pendente/ativa/encerrada, encerramento manual ou automático configurável. Uma tela de Tarefas (Kanban ou lista; escopo Empresa/Team/Pessoa; filtro Scrum). Manager age só nos seus Teams. Anexos no R2.

- [Trocas na stack](issues/13-stack-swaps.md): um único Worker (SPA + Hono em `/api/*` e `/mcp`), sem Pages; `pg` + Drizzle direto no Neon em todo lugar, sem Hyperdrive (teto de 100k queries/dia); Drizzle v1 RC fixa; shadcn com Base UI; TanStack Router; `react-email` 6 → `html`. Login com email e senha no Workers Free, com reset e troca de senha. MCP: Better Auth + `workers-oauth-provider` + `createMcpHandler`, com CIMD, DCR e `legacy: "stateless"`. Nova restrição: stack 100% gratuita.

## Not yet specified

- **Layout do monorepo e fronteira Skeleton × Reference App**: estrutura de pacotes/apps e o que exatamente o Strip remove. A fronteira de domínio já está fechada ([Modelo de organização da Reference App](issues/10-organization-model.md) e [Modelo de projetos, Tarefas e fluxo](issues/11-projects-and-flow-model.md)); falta como o código se separa, incluindo o Manager, que existe só na Reference App.
- **Lista final de arquivos de harness**: AGENTS.md por diretório, skills próprias da stack, subagents, `.mcp.json`, settings/hooks.
- **Bootstrap do template público**: wizard para contas, secrets, projetos Cloudflare/Neon/Resend, labels do GitHub.
- **R2 para anexos de Tarefas**: bucket no bootstrap, isolamento no preview por PR (bucket ou prefixo por PR, limpeza no `closed`) e o que o Strip remove.
- **Ferramentas do MCP da Reference App**: quais operações expor; as permissões seguem a tabela de [Modelo de projetos, Tarefas e fluxo](issues/11-projects-and-flow-model.md).
- **Telas de métricas de tempo**: layout e filtros; as definições (tempo por coluna, por responsável, nas filas, cycle time) já estão em [Modelo de projetos, Tarefas e fluxo](issues/11-projects-and-flow-model.md).
- **Redação final das duas specs e quebra do backlog** em issues `ready-for-agent` (`to-spec`, `to-tickets`), com a ordem de liberação. Espera [Medir a CPU do login no leadflow](issues/17-leadflow-login-cpu.md) e [Kubb + MSW 3](issues/18-kubb-msw3.md).

## Out of scope

- Merge automático do PR pela Factory: o Merge Gate é sempre humano.
- i18n da Reference App.
- Implementar o harness ou a Reference App: acontece depois do mapa.
- Suporte real a Forgejo no template: só o adaptador é projetado para caber nele ([Portabilidade GitHub → Forgejo](issues/14-forgejo-portability.md)).
- Codeberg como forja da Factory: os Termos de Uso (desde junho de 2026) proíbem projetos majoritariamente gerados por IA, e os runners hospedados param em 10 min por job.
- Sandbox `docker()` com rede restrita para o agente: endurecimento futuro.
- Motor alternativo (Agent SDK, dynamic Workflow, `claude-code-action` como orquestrador): descartado em [Escolha do motor da Factory](issues/12-factory-engine-choice.md).
- Workflow de review de PR separado (`claude-code-review.yml`): substituído pelo Review stage interno.
- Na Reference App: trocar o Pipeline de um Project, arquivar Project, menções e notificações em comentários, integração de PR com a forja (só links). Decidido em [Modelo de projetos, Tarefas e fluxo](issues/11-projects-and-flow-model.md).
