# Pesquisa 19f — O que os projetos do Matt Pocock fazem com preview, banco e secrets em CI de agente

Ticket: [19-pr-ci-security](../issues/19-pr-ci-security.md) · Pesquisado em 2026-10-18
Pergunta: algum projeto do Matt Pocock (`mattpocock`, `total-typescript`, `ai-hero-dev`) roda ambiente de preview por PR com banco de dados, ou roda código escrito por agente em CI com acesso a secrets de nuvem? Se roda, como trata dados, secrets, triggers, forks e a separação entre código não confiável e secrets?

Versões consultadas (todo link aponta para o commit lido em 2026-10-18):
- [`mattpocock/course-video-manager`](https://github.com/mattpocock/course-video-manager/tree/86e8ae198a0c96730e2b451cc066ba88829f03ae) @ `86e8ae1` (abreviado como **CVM**)
- [`mattpocock/sandcastle`](https://github.com/mattpocock/sandcastle/tree/56800a7d198e9281c1b1321bdacb5719dcddde16) @ `56800a7`
- [`mattpocock/evalite`](https://github.com/mattpocock/evalite/tree/e18a793789400b9292f92465d1084344340aef9b) @ `e18a793`
- [`mattpocock/ai-hero-cli`](https://github.com/mattpocock/ai-hero-cli/tree/3987e344d3452fd4ec70de24979dc8697c6d5cdd) @ `3987e34`
- [`mattpocock/ai-interviewer`](https://github.com/mattpocock/ai-interviewer/tree/e03790161f26ae7ee1613e6c1629a2234f7a99d5) @ `e037901`
- [`ai-hero-dev/ai-hero`](https://github.com/ai-hero-dev/ai-hero/tree/8a2ab404cba5c70731edd3c2e919fea917f843aa) @ `8a2ab40`
- [`total-typescript/shiki-service`](https://github.com/total-typescript/shiki-service/tree/e7fa0d1313690acd0d0ab13ecd426cb55b73afa6) @ `e7fa0d1`
- Docs do GitHub: [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) e [Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization), lidas em 2026-10-18.

Método:
1. Listei todos os repositórios das três contas pela API (`users/{owner}/repos`).
2. Li o diretório `.github/workflows` de cada repositório não-fork com atividade desde 2025, e também dos 10 workshops da `total-typescript`.
3. Rodei `gh search code --owner mattpocock` com `neondatabase`, `NEON_API_KEY`, `VERCEL_ENV`, `preview`, `pull_request_target`, `DATABASE_URL`, `branch-per-pr` e `vercel.json`.
4. A mesma busca nas contas `total-typescript` e `ai-hero-dev` bateu no rate limit da API de busca. Nessas duas, a cobertura vem só da listagem direta de workflows (passo 2) e da árvore de arquivos dos repositórios com app.

Convenção: **Fonte diz** é o que está no arquivo citado. **Inferência** é leitura minha.

---

## Resposta curta

1. **Preview por PR com banco: nenhum projeto faz.** O único app com deploy e banco de produção é o CVM (API na Vercel e Postgres na PlanetScale). Ali o Matt **desligou** os Preview Deployments em 2026-09-26, porque o build de preview já tinha conseguido aplicar migration não revisada no schema de produção (§1).
2. **Agente em CI com secrets: sim, no CVM e no Sandcastle.** Os secrets são só de GitHub e do LLM: `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN` e `AGENT_PAT`. Nenhum workflow passa `DATABASE_URL` ou credencial de nuvem para o agente, e o CI de PR do CVM roda sem secret nenhum (§2, §3).
3. **Os dados de teste e verificação nunca saem da produção ao vivo.** Os testes usam Postgres local em container, com um banco por arquivo de teste. A verificação manual usa um clone local de um snapshot da produção, **sem as tabelas de credenciais**. Só o Matt gera esse snapshot, e o script recusa rodar no shell de um agente (§4).
4. **A separação entre código do agente e secrets é desigual:**
   - **Bom exemplo:** `agent-explore.yml` do Sandcastle. O agente roda num job só-leitura, sem `GH_TOKEN` e com `persist-credentials: false`. Um segundo job valida o plano e aplica com o `AGENT_PAT` (§5).
   - **Mau exemplo:** os workflows `agent-review`, `agent-implement-pr` e `agent-update-branch`. Eles fazem checkout do head do PR sob `pull_request_target`, rodam `pnpm install` e o agente com `noSandbox()`, e o processo herda o `GH_TOKEN` do job (§3).
   - **Proteção que resta:** o gatilho por label. Aplicar label exige papel Triage ou maior. O spec do CVM não trata de fork (§3.3).

---

## 1. Preview Deployments: o único caso foi desligado

**Fonte diz:**
- **Preview desligado por configuração.** [`apps/remote/vercel.json`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/apps/remote/vercel.json#L3-L7) traz `"git.deploymentEnabled": { "**": false, "main": true }`. O arquivo entrou pelo commit [`3d85d6e`](https://github.com/mattpocock/course-video-manager/commit/3d85d6e8274117166dce09fa74e6e687f3410568), "chore(deploys): stop Vercel Preview Deployments; only main deploys (#1740)", de 2026-09-26. A descrição do PR [#1740](https://github.com/mattpocock/course-video-manager/pull/1740) diz: "No issue behind this — Matt asked for Vercel Preview Deployments off for the CVM." Ela também explica por que o padrão é `**` e não `*`: `*` não casa com `/`, e um branch `feat/thing` continuaria gerando preview.
- **O motivo é registrado na ADR.** A [ADR 0026](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0026-migrations-applied-by-hand.md#L7) conta que o script `vercel-build` rodava `db:migrate` contra `DIRECT_DATABASE_URL` "on _every_ Vercel build — not just a merge to `main`, but every preview deployment". Daí: "An unreviewed, unmerged branch could apply its migration to the production schema the moment Vercel built its preview."
- **O README repete a decisão.** O [README de `apps/remote`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/apps/remote/README.md#L50-L56) diz que o app não roda mais migrations. Sobre ambiente, [diz](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/apps/remote/README.md#L110-L113) que o deploy usa só `DATABASE_URL` (a string pooled da PlanetScale) em runtime e no build. `DIRECT_DATABASE_URL` não está na Vercel.
- **Guard no build de produção.** [`apps/remote/scripts/assert-production-source.mjs`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/apps/remote/scripts/assert-production-source.mjs#L1-L4) faz o build de produção falhar quando o deploy não veio do `main` do GitHub ("Preview builds are untouched").
- **Guard de migration remota.** A [ADR 0026, addendum](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0026-migrations-applied-by-hand.md#L21-L27) diz que migration contra host remoto só roda do `main` limpo, igual a `origin/main`, sem flag de override. O guard está em [`drizzle.config.ts`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/packages/core/drizzle.config.ts#L37-L46).
- **Guard de conexão em worktree.** [`connection-guard.ts`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/packages/core/db/connection-guard.ts#L1-L25) define a regra "a git worktree never opens a writable connection to a remote database". A única exceção é conexão com `default_transaction_read_only=on`.

**Inferência:**
- O CVM nunca teve banco de preview separado. O preview da Vercel apontava para o mesmo banco de produção, e o incidente foi exatamente esse.
- O Matt resolveu eliminando o preview, não isolando o banco. Não há Neon, branch por PR nem projeto de preview em nenhum repositório lido.

**Outros previews encontrados (nenhum tem banco):** são de pacote npm via `pkg-pr-new`, em `pull_request` e sem secrets:
- [`evalite/.github/workflows/preview.yml`](https://github.com/mattpocock/evalite/blob/e18a793789400b9292f92465d1084344340aef9b/.github/workflows/preview.yml#L3-L27)
- [`ai-hero-cli/.github/workflows/preview.yml`](https://github.com/mattpocock/ai-hero-cli/blob/3987e344d3452fd4ec70de24979dc8697c6d5cdd/.github/workflows/preview.yml#L3-L25)

**Neon aparece uma vez, sem CI:** [`ai-interviewer/apps/web/app/db/client.ts`](https://github.com/mattpocock/ai-interviewer/blob/e03790161f26ae7ee1613e6c1629a2234f7a99d5/apps/web/app/db/client.ts#L1-L13) usa `@neondatabase/serverless` com `DATABASE_URL`, mas o repositório não tem `.github/workflows` nem `vercel.json`. Ou seja, não há preview configurado no repositório.

**Sites:**
- O [README do `ai-hero-dev/ai-hero`](https://github.com/ai-hero-dev/ai-hero/blob/8a2ab404cba5c70731edd3c2e919fea917f843aa/README.md) e a descrição do repositório ("AI Hero's open-source examples and course material") indicam material de curso. O único workflow é [`shortlinks.yml`](https://github.com/ai-hero-dev/ai-hero/blob/8a2ab404cba5c70731edd3c2e919fea917f843aa/.github/workflows/shortlinks.yml#L1-L24), em `push` para `main`.
- Não encontrei nas três contas o código-fonte dos sites totaltypescript.com e aihero.dev.
- O [`shiki-service`](https://github.com/total-typescript/shiki-service/blob/e7fa0d1313690acd0d0ab13ecd426cb55b73afa6/.github/workflows/fly.yml#L1-L15) faz deploy no Fly só em `push` para `main`.

## 2. CI de PR (código humano ou de agente): sem secrets, banco local

**Fonte diz:**
- **CI do CVM.** [`test.yml`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/test.yml#L29-L40) roda em `pull_request` e `push: main`, com `permissions: contents: read, pull-requests: read`. Nenhum job referencia `secrets.*`; o único token é `github.token`, no passo de detectar PR só de docs ([L54-L58](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/test.yml#L54-L58)).
- **Banco dos testes.** A [ADR 0046](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0046-tests-share-one-postgres-container-a-database-per-file.md#L21-L24) define o banco: um container `postgres:17` em `127.0.0.1:54329` e um banco template, clonado com `CREATE DATABASE … TEMPLATE` para cada arquivo de teste. Sobre CI, [diz](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0046-tests-share-one-postgres-container-a-database-per-file.md#L36): "CI's `ubuntu-latest` has Docker, and the same global setup starts the container there."
- **Sandbox Docker do agente.** Ele alcança o Postgres de teste do host por `host.docker.internal:54329`, sem credencial de nuvem ([`.sandcastle/main.ts` L5-L13](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.sandcastle/main.ts#L5-L13)).
- **Sandcastle e evalite.** O CI do Sandcastle roda só em `push` para `main` ([`ci.yml` L3-L6](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/ci.yml#L3-L6)). O do evalite roda em `push`, sem secrets ([`ci.yml`](https://github.com/mattpocock/evalite/blob/e18a793789400b9292f92465d1084344340aef9b/.github/workflows/ci.yml#L1-L17)).

## 3. Workflows `agent-*`: o que o agente enxerga

### 3.1 Triggers

**Fonte diz:**
- **Issues:** `agent-implement`, `agent-implement-prd` e `agent-to-issues-prd` usam `issues: [labeled]` ([CVM `agent-implement.yml` L3-L9](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/agent-implement.yml#L3-L9)).
- **PRs:** `agent-review`, `agent-implement-pr` e `agent-update-branch` usam `pull_request_target: [labeled]` e são filtrados pelo nome da label ([CVM `agent-review.yml` L3-L14](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/agent-review.yml#L3-L14)).
- **O motivo declarado é só de confiabilidade.** O `pull_request` depende de um merge commit que o GitHub não gera quando o PR está desatualizado ou em conflito. O mesmo texto está no [spec AFK §3.3](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/agents/afk-agent-platform-spec.md#L240-L253): "These workflows then explicitly check out `github.event.pull_request.head.sha`."
- **O Sandcastle repete o padrão:** [`agent-review.yml` L3-L5](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-review.yml#L3-L5) e checkout do head em [L36](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-review.yml#L36).

### 3.2 Secrets e onde eles ficam

**Fonte diz:**
- **Inventário oficial.** O [spec AFK §Secrets](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/agents/afk-agent-platform-spec.md#L145-L151) lista três segredos: `GITHUB_TOKEN`, `AGENT_PAT` (PAT com `repo` e `workflow`) e a credencial do runner (`CLAUDE_CODE_OAUTH_TOKEN`). Desta última diz: "The orchestrator passes it into the runner step only."
- **A regra de design declarada.** O [spec, L27-L30](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/agents/afk-agent-platform-spec.md#L27-L30) diz: "The agent runner only emits files. […] the agent never holds a GitHub token and never calls the GitHub API to mutate state."
- **`GH_TOKEN` no nível do job.** No CVM, `agent-review.yml` põe `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` no `env` do **job** ([L24-L29](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/agent-review.yml#L24-L29)), e o job tem `contents: write, pull-requests: write` ([L20-L22](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/agent-review.yml#L20-L22)).
- **Checkout com `AGENT_PAT`.** O checkout do head usa `token: ${{ secrets.AGENT_PAT || secrets.GITHUB_TOKEN }}` e não desliga `persist-credentials` ([L38-L46](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/agent-review.yml#L38-L46)). Pelo [README do `actions/checkout@v4`](https://github.com/actions/checkout/blob/v4/README.md), `persist-credentials` vale `true` por padrão e grava o token no git config local.
- **Código do head roda antes do agente.** O job roda `pnpm install --frozen-lockfile` sobre o código do head ([L66-L67](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/agent-review.yml#L66-L67)). Depois roda `pnpm exec tsx .sandcastle/review/review.ts`, um script **do próprio head**, com `CLAUDE_CODE_OAUTH_TOKEN` ([L85-L90](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/agent-review.yml#L85-L90)).
- **O agente roda direto no runner.** Os scripts usam `sandbox: noSandbox()` ([CVM `implement.ts` L5, L19](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.sandcastle/implement/implement.ts#L5-L19); [Sandcastle `implement.ts` L3, L18](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.sandcastle/agent-workflows/implement/implement.ts#L3-L18)).
- **E herda o ambiente inteiro.** O `noSandbox` monta o ambiente do processo com `{ ...process.env, ...createOptions.env }` ([`no-sandbox.ts` L51](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/src/sandboxes/no-sandbox.ts#L51)).
- **Na ADR o risco fica com quem chama.** A [ADR 0015 do Sandcastle](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/docs/adr/0015-no-sandbox-in-run-and-create-sandbox.md#L7) justifica o `noSandbox()` em AFK para quem roda "inside an already-isolated environment — containerized CI, VM, sandbox host" e conclui ([L24](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/docs/adr/0015-no-sandbox-in-run-and-create-sandbox.md#L24)): "Sandcastle does not add a runtime guard against AFK-on-host; the caller owns the risk."
- **Fora do CI, o padrão é o contrário.** O [README do Sandcastle](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/README.md#L1003-L1023) diz que as variáveis vêm de `.sandcastle/.env` e `process.env` e são **injetadas** no sandbox (Docker, Podman ou Vercel). O isolamento ali protege o host, não o token do LLM.

**Inferência:**
- **O spec promete mais do que os workflows entregam.** Nos workflows de PR com `noSandbox()`, o agente Claude Code roda no mesmo processo-pai que tem `GH_TOKEN` (write) no ambiente e o `AGENT_PAT` no `.git/config`. Ele *pode* chamar a API do GitHub; só não é *instruído* a chamar.
- **A promessa do spec vale de fato em um workflow só**, o `agent-explore` do Sandcastle (§5).
- **Credenciais de nuvem não aparecem.** Nenhum workflow `agent-*` recebe `DATABASE_URL`, chave da Vercel ou da PlanetScale, nem outra credencial de nuvem. O risco fica restrito ao repositório GitHub e à cota do LLM.

### 3.3 Forks

**Fonte diz:**
- **O que o GitHub diz sobre `pull_request_target`.** O evento "runs in the context of the default branch of the base repository". O GitHub avisa: "Avoid using this event if you need to build or run code from the pull request", porque isso pode levar a "granting unintended access to write privileges or secrets" ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
- **Quem pode disparar o gatilho.** Aplicar label exige papel **Triage** ou maior; Read não basta ([docs de papéis](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)).
- **O que falta nos workflows.** Nenhum workflow `agent-*` do CVM ou do Sandcastle verifica `head.repo`, `fork` ou `author_association`. Busquei esses termos nos 12 arquivos `agent-*.yml` dos dois repositórios (7 no CVM, 5 no Sandcastle) e não achei nenhuma ocorrência.
- **O que falta no spec.** O [spec AFK](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/agents/afk-agent-platform-spec.md) (1092 linhas) não menciona fork, "untrusted" nem prompt injection.

**Inferência:**
- A única barreira contra fork malicioso é humana: um mantenedor com Triage precisa pôr a label `agent:*` no PR.
- Feito isso, o código do fork roda com `contents: write` e o `AGENT_PAT` (via `pnpm install` e via os scripts `.sandcastle/*.ts` do head). É o padrão "pwn request" que os docs do GitHub descrevem.
- O modelo de confiança implícito é o repositório de autor único, em que todo PR vem de `agent/*` ou do próprio Matt. A [ADR 0025](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0025-local-remote-split-one-http-transport.md#L31) diz isso em outro contexto: "one author, boxes they set up, agents they wrote".

## 4. Dados: produção, seed ou clone?

**Fonte diz:**
- **Testes:** usam banco vazio e efêmero, construído com `pushSchema` e clonado por arquivo (ADR 0046, citada no §2).
- **Verificação de UI por agente** (skill [`verify-cvm`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.claude/skills/verify-cvm/SKILL.md#L12-L61)):
  - **Clone por execução.** Cada execução recebe "its own copy of Matt's data", um clone do template local `cvm_verify_template` (porta 5433). O clone recebe as migrations do branch e é dropado no cleanup.
  - **Credenciais fora.** "The data is a copy, minus the credential tables". Toda credencial externa é trocada por um valor falso, de modo que Buffer, S3, Dropbox, YouTube, Anthropic e AI Hero "all fail closed".
  - **Produção só em leitura.** Produção só com `--production` e conexão `default_transaction_read_only`.
- **Quem gera o template.** É o [`scripts/verify-snapshot.sh`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/scripts/verify-snapshot.sh#L1-L39):
  - faz `pg_dump` da produção **sem os dados** das tabelas `youtube_auth`, `ai_hero_auth`, `dropbox_auth` e `api_token`;
  - restaura num `<template>_next` e confere que as tabelas de credencial estão vazias;
  - só então troca o template.
- **Só humano roda o snapshot.** O script recusa execução se `CLAUDECODE` está definido ou se stdin/stdout não é TTY ([L32-L39](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/scripts/verify-snapshot.sh#L32-L39)).
- **API remota, para não espalhar `DATABASE_URL`.** O CLI que os agentes usam fala com a API remota por token revogável. A [ADR 0025](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0025-local-remote-split-one-http-transport.md#L60) rejeita "Putting `DATABASE_URL` on the remote box", porque "a compromised box would hand over full database credentials". O [`.env.example`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.env.example#L22-L33) diz o mesmo: "a compromised box hands over a revocable token, not full Postgres access".

**Inferência:** a resposta do Matt para "que dados o agente vê" é uma cópia da produção feita por humano, com as credenciais removidas, rodando **local** e nunca na nuvem. É o oposto de um branch Neon por PR, que já nasce com os dados da produção dentro da conta de nuvem.

## 5. Melhor padrão de separação encontrado: `agent-explore.yml`

**Fonte diz** ([Sandcastle `agent-explore.yml`](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L23-L161)):
- **Job `explore`:** `permissions: contents: read, issues: read`, com o comentário "Read-only: the agent runs in this job, so nothing here can write to GitHub" ([L28-L31](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L28-L31)).
  - O `GH_TOKEN` existe só no passo que lista as issues ([L38-L43](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L38-L43)).
  - O checkout é de `main`, com `persist-credentials: false` ([L67-L73](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L67-L73)).
  - O passo do agente recebe só `CLAUDE_CODE_OAUTH_TOKEN`, com o comentário "No GH_TOKEN in this step's env: the agent has no GitHub access at all" ([L93-L100](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L93-L100)).
- **Entrada fora do shell:** "Never read issue titles or bodies into shell or `${{ }}` — they are untrusted" ([L36-L37](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L36-L37)).
- **Lote salvo antes do agente.** O lote de entrada sobe como artifact *antes* de o agente rodar, "so the apply job validates the plan against a batch the agent could not have tampered with" ([L58-L65](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L58-L65)).
- **Job `apply`:** roda separado, com `issues: write`, baixa lote e plano e só nele aparece o `AGENT_PAT`. O plano é validado inteiro antes de qualquer mudança ([L109-L161](https://github.com/mattpocock/sandcastle/blob/56800a7d198e9281c1b1321bdacb5719dcddde16/.github/workflows/agent-explore.yml#L109-L161)).

**Inferência:**
- Esse é o único lugar onde a regra "agent only emits files" do spec é cumprida pela plataforma, não por convenção.
- O padrão casa com o que o ticket 19 procura: o código não confiável roda num job sem secret de escrita, e um job confiável aplica a saída.
- Mas o `explore` roda sobre `main`, não sobre o head de um PR. Não há exemplo do Matt desse padrão aplicado a código de PR.

## 6. Análogos mais próximos (já que preview com banco não existe)

| Pergunta do ticket | O que o Matt faz | Fonte |
|---|---|---|
| Preview por PR com banco | Desligou o preview na Vercel; só `main` faz deploy | [`vercel.json`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/apps/remote/vercel.json), [ADR 0026](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0026-migrations-applied-by-hand.md) |
| Banco do CI | Postgres em container no runner, um banco template clonado por arquivo, sem secret | [ADR 0046](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0046-tests-share-one-postgres-container-a-database-per-file.md), [`test.yml`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.github/workflows/test.yml) |
| Dados realistas para o agente | Snapshot local da produção sem tabelas de credencial, gerado só por humano; clone por execução | [`verify-snapshot.sh`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/scripts/verify-snapshot.sh), [`verify-cvm`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/.claude/skills/verify-cvm/SKILL.md) |
| Onde fica `DATABASE_URL` | Só na Vercel (produção) e no `.env` local do Matt; agentes remotos usam token de API revogável | [README `apps/remote`](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/apps/remote/README.md#L110-L113), [ADR 0025](https://github.com/mattpocock/course-video-manager/blob/86e8ae198a0c96730e2b451cc066ba88829f03ae/docs/adr/0025-local-remote-split-one-http-transport.md#L60) |
| Guard contra branch escrevendo na produção | `connection-guard` (worktree não abre conexão remota com escrita), `drizzle-guard` (migration remota só de `main` igual a `origin/main`), `assert-production-source` | links no §1 |
| Separação agente/secrets em CI | `agent-explore`: job do agente só-leitura e sem token, job de aplicação separado | §5 |
| Contraexemplo | `agent-review`, `agent-implement-pr`, `agent-update-branch`: `pull_request_target` com checkout e execução do head, `GH_TOKEN` write no job, `AGENT_PAT` persistido, `noSandbox()` | §3.2 |

## Lacunas

- **Busca incompleta em duas contas.** A busca de código nas contas `total-typescript` e `ai-hero-dev` bateu no rate limit. A cobertura delas vem da listagem de workflows: só `renovate-checks.yml` e `section-repos.yml` nos workshops, `fly.yml`, `shortlinks.yml` e repositórios sem workflow.
- **Repositórios privados.** Pode existir infraestrutura de preview em repositórios privados (por exemplo, o código dos sites totaltypescript.com e aihero.dev). Nada disso é verificável daqui.
- **Configuração da Vercel.** A configuração de ambiente do projeto CVM na Vercel (quais variáveis existem em "Preview") não está no repositório.
