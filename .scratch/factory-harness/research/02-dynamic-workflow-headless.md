# Pesquisa 02: dynamic workflow headless no GitHub Actions

Ticket: [02-dynamic-workflow-headless](../issues/02-dynamic-workflow-headless.md)
Data: 2026-10-17. Versões verificadas: Claude Code CLI **2.1.302** (instalado localmente e topo do CHANGELOG), `anthropics/claude-code-action` **v1.0.252** (16/10/2026), que depende de `@anthropic-ai/claude-agent-sdk ^0.3.302`.

## Resposta

**Sim, roda headless, mas só via `claude -p` (ou Agent SDK) chamado direto num step do Actions. Pelo `anthropics/claude-code-action@v1` não funciona hoje.** A doc oficial diz que workflows funcionam em `claude -p` e no Agent SDK [W1], sem o prompt de aprovação: o lançamento passa pelas regras de permissão normais, então basta a allow rule `Workflow(<name>)` [W2]. O `claude -p` espera o workflow em background terminar antes de sair [H1]. O `claude-code-action`, por sua vez, sai do loop do SDK na **primeira** `result` message [A1]. Num workflow, essa primeira `result` é a do turno de lançamento, e a conclusão chega num turno posterior com sua própria `result` [S1][C1]. Assim, a action encerraria a sessão logo depois de lançar o workflow.

Respostas diretas às perguntas do ticket:

- **Paralelismo = 1**: `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=1` (CLI ≥ 2.1.269) [E1], somado a um script que só faz `await` sequencial, sem `parallel()`/`pipeline()`.
- **Issue como `args`**: o Workflow tool aceita `args` (JSON) e o script lê o global `args` [S2]. O workflow salvo fica em `.claude/workflows/factory-issue.js` e é chamado pelo nome [W3].
- **Loop com limite de 5**: um `while` comum em JS, com `agent(..., {schema})` devolvendo `{passed, feedback}` [W4]. Esboço abaixo.
- **Opt-in**: a palavra-chave `ultracode` **não** vale em `-p` [W5]. O que vale é o pedido explícito do usuário, como "run the saved workflow X" ou um slash command cujas instruções mandam chamar Workflow. Essa regra está na descrição do tool [B1] e é confirmada pelo cookbook oficial para o SDK [C1]. A permissão é separada: `--allowedTools "Workflow(factory-issue)"` [W2]. Workflows vêm ligados por padrão com acesso via API e em todos os planos pagos, menos o Pro (lá é preciso `enableWorkflows: true`) [W1][ST1].
- **Recomendação**: adotar o Workflow via `claude -p` como motor da Factory, **condicionado a um spike curto**: um job de Actions que roda um workflow salvo de 2 agentes e confere lançamento, espera e `result` final. Se o spike falhar, ou se o lançamento mediado pelo modelo se mostrar instável, o fallback é um **orquestrador em TypeScript com o Agent SDK**. Ele roda o mesmo loop de Stages em código, com um `query()` por Stage, e é totalmente determinístico. Não recomendo `claude-code-action` com prompt orquestrador como motor, porque aí o loop e o contador de voltas ficam a cargo do modelo.

## Achados detalhados

### 1. Workflows funcionam em modo não interativo

- "Workflows are available in the CLI, the Desktop app, the IDE extensions, non-interactive mode with `claude -p`, and the Agent SDK." [W1, seção *Turn workflows off*]
- O Workflow tool existe no Agent SDK TypeScript desde a v0.3.149 [S2]. No Python, exige CLI ≥ 2.1.154, empacotado no `claude-agent-sdk` ≥ 0.2.90 [C1]. Dynamic workflows foram introduzidos no CLI 2.1.154 [CL: 2.1.154].
- Disponibilidade: "all paid plans, with Anthropic API access, and on Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry. On Pro, turn them on…" [W1]. O padrão de `enableWorkflows` é "unset, so workflows are on unless you're on the Pro plan" [ST1]. Workflows são desligados por `disableWorkflows`, por `CLAUDE_CODE_DISABLE_WORKFLOWS=1` [ST1][E1] e pelo `--safe-mode` (help do CLI 2.1.302).
- A doc ainda chama o recurso de *research preview*, e ele chegou junto com o Opus 4.8 (resultado da busca oficial em code.claude.com). A página de workflows não promete estabilidade de API.

### 2. Permissão e opt-in em `-p`

- Em `claude -p` e no Agent SDK, "Claude Code never shows this prompt. It runs the Workflow tool call through the same permission evaluation as the rest of the session". Há cinco formas de liberar: allow rule `Workflow` ou `Workflow(<name>)`, auto mode, bypass permissions, hook `PreToolUse` que retorna `allow`, ou `--permission-prompt-tool`/`canUseTool` [W2].
- Os subagents do workflow "use your permission rules". Por isso convém liberar antes todas as ferramentas de que eles vão precisar [W2]. Em auto mode, o prompt passado a `agent()` não conta como pedido do usuário para o classificador [W4].
- A palavra-chave `ultracode` "doesn't start a workflow when it reaches the session another way: a prompt passed with `-p`; a prompt an Agent SDK application sends without stamping it as human input; a scheduled task prompt; a webhook payload or pull request comment" [W5]. Até a v2.1.210, um payload de webhook ou um comentário de PR também disparava [W5].
- A regra de opt-in para o **modelo** está na descrição do Workflow tool, extraída do binário 2.1.302. Ela não aparece nas páginas da doc. Contam como opt-in: a keyword, ultracode ligado, um pedido direto ("use a workflow"…), "a skill or slash command whose instructions tell you to call Workflow" e "The user asked you to run a specific named or saved workflow" [B1].
- O cookbook oficial do SDK confirma o caminho: "Allow the `Workflow` tool in `allowed_tools`" + "Ask for a workflow in your prompt in plain words… from the SDK, a plainly worded request is all you need." [C1]
- **Consequência:** quem lança o workflow é o **modelo**, ao chamar o tool. Não existe flag oficial do tipo `claude workflow run <name>`: o `claude --help` 2.1.302 não tem esse subcomando. O binário traz `CLAUDE_WORKFLOW_NAME_ONLY`, que restringe o tool a `{name, args}`, mas essa variável **não está documentada** em env-vars [B1][E1]. Não usar.

### 3. Espera pelo término em `claude -p`

- "After Claude finishes its turn and stdin has closed, a `claude -p` run can stay open to wait for background work… Background subagents and workflows: the run stays open until that work completes, because its result is part of the final output." [H1]
- **Atenção à contradição aparente:** a mesma seção diz que, salvo comando de background iniciado pela conversa principal, o Claude Code "stops whatever is still running after 10 minutes of continuous idle waiting by default". A doc de `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` diz que o teto vale para "idle waiting for background work, such as subagents and workflows… Set to `0` to wait indefinitely" (CLI ≥ 2.1.182) [H1][E1]. **Usar `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`** no job e confiar no `timeout-minutes` do Actions.
- Com `--output-format json`, sai só a `result` do último turno. Com `text`, cada turno é impresso (≥ 2.1.295) [H1][CL: 2.1.295].
- `--max-budget-usd` interrompe o background work quando estoura [H1]. Serve como teto de custo por issue.
- **Não usar `--bare`**: desde a 2.1.286, `--bare` "start[s] no background tasks" [H2][CL: 2.1.286], e o workflow roda como background task [S2]. O que a doc não diz literalmente é "workflow não roda em `--bare`". A conclusão é inferida, então fica como risco a validar no spike.
- Pausa por limite de uso **não** acontece em `-p`/SDK: o agente falha [W6]. Com API key isso não importa. Com OAuth de assinatura, importa.

### 4. Por que `claude-code-action@v1` não serve para Workflow (hoje)

- A action roda Claude pelo Agent SDK (`query()`) [A1]. A doc de Actions diz: "The Claude Code GitHub Action is built on the SDK" [GA1].
- Em `base-action/src/run-claude-sdk.ts` (tag v1.0.252, linha 209), o loop faz `break` na primeira mensagem `type === "result"`. O comentário justifica: "by SDK contract no further messages follow a result" [A1].
- Isso contraria o comportamento documentado com background tasks. A referência TS diz: "When the SDK injects a synthetic follow-up turn, such as for a finished background task, the resulting `SDKResultMessage` carries `origin: { kind: "task-notification" }`" [S1]. O cookbook diz: "Because the launch is one turn and the completion is another, the stream yields a `ResultMessage` for each turn. The last one carries the final result" [C1].
- Além disso, o Workflow tool "Returns immediately after the tool accepts the invocation. The final result arrives later as a task completion" [S2]. Conclusão: a action sairia logo após o turno de lançamento. Esta é uma inferência a partir do código e da doc, não testada.
- Nem o README nem `docs/*.md` da action mencionam o Workflow tool. O repositório da action tem um workflow salvo (`.claude/workflows/pr-stamp-sweep.js`, commit 82d95d4, 12/06/2026), mas nada indica que ele rode via Actions [A2].

### 5. Paralelismo = 1

- Limite do runtime: "Up to 16 concurrent agents by default… To change the limit, set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` to a value from 1 to 256, which requires Claude Code v2.1.269 or later" [W7][E1][CL: 2.1.269].
- No script: `agent()` com `await` direto é sequencial. `parallel()` e `pipeline()` são as primitivas concorrentes [W4]. Com o env em 1, mesmo um `pipeline()` acidental fica serializado.
- Outros limites: 1.000 agentes por run, 4.096 itens por `parallel()`/`pipeline()`, sem `import()` e sem acesso direto a filesystem/shell a partir do script [W7]. `Date.now()`, `Math.random()` e `new Date()` sem argumento lançam erro [W4].
- Stall: um agente sem output por 10 min (padrão de `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`, que cobre agentes de workflow a partir da 2.1.286) é reiniciado até 5 vezes. Tempo esperando as próprias tool calls não conta. Dá para ajustar por chamada com `agent(prompt, { stallMs })` [W6][E1]. Um agente **com `await` direto** que esgota as tentativas encerra a run com erro, enquanto dentro de `parallel`/`pipeline` vira `null` [W6]. Por isso o script deve usar `try/catch`.

### 6. `args` e workflow salvo

- `WorkflowInput = { script?, name?, scriptPath?, args?, resumeFromRunId?, ... }`. Os campos `name` ("built-in workflow or one saved in `.claude/workflows/`") e `args` ("Input value exposed to the script as the global `args`… Pass arrays and objects as actual JSON values, not as a JSON-encoded string") [S2].
- Workflows salvos ficam em `.claude/workflows/` e viram `/<name>`. O `meta` precisa ser literal puro, com `name` e `description` [W3][W4].
- Em `-p`, "User-invoked skills and custom commands work. Include `/skill-name` in the prompt string" [H3]. **A doc não diz explicitamente** se comandos de *workflow salvo* expandem em `-p` nem como o texto após `/<name>` vira `args`. No exemplo interativo, "Claude passes the list as structured data" [W3], ou seja, é o modelo que monta `args`. Para não depender disso, o prompt pode nomear o workflow e dar o JSON literal de `args` (ver esboço).
- `agent()` aceita `agentType` para usar um subagent customizado de `.claude/agents/`, além de `schema`, `model`, `effort` e `isolation: 'worktree'`. Isso está no skill `workflow-authoring` empacotado no CLI 2.1.302 [B2]. A página web cita só `schema` e `stallMs` [W4].
- Resume: `resumeFromRunId` funciona só na **mesma sessão** [S2][W8]. Num runner efêmero, o job que morre perde o resume, salvo persistindo `~/.claude/projects` e usando `claude -p --resume`. Esse caminho não foi verificado.

### 7. Como expressar Exploration → Development → E2E → Review com 5 voltas

O script coordena, e quem lê, edita, roda testes e chama `gh` são os agentes [W7]. O estado entre Stages passa por valores de retorno estruturados (`schema`) e pelo branch git no disco. A semântica de "5 voltas" segue o GLOSSARY: a Escalation acontece depois de 5 falhas em E2E ou Review.

```js
export const meta = {
  name: 'factory-issue',
  description: 'Take one ready issue through Exploration, Development, E2E and Review, then open a PR or escalate',
  phases: [
    { title: 'Exploration' }, { title: 'Development' }, { title: 'E2E' },
    { title: 'Review' }, { title: 'Deliver' },
  ],
}

const MAX_FAILURES = 5
const { issue, branch } = args // ex.: { issue: 42, branch: 'factory/42' }
const VERDICT = {
  type: 'object',
  properties: { passed: { type: 'boolean' }, feedback: { type: 'string' } },
  required: ['passed', 'feedback'],
}
const PLAN = {
  type: 'object',
  properties: { plan: { type: 'string' }, acceptance: { type: 'array', items: { type: 'string' } } },
  required: ['plan', 'acceptance'],
}

async function step(prompt, opts) {
  try { return await agent(prompt, opts) } catch (e) { log(`agent failed: ${e}`); return null }
}

phase('Exploration')
const plan = await step(`Read GitHub issue #${issue} with gh. Explore the code. Return a plan and acceptance criteria.`,
  { agentType: 'explorer', schema: PLAN, phase: 'Exploration' })
if (!plan) return { outcome: 'error', stage: 'Exploration' }

let failures = 0, feedback = '', passed = false
while (failures < MAX_FAILURES) {
  await step(`On branch ${branch}, implement issue #${issue}. Plan: ${plan.plan}. ${feedback ? 'Fix this feedback: ' + feedback : ''} Commit and push.`,
    { agentType: 'developer', phase: 'Development', label: `dev ${failures + 1}` })

  const e2e = await step(`Run the E2E suite for branch ${branch} against acceptance: ${plan.acceptance.join('; ')}.`,
    { agentType: 'e2e', schema: VERDICT, phase: 'E2E', label: `e2e ${failures + 1}` })
  if (!e2e || !e2e.passed) { failures++; feedback = e2e ? e2e.feedback : 'E2E agent failed'; continue }

  const review = await step(`Review the diff of ${branch} vs main for issue #${issue}.`,
    { agentType: 'reviewer', schema: VERDICT, phase: 'Review', label: `review ${failures + 1}` })
  if (!review || !review.passed) { failures++; feedback = review ? review.feedback : 'Review agent failed'; continue }

  passed = true
  break
}

phase('Deliver')
const deliver = passed
  ? `Open a ready-for-review PR from ${branch} closing #${issue}, with evidence (screenshots, test output).`
  : `Escalate: open a DRAFT PR from ${branch}, comment on #${issue} explaining the last failure (${feedback}), add label ready-for-human.`
const pr = await step(deliver, { schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, phase: 'Deliver' })
return { outcome: passed ? 'pr' : 'escalated', failures, pr: pr && pr.url }
```

### 8. Esboço da chamada no GitHub Actions (sem `claude-code-action`)

```yaml
jobs:
  factory:
    runs-on: ubuntu-latest
    timeout-minutes: 300          # limite duro de 6 h por job em runner hospedado [GH1]
    permissions: { contents: write, pull-requests: write, issues: write }
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      GH_TOKEN: ${{ secrets.FACTORY_GH_TOKEN }}   # PAT/App token: GITHUB_TOKEN não dispara outros workflows [A3]
      CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: "1"
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"
    steps:
      - uses: actions/checkout@v6
      - run: |
          curl -fsSL https://claude.ai/install.sh | bash -s 2.1.302   # versão fixada [I1]
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - run: git checkout -b "factory/${{ inputs.issue }}"
      - run: |
          claude -p "Run the saved workflow factory-issue with args {\"issue\": ${{ inputs.issue }}, \"branch\": \"factory/${{ inputs.issue }}\"}. Do not do the work yourself." \
            --allowedTools "Workflow(factory-issue)" \
            --permission-prompts none \
            --max-budget-usd 40 \
            --output-format stream-json --verbose > run.jsonl
      # validar: houve tool_use Workflow e a última result não é erro; senão, falhar o job
```

- As permissões dos subagents (Edit, `Bash(pnpm *)`, `Bash(gh *)`, `Bash(git *)` etc.) ficam em `.claude/settings.json` do repo, não no CLI, para valerem para os agentes do workflow [W2].
- `--permission-prompts none` faz negar o que pediria aprovação, em vez de travar o job (≥ 2.1.259) [H4].
- Fixar a versão do CLI. Recursos usados e versões mínimas: concorrência via env, 2.1.269. `--permission-prompts`, 2.1.259. Stall de workflow via env, 2.1.286. Saída de texto por turno, 2.1.295 [E1][H1][H4].

### 9. Alternativas oficiais, caso Workflow headless seja descartado

| Opção | Como | Determinismo do loop | Observações |
| - | - | - | - |
| **A. Orquestrador Agent SDK (TS)** | Script Node no Actions; um `query()` por Stage, com `outputFormat`/JSON Schema para o veredito; loop e contador em código | Total (código seu) | API estável e documentada; a própria action é construída sobre o SDK [GA1]. Mais código para manter; cada Stage é uma sessão nova; carrega `.claude/agents`, skills e CLAUDE.md via `settingSources` [S3] |
| **B. `claude -p` por Stage em bash** | Mesmo que A, em shell, com `--json-schema` e `--output-format json` | Total | Mais simples que A; `--json-schema` tem retries via `MAX_STRUCTURED_OUTPUT_RETRIES` [E1] |
| **C. `claude-code-action` + prompt orquestrador + subagents em `.claude/agents/`** | Um prompt manda o agente principal chamar subagents em foreground em sequência | Do modelo | Funciona hoje com a action; o modelo conta as voltas e decide o retorno; contexto do orquestrador cresce; limite de 20 subagents concorrentes por sessão [SA1] |
| **D. Workflow via `claude -p`** (recomendado, com spike) | Seção 8 | Total dentro do script; lançamento mediado pelo modelo | Research preview; depende das esperas de background em `-p` |
| **E. Workflow via `claude-code-action`** | n/a | n/a | Inviável na v1.0.252 (seção 4) |

## Riscos e incógnitas

1. **Lançamento depende do modelo.** Não há comando determinístico para executar um workflow salvo. O modelo pode, em tese, fazer o trabalho sozinho em vez de chamar `Workflow`. Mitigação: prompt explícito, tool restrito e checagem no `stream-json` de que houve `tool_use` `Workflow`. Se não houve, o job falha.
2. **Expansão de `/<workflow>` em `-p`**: a doc não diz se comandos de workflow salvo expandem em `-p` nem como os argumentos viram `args` [H3][W3]. O esboço evita depender disso.
3. **Teto de 10 min de espera ociosa**: a doc é ambígua sobre se ele corta workflows [H1][E1]. Usar `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` e validar no spike com um agente longo.
4. **`--bare`** provavelmente impede o workflow, porque não inicia background tasks [H2]. Não usar. Com isso, hooks e `.mcp.json` do projeto rodam em `-p` sem trust dialog [H2], o que exige cuidado com prompt injection vindo do corpo da issue.
5. **Research preview**: API do script, limites e regras de opt-in podem mudar. O CHANGELOG mostra mudanças frequentes, como a troca da keyword de `workflow` para `ultracode` na 2.1.160 [CL].
6. **Resume entre jobs**: o resume funciona só na mesma sessão [S2][W8]. Se o job do Actions morrer por timeout, a issue recomeça. O branch pushado preserva o código, não o progresso do script.
7. **Limite de 6 h por job** [GH1]: 5 voltas com E2E contra preview podem se aproximar disso. Sem dados de duração ainda.
8. **`claude-code-action` pode corrigir o `break`** em versão futura, o que reabriria a opção E. Hoje (v1.0.252), não.
9. **`agentType` em `agent()`** está documentado só no skill empacotado [B2], não na página web. Validar no spike que subagents de `.claude/agents/` resolvem dentro do workflow em `-p`.
10. **Auth por assinatura (OAuth)**: no plano Pro os workflows vêm desligados [ST1], e em `-p` não há pausa por limite de uso [W6]. Preferir `ANTHROPIC_API_KEY` ou workload identity no Actions.

## Fontes

- [W1] Workflows, seções *Note* e *Turn workflows off*: https://code.claude.com/docs/en/workflows (lido em 2026-10-17)
- [W2] Workflows, *Approve the plan before it runs*: https://code.claude.com/docs/en/workflows#approve-the-plan-before-it-runs
- [W3] Workflows, *Save the workflow for reuse* / *Pass input to a saved workflow*: https://code.claude.com/docs/en/workflows#save-the-workflow-for-reuse
- [W4] Workflows, *What the saved script looks like* / *Edit a saved script*: https://code.claude.com/docs/en/workflows#what-the-saved-script-looks-like
- [W5] Workflows, *Where the keyword works*: https://code.claude.com/docs/en/workflows#where-the-keyword-works
- [W6] Workflows, *When a run hits your usage limit* / *When an agent stalls and restarts*: https://code.claude.com/docs/en/workflows#when-an-agent-stalls-and-restarts
- [W7] Workflows, *How a workflow runs* / *Behavior and limits*: https://code.claude.com/docs/en/workflows#behavior-and-limits
- [W8] Workflows, *Resume after a pause*: https://code.claude.com/docs/en/workflows#resume-after-a-pause
- [H1] Headless, *Background tasks at exit*: https://code.claude.com/docs/en/headless#background-tasks-at-exit
- [H2] Headless, *bare mode*: https://code.claude.com/docs/en/headless
- [H3] Headless, nota sobre comandos em `-p` (*Create a commit*): https://code.claude.com/docs/en/headless
- [H4] Headless, `--permission-prompts`: https://code.claude.com/docs/en/headless
- [S1] Agent SDK TS reference, `SDKResultMessage.origin`: https://code.claude.com/docs/en/agent-sdk/typescript
- [S2] Agent SDK TS reference, `Workflow` tool input/output: https://code.claude.com/docs/en/agent-sdk/typescript#workflow
- [S3] Agent SDK, *Use Claude Code features in the SDK*: https://code.claude.com/docs/en/agent-sdk/claude-code-features
- [SA1] Subagents, *Concurrent subagent limit*: https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit
- [E1] Environment variables (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`, `CLAUDE_CODE_DISABLE_WORKFLOWS`, `MAX_STRUCTURED_OUTPUT_RETRIES`): https://code.claude.com/docs/en/env-vars
- [ST1] Settings reference, `enableWorkflows` / `disableWorkflows`: https://code.claude.com/docs/en/settings-reference#enableworkflows
- [GA1] Claude Code GitHub Actions: https://code.claude.com/docs/en/github-actions
- [I1] Setup, install script com versão: https://code.claude.com/docs/en/setup
- [C1] Cookbook oficial *Orchestrate subagents at scale with dynamic workflows* (Agent SDK, publicado em 22/07/2026): https://platform.claude.com/cookbook/claude-agent-sdk-08-dynamic-workflows
- [A1] `anthropics/claude-code-action` v1.0.252, `base-action/src/run-claude-sdk.ts` (break na linha 209) e `base-action/package.json`: https://github.com/anthropics/claude-code-action/blob/v1.0.252/base-action/src/run-claude-sdk.ts
- [A2] `anthropics/claude-code-action`, `.claude/workflows/pr-stamp-sweep.js`: https://github.com/anthropics/claude-code-action/blob/main/.claude/workflows/pr-stamp-sweep.js
- [A3] `anthropics/claude-code-action`, `docs/faq.md` (GITHUB_TOKEN não dispara workflows): https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md
- [CL] CHANGELOG do Claude Code (entradas 2.1.154, 2.1.160, 2.1.269, 2.1.286, 2.1.295): https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- [B1] Descrição do Workflow tool e gate `CLAUDE_WORKFLOW_NAME_ONLY`, extraídos (somente leitura, via `strings`) do binário local do Claude Code 2.1.302 (`~/.local/share/claude/versions/2.1.302`). Não documentados na web.
- [B2] Skill empacotado `workflow-authoring` do CLI 2.1.302 (assinatura de `agent()` com `agentType`, `isolation`, `effort`).
- [GH1] GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
