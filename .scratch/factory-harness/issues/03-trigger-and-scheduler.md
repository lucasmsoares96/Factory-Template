# Gatilho por label e agendador de Blocked Issues

Type: research
Status: resolved

## Question

Qual é a forma recomendada hoje de: (a) disparar um job do GitHub Actions quando uma issue recebe a label `ready-for-agent` (evento `issues: labeled`, filtros, concorrência por issue); (b) consultar as **dependências nativas** de issues do GitHub (`blocked_by`, `issue_dependencies_summary`) para não iniciar uma Blocked Issue; (c) re-disparar as issues destravadas quando um PR é mergeado (evento `pull_request: closed` + `merged`, `workflow_dispatch`, `repository_dispatch`, e a restrição de que eventos criados com `GITHUB_TOKEN` não disparam outros workflows — GitHub App vs PAT)? Inclua o estado atual do `anthropics/claude-code-action@v1`: modos (tag/agent/automation), inputs de prompt, autenticação (`claude_code_oauth_token` vs `anthropic_api_key`), permissões necessárias para push de branch e abertura de PR, e como evitar execuções duplicadas.

## Answer

O workflow `factory.yml` dispara em `issues: [labeled]`, filtrando `label.name == 'ready-for-agent'`, e aceita `workflow_dispatch(issue_number)`. A concorrência fica **no job**, com o grupo `factory-issue-<N>` e `cancel-in-progress: false`. Antes do motor roda um guard idempotente: confere se a issue está aberta e com a label, se todos os bloqueadores em `GET .../dependencies/blocked_by` estão `closed`+`completed`, e cria o ref `factory/issue-N` como lock atômico.
O `issue_dependencies_summary.blocked_by` conta só os bloqueadores abertos, pode vir `null` e não distingue not_planned. Por isso a decisão usa a lista; o summary serve só de atalho. Mudar uma dependência não dispara Actions.
O agendador escuta `issues: [closed]` com `state_reason == completed` e percorre `.../blocking`. Para cada destravada, roda `gh workflow run` com o próprio `GITHUB_TOKEN` (`actions: write`), porque `workflow_dispatch` é exceção à regra do token: não precisa de PAT nem App. A varredura fica em `workflow_dispatch` e, opcionalmente, em `schedule`.
Novidade de 2026: um PR criado com `GITHUB_TOKEN` gera runs que exigem aprovação. O PR da Factory deve sair pelo token da Claude App ou de uma App própria.
`claude-code-action@v1` (= v1.0.252, 2026-10-16) tem só dois modos, `tag` e `agent`, auto-detectados pela presença de `prompt`. A autenticação aceita API key, OAuth (1 ano, preso à pessoa) ou WIF. O token da App vem por OIDC (`id-token: write`) e cobre contents, PRs e issues. O PR só é aberto se o prompt pedir e `gh pr create` for liberado. O run despachado tem actor `github-actions[bot]`, então exige `allowed_bots: "github-actions[bot]"`.

[pesquisa](../research/03-trigger-and-scheduler.md)
