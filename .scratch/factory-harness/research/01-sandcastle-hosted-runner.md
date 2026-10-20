# Sandcastle em runner hospedado do GitHub Actions

Ticket: [01-sandcastle-hosted-runner](../issues/01-sandcastle-hosted-runner.md)
Pesquisado em: 2026-10-17

Versões consultadas:
- `@ai-hero/sandcastle` **0.12.0** no npm (publicada em 2026-06-29). A `main` do repositório estava no commit `7a4e7f7` (2026-10-08), com uma changeset pendente que só corrige o README.
- Imagem `ubuntu-24.04` (= `ubuntu-latest`) versão **20261012.334.1**. O README da imagem foi atualizado em 2026-10-16.
- Docs do Claude Code e do GitHub lidos em 2026-10-17. As páginas não trazem data de revisão.

## Resposta

**Sim, o Sandcastle roda num `ubuntu-latest` hospedado, sem self-hosted runner.** O próprio repositório do Sandcastle faz isso em produção. Os workflows `agent-implement.yml`, `agent-review.yml`, `agent-implement-pr.yml` e `agent-explore.yml` rodam em `runs-on: ubuntu-latest` e autenticam com `CLAUDE_CODE_OAUTH_TOKEN`. Eles usam o provider **`noSandbox()`**: a VM descartável do runner faz o papel de sandbox, e não há Docker. Nas últimas execuções, foram 61 de 61 implement com sucesso, levando de 1 a 19 min, e 67 de 72 review com sucesso, levando de 1 a 22 min.

Mas o Sandcastle é **uma biblioteca, não um motor de Factory completo**. Ele cuida de:
- worktree e branch;
- invocação headless do Claude Code;
- iterações com sinal de término;
- saída estruturada;
- resume e fork de sessão;
- `exec` para os gates.

Ele **não** tem conceito de Stage. Também não faz limite de voltas, push, PR, labels nem agendamento. O loop Exploration → Development → E2E → Review, com retorno e teto de 5 voltas, vira um `for` em TypeScript escrito por nós. Push, PR e labels ficam em passos `gh` do workflow, exatamente como o repositório do Sandcastle faz.

**Recomendação:** Sandcastle é um candidato viável e barato como "núcleo de execução" dentro de um job por issue. Isso vale com `noSandbox()` no runner hospedado e `timeout-minutes` bem abaixo de 6 h. O orquestrador de Stages fica em `.factory/*.ts`, e push, PR e Escalation ficam no YAML. Docker dentro do runner também funciona em tese, mas não há exemplo oficial em CI e há um bug aberto de corrupção de metadados de worktree em bind-mount no Linux. Por isso, no CI, `noSandbox()` é o caminho comprovado. A escolha final do motor fica para o ticket 12.

## Achados detalhados

### 1. O que é e como se usa

- É uma biblioteca TypeScript, `@ai-hero/sandcastle`, licença MIT. Você chama `run()`, ela isola o agente com uma estratégia de branch configurável, e os commits voltam para o branch. Fonte: [README](https://github.com/mattpocock/sandcastle/blob/main/README.md#what-is-sandcastle).
- O README diz que `run()` serve para "scripts, CI pipelines, or custom tooling". Fonte: [README, API](https://github.com/mattpocock/sandcastle/blob/main/README.md#api).
- Releases recentes no npm: 0.6.0 em 2026-05-26, 0.10.0 em 2026-06-18 e **0.12.0 em 2026-06-29**, a mais recente. É pré-1.0 e sai minor com frequência. Fontes: `npm view @ai-hero/sandcastle time` e [release v0.12.0](https://github.com/mattpocock/sandcastle/releases/tag/v0.12.0).

### 2. Requisitos: Docker/containers

- Providers embutidos: Docker, Podman e Vercel (Firecracker), mais `noSandbox()`. Os três primeiros são intercambiáveis em `run()`, `createSandbox()` e `interactive()`. Fonte: [README, Sandbox Providers](https://github.com/mattpocock/sandcastle/blob/main/README.md#sandbox-providers). Há também um provider Daytona em `src/sandboxes/daytona.ts` e um export em `package.json`. O README não o lista na tabela.
- **`noSandbox()` em `run()` (execução AFK) é suportado desde a ADR 0015.** A ADR cita explicitamente "containerized CI, VM, sandbox host" como motivação. A importação do provider é o próprio opt-in, e "the caller owns the risk". Fonte: [docs/adr/0015](https://github.com/mattpocock/sandcastle/blob/main/docs/adr/0015-no-sandbox-in-run-and-create-sandbox.md) e issue [#507](https://github.com/mattpocock/sandcastle/issues/507), fechada em 2026-05-20.
- **Exemplo oficial em CI:** os workflows do repositório usam `noSandbox()`. Fontes: [agent-implement.yml](https://github.com/mattpocock/sandcastle/blob/main/.github/workflows/agent-implement.yml) e [implement.ts](https://github.com/mattpocock/sandcastle/blob/main/.sandcastle/agent-workflows/implement/implement.ts). O job:
  - faz `actions/checkout` com `fetch-depth: 0` e cria o branch `agent/issue-N-slug`;
  - roda `setup-node` 22, `npm ci` e `npm install -g @anthropic-ai/claude-code`;
  - executa `npx tsx .sandcastle/agent-workflows/implement/implement.ts`.
- O runner hospedado tem **Docker Client/Server 28.0.4, Docker Compose 2.38.2, Buildx 0.38.0, Podman 4.9.3 e Node.js 22.23.3** na imagem 20261012.334.1. Fonte: [runner-images Ubuntu2404-Readme](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md). Portanto `docker()` também seria possível: o `sandcastle docker build-image` passa o `AGENT_UID` do host. Fonte: [README, CLI](https://github.com/mattpocock/sandcastle/blob/main/README.md#sandcastle-docker-build-image). **Não encontrei exemplo oficial de `docker()` em GitHub Actions.** O exemplo que usa `docker()` é o `.factory/implement-task.ts`, chamado por um daemon local (`~/repos/ai/software-factory`) que não é público. Fonte: [.factory/](https://github.com/mattpocock/sandcastle/tree/main/.factory).
- O runner tem `sudo` sem senha e roda numa VM própria. Fonte: [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Atenção: o `ubuntu-slim` é outra coisa. Tem 1 CPU, timeout de 15 min e **não suporta Docker-in-Docker**. Mesma fonte.

### 3. Claude Code dentro do sandbox e autenticação

- O provider `claudeCode()` executa `claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model <m> [--effort] [--resume] -p -`, com o prompt via stdin. `permissionMode` substitui o skip-permissions. Fonte: [src/AgentProvider.ts](https://github.com/mattpocock/sandcastle/blob/main/src/AgentProvider.ts) (por volta da linha 1185).
- **Contradição na fonte.** A ADR 0015 e o docstring de `no-sandbox.ts` dizem que, com `noSandbox()`, o agente não recebe `--dangerously-skip-permissions`. Porém o código de `run()` passa `dangerouslySkipPermissions: true` incondicionalmente. Fonte: [src/Orchestrator.ts](https://github.com/mattpocock/sandcastle/blob/main/src/Orchestrator.ts), linha 143. Isso explica por que os workflows do repositório funcionam sem prompts. Só `interactive()` e `createWorktree().interactive()` condicionam o flag a `tag !== "none"`. Vale o código, mas é comportamento que pode mudar.
- O Claude Code precisa estar no PATH do host. Com `noSandbox()`, isso significa instalar no runner. Com Docker, o Dockerfile padrão já instala Node 22, git, gh e Claude Code, com usuário não-root `agent`. Fonte: [README, Custom Dockerfile](https://github.com/mattpocock/sandcastle/blob/main/README.md#custom-dockerfile).
- **Autenticação:** o `init` gera um `.env.example` com `CLAUDE_CODE_OAUTH_TOKEN`, obtido via `claude setup-token`, e `ANTHROPIC_API_KEY` como alternativa comentada. As variáveis são resolvidas de `.sandcastle/.env` e de `process.env`. Fontes: [README, Quick start](https://github.com/mattpocock/sandcastle/blob/main/README.md#quick-start) e [README, Provider env](https://github.com/mattpocock/sandcastle/blob/main/README.md#provider-env). No CI, o repositório injeta `secrets.CLAUDE_CODE_OAUTH_TOKEN`. Fonte: [shared/common.ts](https://github.com/mattpocock/sandcastle/blob/main/.sandcastle/agent-workflows/shared/common.ts).
- Docs do Claude Code sobre o token:
  - `claude setup-token` gera um **token OAuth de 1 ano** para "CI pipelines, scripts".
  - Exige plano Pro, Max, Team ou Enterprise.
  - Só faz requisições de modelo, mas MCP local funciona.
  - `--bare` não lê o token.
  - Na precedência, `ANTHROPIC_API_KEY` vence `CLAUDE_CODE_OAUTH_TOKEN`.

  Fonte: [code.claude.com/docs/en/authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).
- Política de uso da assinatura: a issue [#191](https://github.com/mattpocock/sandcastle/issues/191) foi fechada pelo autor em 2026-06-15, com a orientação de usar `claude setup-token` e `CLAUDE_CODE_OAUTH_TOKEN`. O artigo da Anthropic diz o seguinte:
  - Em 2026-06-15, a mudança anunciada foi pausada, e `claude -p` e o Agent SDK continuam usando os limites da assinatura.
  - Em **2026-10-07**, os planos Max e Team passaram a incluir créditos mensais de API, e "you can still use … `claude -p` … with your subscription limits".
  - O artigo **não fala de CI/GitHub Actions** nem dá valores.

  Fonte: [support.claude.com/…/15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

### 4. Como expressar o loop de Stages

- Sandcastle **não tem Stages**: "no opinions about workflow" ([README, Prompts](https://github.com/mattpocock/sandcastle/blob/main/README.md#prompts)). As peças disponíveis:
  - `createSandbox({ branch })` abre um sandbox reutilizável. Vários `sandbox.run()` acumulam commits no mesmo branch, e dependências e build persistem ([README, createSandbox](https://github.com/mattpocock/sandcastle/blob/main/README.md#createsandbox--reusable-sandbox)).
  - `sandbox.exec(cmd)` devolve `exitCode` sem lançar erro. É o gate determinístico entre etapas: rodar testes ou E2E e decidir ([idem](https://github.com/mattpocock/sandcastle/blob/main/README.md#multi-run-implement-then-review)). Entrou na 0.12.0 ([CHANGELOG](https://github.com/mattpocock/sandcastle/blob/main/CHANGELOG.md)).
  - `Output.object({ tag, schema })` produz um veredito tipado (por exemplo, `{ verdict: "approve" | "changes", findings }`) para a Review. Exige `maxIterations: 1` e aceita `maxRetries` ([README, Structured output](https://github.com/mattpocock/sandcastle/blob/main/README.md#structured-output)).
  - `maxIterations` + `completionSignal` repetem o **mesmo** prompt até `<promise>COMPLETE</promise>`. São iterações do agente, não voltas de Stage ([README, All options](https://github.com/mattpocock/sandcastle/blob/main/README.md#all-options)).
  - `result.resume()` e `fork()` continuam a sessão do Claude dentro do mesmo sandbox quente ([README, SandboxRunResult](https://github.com/mattpocock/sandcastle/blob/main/README.md#sandboxrunresult)).
- Os templates oficiais mostram exatamente esse padrão de `for` em TS:
  - `sequential-reviewer`: implement → review, com outer loop de `MAX_ITERATIONS`.
  - `parallel-planner-with-review`: planner com `Output.object`, depois `Promise.allSettled` de implement+review por branch, depois merge.

  Fontes: [src/templates/sequential-reviewer/main.mts](https://github.com/mattpocock/sandcastle/blob/main/src/templates/sequential-reviewer/main.mts) e [parallel-planner-with-review/main.mts](https://github.com/mattpocock/sandcastle/blob/main/src/templates/parallel-planner-with-review/main.mts). Logo, "5 voltas e Escalation" é um contador nosso no script. Inferência: nada no Sandcastle impede isso, mas também nada o fornece.
- Sandcastle **não faz retry** de erro do provider (rate limit, auth, rede). Ele falha rápido, e o retry fica a cargo do harness. Fonte: [.out-of-scope/provider-error-retry.md](https://github.com/mattpocock/sandcastle/blob/main/.out-of-scope/provider-error-retry.md).
- Timeouts embutidos: `idleTimeoutSeconds` de 600 s sem saída derruba a run, e `completionTimeoutSeconds` é de 60 s após o sinal. Fonte: [README, Hanging processes](https://github.com/mattpocock/sandcastle/blob/main/README.md#hanging-processes-after-the-completion-signal).

### 5. Branch, commit e PR

- Estratégias de branch: `head`, `merge-to-head` e `branch` (nome explícito, "for a PR"). O agente commita dentro do worktree, e `result.commits` e `result.branch` voltam ao chamador. Fonte: [README, Branch strategies](https://github.com/mattpocock/sandcastle/blob/main/README.md#branch-strategies).
- **Sandcastle não faz push nem abre PR.** Não há `git push` nem `gh pr create` em `src/`. Verificado com grep no commit `7a4e7f7`. No CI oficial, isso fica em passos do YAML:
  - `git push --force origin "$BRANCH"`;
  - `gh pr create --draft`;
  - troca de labels `agent:*`;
  - comentário de falha na issue, lido de `failure_reason.txt`.

  Fonte: [agent-implement.yml](https://github.com/mattpocock/sandcastle/blob/main/.github/workflows/agent-implement.yml). O padrão é parecido com a Escalation da Factory.
- PRs criados com `GITHUB_TOKEN` disparam `pull_request` só em estado *approval-required*, e eventos `labeled` não disparam workflow nenhum. Para o CI ou preview rodarem sem aprovação, é preciso um token de GitHub App ou um PAT. Fonte: [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token). O workflow do Sandcastle usa `secrets.AGENT_PAT || secrets.GITHUB_TOKEN` exatamente por isso. Isso afeta o preview por PR e o agendador de Blocked Issues.

### 6. Limites práticos do runner hospedado

| Item | Valor | Fonte |
| --- | --- | --- |
| Tempo máximo por job | **6 h** (não aumentável) | [Actions limits](https://docs.github.com/en/actions/reference/limits) |
| Tempo máximo por workflow run | 35 dias | idem |
| `ubuntu-latest`, repo **público** | 4 CPU, 16 GB RAM, **14 GB SSD**, grátis e ilimitado | [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |
| `ubuntu-latest`, repo **privado** | 2 CPU, 8 GB RAM, 14 GB SSD | idem |
| Preço Linux 2-core (privado) | US$ 0,006/min, após a franquia (Free 2.000 min, Pro/Team 3.000) | [Billing Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Jobs concorrentes | Free 20, Pro 40, Team 60, Enterprise 500 | [Actions limits](https://docs.github.com/en/actions/reference/limits) |
| `GITHUB_TOKEN` | 1.000 req/h por repositório | idem |
| Rede | saída livre, IPs Azure compartilhados (sem IP fixo) | [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |

- Duração observada nos agentes do próprio Sandcastle: implement de 1 a 19 min (n=61), review de 1 a 22 min (n=72) e implement-pr de 1 a 10 min (n=13), com `timeout-minutes: 60` ou 45. Fonte: `gh run list -R mattpocock/sandcastle` em 2026-10-17. Inferência: o repositório do Sandcastle é pequeno. Uma issue full-stack com E2E e até 5 voltas deve demorar bem mais, mas ainda tende a caber em 6 h.
- Custo de modelo: com `CLAUDE_CODE_OAUTH_TOKEN`, sai dos limites da assinatura (e, desde 2026-10-07, dos créditos Max/Team). Com `ANTHROPIC_API_KEY`, é pago por token. Sandcastle expõe `iterations[].usage` (tokens de entrada, saída e cache) para medir. Fonte: [README, IterationUsage](https://github.com/mattpocock/sandcastle/blob/main/README.md#iterationusage). Os limites numéricos da assinatura não são publicados no artigo.
- Logs: o padrão grava em arquivo, em `.sandcastle/logs/`. No CI isso fica invisível, a menos que se use `logging: { type: "stdout" }` (como o repositório faz) ou se suba como artifact. Fonte: issue [#1031](https://github.com/mattpocock/sandcastle/issues/1031), fechada como decisão de produto pendente.

## Riscos e incógnitas

1. **Segurança com `noSandbox()`.** O agente roda com `--dangerously-skip-permissions` na VM, com rede aberta e com os secrets do job no ambiente (`GH_TOKEN`, token do Claude, eventualmente o PAT). Conteúdo de issue ou PR vira prompt, o que abre risco de injeção de prompt e exfiltração. Há exemplo real: a issue #977 do próprio repositório tem no título um payload `curl … $(env|base64)`. A VM é efêmera, mas os secrets não são. Mitigações:
   - `permissions:` mínimas ([secure-use](https://docs.github.com/en/actions/reference/security/secure-use));
   - token do GitHub com escopo reduzido;
   - `permissionMode: "auto"` ou allowlist em `.claude/settings.json`;
   - ou isolar com `docker()`, passando ao container só o token do Claude.
2. **`pull_request_target` + checkout do head do PR**, como fazem `agent-review.yml` e `agent-implement-pr.yml`, é o padrão que a GitHub diz poder levar a "take over a repository" ([secure-use](https://docs.github.com/en/actions/reference/security/secure-use)). Na Factory, só os branches criados pela própria Factory deveriam ser tocados, e não PRs de forks.
3. **Contradição entre ADR/docstring e o código** sobre `--dangerously-skip-permissions` em `noSandbox()` (seção 3). É uma biblioteca pré-1.0, e o comportamento pode mudar entre minors: fixar a versão.
4. **`docker()` no runner não foi validado por fonte primária.** Bug aberto [#854](https://github.com/mattpocock/sandcastle/issues/854): worktree em bind-mount corrompe metadados git em hosts não-Windows. Bug aberto [#766](https://github.com/mattpocock/sandcastle/issues/766): `noSandbox()` não mata a árvore de processos no teardown. No runner efêmero isso importa pouco, mas pode segurar o job até o timeout.
5. **ToS e limites da assinatura em CI**: a doc do Claude Code recomenda o token para CI, mas o artigo de uso do plano não fala de automação contínua nem de limites numéricos. Para um template público, oferecer as duas opções (OAuth e API key) via secret.
6. **Sem agendamento nem fila**: o Sandcastle não dispara nada. Gatilho, concorrência por issue e destravamento de Blocked Issues ficam no Actions (`concurrency:`, eventos). Ver tickets 03 e 12.
7. Não verifiquei o espaço livre real em disco do runner (a doc diz 14 GB de SSD). Um monorepo com Playwright, browsers e `node_modules` pode apertar, o que pede medição no protótipo.
