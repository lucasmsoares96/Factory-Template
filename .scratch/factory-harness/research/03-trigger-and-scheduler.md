# Pesquisa 03: gatilho por label e agendador de Blocked Issues

Ticket: [03-trigger-and-scheduler](../issues/03-trigger-and-scheduler.md) · Pesquisado em 2026-10-17 · Fontes primárias apenas (GitHub Docs via `github/docs`, OpenAPI `github/rest-api-description`, schema GraphQL, código e docs de `anthropics/claude-code-action`, docs `code.claude.com`). Quando a fonte não diz nada, este documento avisa.

## Resposta

**(a) Gatilho.** Use `on: issues: types: [labeled]` com o filtro `if: github.event.label.name == 'ready-for-agent'` no **job**. A concorrência por issue também fica **no job**: `group: factory-issue-<N>`, com `cancel-in-progress: false`. O mesmo workflow aceita `workflow_dispatch` com o input `issue_number`, que é a porta de entrada do agendador. O primeiro step é um *guard* idempotente: confere se a issue está aberta, tem a label, não tem bloqueador pendente e ainda não foi iniciada. Se algo falhar, sai sem chamar o motor.

**(b) Dependências.** A API nativa existe e é estável:
- `GET /repos/{o}/{r}/issues/{n}/dependencies/blocked_by` lista os bloqueadores.
- `.../blocking` lista as issues que esta issue bloqueia.
- O objeto Issue traz `issue_dependencies_summary {blocked_by, blocking, total_blocked_by, total_blocking}`, em que `blocked_by` conta só os bloqueadores **abertos**.

Para a regra "todos os bloqueadores mergeados", a fonte da verdade é a lista `blocked_by`, exigindo `state == closed && state_reason == completed` em todos os itens. O summary sozinho não basta: ele trata "fechada como not_planned" como desbloqueada e pode vir `null`. A leitura pede permissão `issues: read`.

**(c) Re-disparo.** O agendador escuta `issues: types: [closed]` e filtra `state_reason == 'completed'`, porque o merge de um PR com `Closes #N` na branch padrão fecha a issue. Para cada issue em `.../blocking` que estiver aberta, com `ready-for-agent` e totalmente desbloqueada, ele chama `gh workflow run factory.yml -f issue_number=N`, usando o próprio `GITHUB_TOKEN` com `actions: write`.
- Isso funciona porque `workflow_dispatch` e `repository_dispatch` são as **únicas exceções** à regra de que eventos criados com `GITHUB_TOKEN` não disparam workflows. Não é preciso PAT nem App só para isso.
- Acrescente `workflow_dispatch` (varredura manual) e, se quiser, um `schedule` de varredura como rede de segurança.
- `pull_request: closed` com `merged == true` é uma alternativa equivalente, mas exige resolver as issues fechadas pelo PR via GraphQL (`closingIssuesReferences`).

**claude-code-action@v1** (`v1` = `v1.0.252`, commit `f27be6b`, 2026-10-16):
- **Modos.** São só dois, auto-detectados: `tag` (sem `prompt`, reage a @claude, label ou assignee e cria comentário de progresso) e `agent` (com `prompt`, executa direto, sem comentário). O input `mode` foi removido, e "automation" é só o nome de documentação do modo `agent`.
- **Autenticação.** `anthropic_api_key` (cobrança da API), `claude_code_oauth_token` (assinatura Pro, Max, Team ou Enterprise, token de 1 ano gerado com `claude setup-token`, preso à pessoa) ou Workload Identity Federation (sem segredo estático).
- **GitHub.** Por padrão a action troca o OIDC (`id-token: write`) por um token da Claude GitHub App com `contents`, `pull_requests` e `issues: write`. Commits e PRs feitos com esse token **disparam** CI e preview, ao contrário do `GITHUB_TOKEN`.
- **PR.** No modo `agent`, o Claude só abre PR se o prompt pedir e as ferramentas forem liberadas, por exemplo `--allowedTools "Bash(git:*),Bash(gh pr create:*)"`.
- **Atenção.** Em todo evento, a action **rejeita actor bot**. Uma execução disparada pelo agendador via `GITHUB_TOKEN` tem actor `github-actions[bot]`, então é obrigatório `allowed_bots: "github-actions[bot]"`.
- **Duplicatas.** Evite com o filtro de label no job, a concorrência por issue no job e o guard idempotente. Um lock atômico (criar o ref `factory/issue-N` via API) fecha a janela restante.

### Desenho recomendado (esboço)

`.github/workflows/factory.yml` (gatilho + execução de uma issue):

```yaml
name: Factory
on:
  issues:
    types: [labeled]
  workflow_dispatch:
    inputs:
      issue_number:
        description: Issue to build
        required: true
        type: number

jobs:
  run:
    # Filtro no job: outras labels não criam execução útil.
    if: github.event_name == 'workflow_dispatch' || github.event.label.name == 'ready-for-agent'
    # Concorrência no JOB (não no workflow): um run com job pulado não entra no grupo
    # nem cancela um pending legítimo (ver risco R4).
    concurrency:
      group: factory-issue-${{ github.event.issue.number || inputs.issue_number }}
      cancel-in-progress: false
    runs-on: ubuntu-latest
    timeout-minutes: 360          # teto do runner hospedado; GITHUB_TOKEN vive no máx. 6 h
    permissions:
      contents: write             # criar o ref-lock factory/issue-N
      pull-requests: write
      issues: write
      id-token: write             # OIDC -> token da Claude App (e WIF, se usado)
      actions: read               # Claude lê CI
    env:
      ISSUE: ${{ github.event.issue.number || inputs.issue_number }}
      BRANCH: factory/issue-${{ github.event.issue.number || inputs.issue_number }}
      GH_TOKEN: ${{ github.token }}
      R: ${{ github.repository }}
    steps:
      - name: Guard (open + labeled + unblocked + lock)
        id: guard
        run: |
          set -euo pipefail
          issue=$(gh api "repos/$R/issues/$ISSUE")
          [ "$(jq -r .state <<<"$issue")" = open ] || { echo "go=false" >>"$GITHUB_OUTPUT"; exit 0; }
          jq -e '[.labels[].name] | index("ready-for-agent")' <<<"$issue" >/dev/null \
            || { echo "go=false" >>"$GITHUB_OUTPUT"; exit 0; }
          pending=$(gh api --paginate "repos/$R/issues/$ISSUE/dependencies/blocked_by" \
            --jq '.[] | select(.state != "closed" or .state_reason != "completed") | .number')
          if [ -n "$pending" ]; then
            echo "Blocked by: $pending"; echo "go=false" >>"$GITHUB_OUTPUT"; exit 0
          fi
          # Lock atômico: criar o ref falha (422) se a branch já existe => já iniciada.
          sha=$(gh api "repos/$R/git/ref/heads/$(gh api repos/$R --jq .default_branch)" --jq .object.sha)
          if gh api "repos/$R/git/refs" -f ref="refs/heads/$BRANCH" -f sha="$sha" >/dev/null 2>&1; then
            echo "go=true" >>"$GITHUB_OUTPUT"
          else
            echo "Branch $BRANCH exists; skipping"; echo "go=false" >>"$GITHUB_OUTPUT"
          fi

      - if: steps.guard.outputs.go == 'true'
        uses: actions/checkout@v6
        with: { ref: "${{ env.BRANCH }}", fetch-depth: 0 }

      # Motor da Factory (ticket 12). Se for a claude-code-action:
      - if: steps.guard.outputs.go == 'true'
        uses: anthropics/claude-code-action@v1
        env:
          CLAUDE_BRANCH: ${{ env.BRANCH }}
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}  # ou anthropic_api_key / WIF
          allowed_bots: "github-actions[bot]"   # runs vindos do agendador (workflow_dispatch via GITHUB_TOKEN)
          additional_permissions: |
            actions: read
          prompt: |
            Implement issue #${{ env.ISSUE }} of ${{ env.R }} on branch ${{ env.BRANCH }}.
            Follow AGENTS.md. Open a PR whose body contains "Closes #${{ env.ISSUE }}".
          claude_args: |
            --max-turns 200
            --allowedTools "Read,Edit,Write,Glob,Grep,Bash(git:*),Bash(gh pr create:*),Bash(gh issue comment:*),Bash(gh issue edit:*)"
```

`.github/workflows/factory-scheduler.yml` (re-disparo das destravadas):

```yaml
name: Factory Scheduler
on:
  issues:
    types: [closed]
  workflow_dispatch: {}          # varredura manual
  # schedule:                    # opcional: varredura periódica (ver R7)
  #   - cron: "17 * * * *"

concurrency:
  group: factory-scheduler
  queue: max                     # serializa as varreduras sem cancelar (GitHub, 2026-05)

jobs:
  dispatch:
    if: github.event_name != 'issues' || github.event.issue.state_reason == 'completed'
    runs-on: ubuntu-latest
    permissions:
      actions: write             # POST .../workflows/{id}/dispatches
      issues: read               # dependencies/* e labels
      contents: read
    env:
      GH_TOKEN: ${{ github.token }}
      R: ${{ github.repository }}
    steps:
      - run: |
          set -euo pipefail
          if [ "$GITHUB_EVENT_NAME" = issues ]; then
            candidates=$(gh api --paginate "repos/$R/issues/${{ github.event.issue.number }}/dependencies/blocking" \
              --jq '.[] | select(.state == "open") | .number')
          else
            candidates=$(gh issue list -R "$R" --label ready-for-agent --state open --limit 500 \
              --json number --jq '.[].number')
          fi
          for n in $candidates; do
            gh api "repos/$R/issues/$n" --jq '[.labels[].name] | index("ready-for-agent")' | grep -qv null || continue
            pending=$(gh api --paginate "repos/$R/issues/$n/dependencies/blocked_by" \
              --jq '.[] | select(.state != "closed" or .state_reason != "completed") | .number')
            [ -z "$pending" ] || continue
            gh api "repos/$R/branches/factory/issue-$n" >/dev/null 2>&1 && continue   # já iniciada
            echo "Dispatching #$n"
            gh workflow run factory.yml -R "$R" -f issue_number="$n"
          done
```

Por que `workflow_dispatch` e não workflow reutilizável (`workflow_call`) dentro do agendador: o run despachado tem contexto limpo (evento de automação, sem issue ou PR "herdado"), aparece como execução própria por issue (logs e re-run isolados) e não fica preso ao ciclo de vida do agendador. O custo é o `allowed_bots`. Em `workflow_call`, o `github` context é sempre o do chamador, então a action veria o evento `issues: closed` do *bloqueador* como contexto. Isso funciona, mas mistura entidades. A comparação está em F11.

## Achados detalhados

### Disparo por label

**F1. `issues: labeled` existe, roda da branch padrão e traz a label no payload.** O evento `issues` aceita, entre outros, os activity types `labeled` e `unlabeled`. `GITHUB_SHA` é o último commit da branch padrão, e o evento "só dispara se o arquivo do workflow existir na branch padrão". O payload `issues.labeled` tem `label` (o objeto da label adicionada), por isso o filtro idiomático é `github.event.label.name`.
Fontes:
- [Events that trigger workflows § issues](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues) (`github/docs` main, último commit no arquivo em 2026-09-21).
- `data/reusables/actions/branch-requirement.md`.
- Schema `webhook-issues-labeled` em `github/rest-api-description` (`descriptions/api.github.com/api.github.com.yaml`, campo `label`).

**F2. Concorrência: um em execução, um pendente por padrão; `queue: max` é novo.**
- `concurrency.group` só aceita os contextos `github`, `inputs` e `vars`.
- Com o comportamento padrão (`queue: single`), cabem um run em execução e um *pendente* por grupo. Um novo pendente cancela o anterior.
- `cancel-in-progress: true` cancela também o que está rodando.
- **Novo (docs de 2026-05-06, feature `actions-nga`, válido em github.com e GHEC):** `queue: max` permite até 100 pendentes em FIFO. Não pode ser combinado com `cancel-in-progress: true`.
- O nome do grupo não diferencia maiúsculas de minúsculas. A ordem segue o momento em que cada run começou a esperar, não o momento do disparo, e "não é garantida".

Fontes:
- [Control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
- `data/reusables/actions/actions-group-concurrency.md` (commit "Update docs for concurrency group queueing and APIs", 2026-05-06).
- `data/features/actions-nga.yml` (`fpt: '*'`, `ghec: '*'`).

**F3. Reutilizáveis: cuidado com o grupo de concorrência compartilhado.** Um workflow chamado usa o `github.workflow` do chamador. Usar o mesmo grupo no chamador e no chamado com `cancel-in-progress: true` cancela o chamador. Fonte: [Reusing workflow configurations](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).

### Dependências nativas (Blocked Issues)

**F4. Endpoints REST de dependências.** Todos são `enabledForGitHubApps: true` e `githubCloudOnly: false`.
- `GET  /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by`: paginado (`per_page` ≤ 100), retorna um array de Issue.
- `POST .../dependencies/blocked_by` com o body `{"issue_id": <id>}`. Atenção: é o **id** da issue, não o número.
- `DELETE .../dependencies/blocked_by/{issue_id}`
- `GET  .../dependencies/blocking`

Os itens retornados são objetos Issue completos (`state`, `state_reason`, `closed_at`, `pull_request`, `labels`…). A página atual da documentação mostra a versão `X-GitHub-Api-Version: 2026-03-10`. Uma chamada real sem o header seleciona `2022-11-28` e funciona.
Fontes:
- [REST: Issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies).
- OpenAPI `github/rest-api-description` (paths `/repos/{owner}/{repo}/issues/{issue_number}/dependencies/*`, `x-github`).
- Teste: `gh api repos/cli/cli/issues/1/dependencies/blocked_by`, que retornou `X-Github-Api-Version-Selected: 2022-11-28`.

**F5. Permissões.** Leitura (`GET blocked_by` e `GET blocking`) pede **Issues: read**. Escrita (`POST` e `DELETE`) pede **Issues: write**. Isso vale para os tokens server-to-server de App, ou seja, também para o `GITHUB_TOKEN`, que é um token de instalação de App. Para comparação: `POST /repos/{o}/{r}/actions/workflows/{id}/dispatches` pede **Actions: write**, e `POST /repos/{o}/{r}/dispatches` (`repository_dispatch`) pede **Contents: write**. Criar dependências pela interface exige ao menos permissão de *triage*, e o recurso está disponível nos planos Free, Pro, Team e GHEC.
Fontes:
- `github/docs` `src/github-apps/data/fpt-2026-03-10/server-to-server-permissions.json`.
- [Creating issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies).

**F6. Semântica de `issue_dependencies_summary`.**
- O REST define só os tipos (4 inteiros obrigatórios).
- O schema GraphQL documenta `totalBlockedBy` como "Total count of issues this issue is blocked by (open and closed)", o que implica que `blockedBy` conta **apenas os abertos**.
- Confirmação empírica: `shadowgate15/shadow-trader#105` tem `blocked_by: 2` e `total_blocked_by: 3`. A lista retorna #96 (closed/completed), #100 (open) e #103 (open).
- O campo pode vir `null`: `cli/cli#1` retornou `"issue_dependencies_summary": null`.
- O summary não distingue "fechada por PR mergeado" de "fechada como not_planned".

Conclusão: use o summary só como atalho e decida pela lista.
Fontes:
- OpenAPI `components/schemas/issue-dependencies-summary`.
- `github/docs` `src/graphql/data/fpt/schema.docs.graphql` (`type IssueDependenciesSummary`).
- Chamadas `gh api` em 2026-10-17.

**F7. Não existe gatilho de Actions para mudança de dependência.** Existe o webhook `issue_dependencies`, com as ações `blocked_by_added`, `blocked_by_removed`, `blocking_added` e `blocking_removed` (assinatura exige Issues: read). Ele **não** aparece na lista de eventos que disparam workflows. Logo, adicionar ou remover um bloqueador não re-dispara nada. Só o fechamento do bloqueador (`issues: closed`) ou uma varredura fazem isso.
Fontes: OpenAPI `webhooks.issue-dependencies-*`; *Events that trigger workflows* (sem entrada `issue_dependencies`).

**F8. "Mergeado" ≈ "fechada como completed via PR na branch padrão".** O merge de um PR ligado por palavra-chave (`close`, `closes`, `fix`, `resolves` etc.) na **branch padrão** fecha a issue automaticamente. Em PRs para outras branches, as palavras-chave são ignoradas. Para checagem estrita ("fechada por um PR mergeado, e não manualmente"), o GraphQL expõe `ClosedEvent.closer: Closer = Commit | ProjectV2 | PullRequest` e `Issue.closedByPullRequestsReferences`.
Fontes: [Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue); schema GraphQL (`type ClosedEvent`, `union Closer`).

### Re-disparo e a regra do `GITHUB_TOKEN`

**F9. Regra atual do `GITHUB_TOKEN`, que mudou em 2026.** Eventos causados pelo `GITHUB_TOKEN` não criam workflow runs, com duas exceções:
1. **`workflow_dispatch` e `repository_dispatch` sempre criam runs.**
2. **Novo:** `pull_request` `opened`, `synchronize` ou `reopened` de um PR criado ou atualizado com `GITHUB_TOKEN` **cria runs em estado "approval-required"**. Alguém com write precisa clicar em *Approve workflows to run*. Os outros tipos (`labeled`, `edited`, `closed`) continuam sem criar run.

A própria documentação diz: "If you need workflow runs from workflow-created pull requests to execute without requiring approval, use a GitHub App installation access token or a PAT instead of `GITHUB_TOKEN`". O arquivo da feature registra "currently rolling out on dotcom".

Fontes:
- `data/reusables/actions/actions-do-not-trigger-workflows.md` (commit de 2026-05-22, "Document GITHUB_TOKEN pull request workflow approval behavior").
- [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token).
- `data/features/actions-github-token-pull-request-approval.yml` (`fpt: '*'`, `ghec: '*'`).

Consequência para a Factory: o agendador pode despachar com `GITHUB_TOKEN`, mas o **PR da Factory não deve ser criado com `GITHUB_TOKEN`**, senão CI e preview ficam presos esperando aprovação.

**F10. Merge de PR e dispatch.**
- Para rodar no merge: `pull_request: types: [closed]` com `if: github.event.pull_request.merged == true`. Em PR fechado por merge, `GITHUB_REF` é a branch de destino.
- `workflow_dispatch`: o workflow precisa estar na branch padrão. Aceita `inputs`, lidos via contexto `inputs`.
- `repository_dispatch`: `event_type` com até 100 caracteres, `client_payload` com até 10 propriedades de topo e 65.535 caracteres. Roda na branch padrão.

Fonte: *Events that trigger workflows* (§ `pull_request` "Running your pull_request workflow when a pull request merges", § `workflow_dispatch`, § `repository_dispatch`).

**F11. Actor de um run despachado pelo `GITHUB_TOKEN`.**
- A documentação só diz que `github.actor` é "the username of the user that triggered the initial workflow run" e não especifica o caso do `GITHUB_TOKEN`.
- Empiricamente, `vercel/next.js` run 38770117667 (`workflow_dispatch`, 2026-10-15) tem `actor = github-actions[bot]`, `type: Bot`.
- Em `workflow_call`, "the `github` context is always associated with the caller workflow". O actor seria o humano que mergeou, mas o evento visto pela action seria o do chamador.

Fontes: [Contexts § github](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context); [Reusing workflow configurations](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations); `gh api repos/vercel/next.js/actions/runs?event=workflow_dispatch&actor=github-actions[bot]`.

**F12. GitHub App vs PAT.** Para *despachar*, o `GITHUB_TOKEN` basta (F9). Uma App própria (via `actions/create-github-app-token`) ou um PAT só são necessários se a automação tiver de causar **outros** eventos que disparem workflows: por exemplo, o agendador adicionar a label `ready-for-agent` para reaproveitar o gatilho `issues: labeled`, ou abrir PRs. A FAQ da action diz o mesmo: "The `github-actions` user cannot trigger subsequent GitHub Actions workflows… use a PAT… or a separate app token of your own".
Fontes: F9; `anthropics/claude-code-action` `docs/faq.md` (2026-07-16).

### `anthropics/claude-code-action@v1`

**F13. Versão.** A tag móvel `v1` aponta para o mesmo commit de `v1.0.252` (`f27be6b`, release de 2026-10-16). O ritmo é de cerca de uma release por dia (v1.0.249 a v1.0.252 entre 14 e 16/10). Recomendação: fixar SHA ou `v1.0.x` no template. Fonte: `gh api repos/anthropics/claude-code-action/releases`, `git/refs/tags/v1`.

**F14. Modos: só `tag` e `agent`, auto-detectados.**
- `src/modes/detector.ts` retorna `"tag" | "agent"`.
- Em evento `issues`: com `prompt`, o modo é `agent`. Sem `prompt`, o modo é `tag` se houver trigger. Em `labeled`, o trigger compara `label.name` com `label_trigger` (padrão `"claude"`) sem diferenciar maiúsculas.
- Em `workflow_dispatch`, `repository_dispatch`, `schedule` e `workflow_run` (eventos de "automação"), o modo é sempre `agent` e só executa se houver `prompt`. Sem prompt, faz *skip* silencioso (`run.ts`: "No trigger found, skipping remaining steps").
- `track_progress: true` força `tag` em eventos de issue e PR.
- Não existe input `mode`: está deprecado, e o `action.yml` ainda passa `MODE: ${{ inputs.mode }}`, um resquício sem efeito. "Automation mode" é o nome usado nas docs para `agent`.

Fontes: `src/modes/detector.ts` (2026-08-07), `src/github/validation/trigger.ts`, `src/github/context.ts` (`AUTOMATION_EVENT_NAMES`), `src/entrypoints/run.ts`, `action.yml`, [code.claude.com/docs/en/github-actions § Interactive and automation modes](https://code.claude.com/docs/en/github-actions).

**F15. Inputs de prompt.**
- `prompt`: texto, ou invocação de skill `/skill-name` (exige `actions/checkout` antes) ou `/plugin:skill`.
- `claude_args`: flags do CLI, como `--max-turns`, `--model`, `--allowedTools`, `--mcp-config`, `--append-system-prompt` e `--json-schema` (vira o output `structured_output`).
- `settings`: JSON ou caminho.
- `plugins` e `plugin_marketplaces`.
- No modo `agent`, o arquivo de prompt é exatamente o `prompt` do usuário (`src/modes/agent/index.ts`), sem comentário de rastreio. Para prompt em texto puro, o Claude "has no shell or GitHub API access until you grant the tools".
- Outputs: `conclusion`, `branch_name`, `session_id`, `structured_output`, `execution_file`.

Fontes: `action.yml`; `src/modes/agent/index.ts`; code.claude.com (§ Run a skill, § Run on a schedule).

**F16. Autenticação.**
- `anthropic_api_key`: Console, cobrança da API. É a recomendação da Anthropic para segredo compartilhado por organização.
- `claude_code_oauth_token`: assinatura Pro, Max, Team ou Enterprise. O token tem validade de **um ano** e é gerado com `claude setup-token`. Ele "is tied to the subscription of the person who ran `claude setup-token`", só faz requisições de modelo, e os runs consomem a assinatura em vez da API.
- **Workload Identity Federation** (`anthropic_federation_rule_id` + `anthropic_organization_id`, e opcionalmente `anthropic_service_account_id` e `anthropic_workspace_id`): troca o OIDC do GitHub por acesso de curta duração. Exige `id-token: write`. Uma credencial estática presente tem precedência e desliga a federação. `classify_inline_comments` exige `anthropic_api_key`.

Para um template público, o bootstrap deveria oferecer API key ou WIF como caminho padrão e OAuth como opção individual. Nota: execuções paralelas da Factory dividem a mesma cota da assinatura. A doc não dá números de limite para esse uso.
Fontes: `action.yml`; `docs/setup.md`; [code.claude.com/docs/en/github-actions](https://code.claude.com/docs/en/github-actions) (§ Manual setup, § Set up for an organization, § Manage costs); [code.claude.com/docs/en/authentication § Generate a long-lived token](https://code.claude.com/docs/en/authentication).

**F17. Token do GitHub e permissões para push e PR.**
- Sem `github_token`, a action pede um OIDC token (exige `id-token: write`) e o troca em `api.anthropic.com/api/github/github-app-token-exchange` por um token da **Claude GitHub App**.
- Permissões padrão pedidas: `contents: write`, `pull_requests: write` e `issues: write`. Extras vêm via `additional_permissions` (por exemplo `actions: read`).
- O token é revogado no fim (step "Revoke app token").
- Ao usar uma App própria: `github_token: ${{ steps.app-token.outputs.token }}`, com a App tendo Contents, Issues e Pull requests em R/W.
- As docs oficiais usam no job: `contents: write`, `pull-requests: write`, `issues: write`, `id-token: write` e, opcionalmente, `actions: read`.
- Troubleshooting oficial: "GitHub doesn't trigger workflows on commits made with the default `GITHUB_TOKEN`… remove it so it authenticates as the Claude GitHub App".
- Em workflow novo ainda não presente na branch padrão, a troca falha com `workflow_not_found_on_default_branch` e a action faz skip.

Fontes: `src/github/token.ts` (2026-06-17); `action.yml`; `docs/setup.md`; code.claude.com (§ Troubleshooting "CI not running on Claude's commits").

**F18. Abertura de PR.** "Claude doesn't create PRs by default": no modo `tag`, ele faz push e posta um link de PR pré-preenchido. No modo `agent`, cria o PR se o prompt mandar e a ferramenta for liberada. O exemplo oficial `examples/ci-failure-auto-fix.yml` libera `Bash(git:*)` e `Bash(gh:*)`. No modo `agent`, a action não cria branch: ela usa `CLAUDE_BRANCH` (env), ou `GITHUB_HEAD_REF`/`GITHUB_REF_NAME`, ou a branch padrão. A Factory deve, portanto, criar e checar a branch `factory/issue-N` antes do step. O `branch_name_template` só vale no modo `tag`.
Fontes: `docs/faq.md`, `docs/security.md` § Pull Request Creation, `src/modes/agent/index.ts`, `examples/ci-failure-auto-fix.yml`.

**F19. Quem pode disparar a action (afeta o agendador).**
- (i) **Write access**: checado em eventos de entidade (issues, PR, comentários) e em `workflow_run`. Eventos de automação (`workflow_dispatch`, `schedule`) pulam essa checagem.
- (ii) **Human actor**: checado em **todo** evento (`checkHumanActor` é chamado em `prepareAgentMode` e `prepareTagMode`). Bots são rejeitados, a menos que estejam em `allowed_bots` (`*` libera todos). Em `schedule`, o actor é "usually the one who last changed the workflow's cron".

Consequência: o run despachado pelo agendador (actor `github-actions[bot]`, ver F11) falha sem `allowed_bots: "github-actions[bot]"`. A doc de segurança alerta que bots permitidos não passam pela checagem de permissão e que `'*'` em repositório público deixa Apps externas invocarem a action.
Fontes: `src/github/validation/actor.ts` (2026-05-19), `src/github/validation/permissions.ts`, `src/entrypoints/run.ts`, `docs/security.md` (2026-08-05), code.claude.com § Who can trigger runs.

**F20. Evitar execuções duplicadas: o que existe e o que falta.** A action não tem deduplicação própria além de checar o trigger. As camadas recomendadas são:
1. O `if:` no job pela label (evita runner por label irrelevante).
2. `concurrency` por issue no job, com `cancel-in-progress: false`.
3. Um guard idempotente no início do job.
4. Um lock atômico com nome determinístico: criar `refs/heads/factory/issue-N` via `POST /git/refs`, que falha se o ref já existe.
5. `concurrency` com `queue: max` no agendador, para serializar as varreduras.

Também é preciso evitar sobreposição com o `claude.yml` atual, que reage a `issues: opened/assigned` com `@claude` no corpo.
Fontes: F2, F14, F19; `.github/workflows/claude.yml` deste repo.

## Riscos e lacunas

- **R1 (fonte omissa): actor de `workflow_dispatch` via `GITHUB_TOKEN`.** A documentação do GitHub não diz qual é. A evidência é empírica (`github-actions[bot]`, F11). Se mudar, o `allowed_bots` precisa acompanhar.
- **R2 (fonte omissa): actor do `issues: closed` automático por merge.** Não está documentado quem é o actor (presumivelmente quem mergeou). Também não está documentado se o fechamento disparado por um merge via merge queue gera o evento normalmente. A varredura (`workflow_dispatch`/`schedule`) é a rede de segurança.
- **R3 (fonte omissa): `labeled` na criação.** A documentação não diz se criar uma issue já com a label (`gh issue create --label ready-for-agent`) emite `issues: labeled`. É preciso testar. Se não emitir, adicionar `opened` aos tipos e checar a label no `if`.
- **R4 (fonte omissa): concorrência de job pulado.** A documentação não diz se um job com `if:` falso entra no grupo de `concurrency`. Por isso o esboço põe `concurrency` no **job**, não no workflow. No nível de workflow, um `labeled` com outra label criaria um run pendente que cancelaria um pendente legítimo do mesmo grupo (F2).
- **R5 (resposta exata não verificada): lock por ref.** A OpenAPI não detalha a mensagem do `POST /git/refs` quando o ref já existe. Tratar qualquer falha como "já iniciada" é seguro, mas é preciso testar.
- **R6 (decisão pendente): retry após Escalation ou crash.** Com o lock por branch, re-rotular `ready-for-agent` não reinicia a issue enquanto a branch existir. Fica para o ticket de execução de Stages decidir se o retry retoma a branch existente ou a apaga.
- **R7: `schedule`.** O GitHub só roda `schedule` a partir da branch padrão e, em repositório público, desativa o agendamento após 60 dias sem atividade (code.claude.com § Run on a schedule). Em `schedule`, o actor é quem editou o cron por último, então o `checkHumanActor` vale para ele.
- **R8: closed ≠ mergeado.** A regra `state_reason == completed` aceita uma issue fechada manualmente como "completed" sem PR. Para garantir que houve merge, checar `ClosedEvent.closer` (GraphQL, F8). Isso tem custo de uma consulta extra por bloqueador.
- **R9: summary `null`.** O summary pode vir `null` (F6). Não confiar nele para decidir.
- **R10 (contradição): workflows.** O FAQ diz que "The GitHub App for Claude doesn't have workflow write access". A tabela de permissões da Claude App em code.claude.com lista *Workflows: Read and write*. E `token.ts` pede só `contents`, `pull_requests` e `issues` (mais `additional_permissions`). Na prática, o token emitido não tem `workflows`, então issues que alterem `.github/workflows/` vão falhar no push. Não está documentado se `additional_permissions: workflows: write` é aceito pela troca.
- **R11 (contradição): `workflow_dispatch`.** `docs/custom-automations.md` lista `workflow_dispatch` como "(coming soon)". Mas `src/github/context.ts` já o trata como evento de automação, e `examples/manual-code-analysis.yml` o usa. Vale o código.
- **R12 (inconsistência): `bot_id`.** O padrão do `bot_id` (`41898282`) é descrito no `action.yml` como "Claude's bot ID", mas a API de usuários retorna esse id como `github-actions[bot]`. O id de `claude[bot]` é `209825114`. Afeta só a atribuição dos commits feitos via git.
- **R13: OAuth e paralelismo.** O token OAuth fica preso à assinatura de uma pessoa, e N issues em paralelo consomem a mesma cota. A doc não dá limite numérico. Para o template público, API key ou WIF são mais previsíveis.
- **R14: ritmo de releases.** A action lança cerca de uma release por dia (F13). Fixar a versão e ter um processo de atualização.
- **R15: escopo do motor.** Tudo acima sobre a action só vale se ela for o motor. O desenho de gatilho e agendador (F1–F12) é agnóstico ao motor. O motor em si é decidido no ticket 12, e a execução headless nos tickets 01 e 02.
