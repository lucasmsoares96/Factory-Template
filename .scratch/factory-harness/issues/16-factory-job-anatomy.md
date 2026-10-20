# Anatomia do job da Factory e interface do adaptador de forja

Type: grilling
Status: resolved

## Question

Como o job da Factory se divide entre YAML e código, e qual é a interface do adaptador de forja? Pontos a fechar:
- **Três workflows** (de [Contrato de cada Stage e do loop](15-stage-contracts.md)): issue (Development → Review → E2E), Triage `factory-explore` (em lote) e comentários no PR (loop curto).
- **Steps do workflow**: guard (permissão de quem rotulou, bloqueadores, spec pai, critérios, seams, trava por label `in-progress`) → setup (Node, Claude CLI, Docker/Postgres) → script Sandcastle (sem `FACTORY_TOKEN`) → push, PR e evidência (com `FACTORY_TOKEN`) → Escalation.
- **Onde vive o código**: por exemplo `.factory/` na raiz, fora dos pacotes da app, e como sobrevive ao Strip.
- **Interface do adaptador**: quais operações (partindo da tabela de cerca de 20 da pesquisa 14, mais review com comentários inline, resposta em thread, troca de label e fechar PR), em TS, chamadas por uma CLI pequena a partir dos steps. Usar a skill `codebase-design`: módulo profundo, seam na forja.
- **Agendador**: o workflow que re-dispara as Blocked Issues e como ele usa o mesmo adaptador.
- **Observabilidade**: logs do stream do Claude, resumo no job, custo por issue.

## Progresso do grilling (rodada 1)

- **Runner**: `ubuntu-latest` hospedado, `timeout-minutes: 350` no job, teto interno de 5 h 30. Runner próprio só na migração ao Forgejo (com `docker()`).
- **Achado**: com `noSandbox()`, o agente e os steps seguintes dividem VM e usuário (processo em segundo plano, `.git/hooks`, código de `.factory/`), então separar o `FACTORY_TOKEN` por step não isola nada.
- **Três jobs por execução**:
  - `claim` (`GITHUB_TOKEN`, `issues: write`): guard e troca de label.
  - `work` (`contents: read`, `persist-credentials: false`, só a auth do Claude): loop Sandcastle e E2E. Sai como artifact: `git bundle`, `result.json` e prints.
  - `publish` (VM nova, `FACTORY_TOKEN`, harness da `main`): valida o `result.json` com Zod e faz push, PR, review, evidência e `ready`, ou a Escalation. Roda com `if: always()`; se o `work` caiu sem resultado, a Escalation sai com "falha de infraestrutura".
  - A Triage segue o mesmo formato (`work` só leitura → `apply`).
- **YAML fino**: o YAML cuida de gatilhos, `permissions`, concorrência, secrets, artifacts e setup, e cada job termina em `pnpm factory <claim|work|publish|triage|unblock|sweep|pr-feedback>`. A lógica fica em TS, testada contra um adaptador falso.
- **`.factory/`** na raiz, como pacote do workspace pnpm (`cli.ts`, `config.ts`, `prompts/`, `forge/{interface,github,fake}.ts`). Contrato com o produto: `pnpm install`, `pnpm factory:verify` (sobe o próprio Postgres via `docker compose`), diretório fixo de prints dos testes `@evidence` e `AGENTS.md`. O Strip não toca em `.factory/` nem em `.github/workflows/factory-*`.
- **Adaptador `Forge`** semântico, com cerca de 18 operações:
  - issues: `issue`, `blockers` (com `done` normalizado), `blocking`, `labeled`, `swapLabel` (trava), `comment`, `canWrite`, `labelActor`, `dispatch`;
  - PRs: `openPrFor`, `push`, `openDraftPr`, `markReady`, `closePr`, `submitReview`, `threads`, `replyToThread`, `postEvidence`.
  - O GitHub é falado por `fetch` REST + Zod, com `gh` só no `--attach`. O `fake.ts` em memória é o segundo adaptador. Tokens ficam fora da interface.
- **Guard determinístico por cabeçalhos**: `## Acceptance criteria` no corpo; `## Testing Decisions` no pai ou comentário da Triage marcado com `<!-- factory:triage -->` e escrito pelo machine user. Blocked Issue mantém `ready-for-agent` e recebe um único comentário "Waiting on …", só no evento `labeled`.
- **Comentários no PR**: gatilhos `pull_request_review: submitted`, `pull_request_review_comment` e `issue_comment` em PR. Debounce num job com `cancel-in-progress: true` e `sleep 180`; review enviada pula a espera; o trabalho roda com `cancel-in-progress: false`. Filtros: branch `factory/issue-N` (sem slug), autor com `write`+, nunca o próprio machine user.
- **Observabilidade**: `stream-json` de cada sessão como artifact (14 dias); `$GITHUB_STEP_SUMMARY` com uma linha por tentativa e Stage; tokens e custo estimado no rodapé da review e na Escalation. Nada persistente.
- **Sem teto global de execuções simultâneas** na v1.
- **Segurança do CI do PR** (o preview roda o código do agente com secrets de nuvem): vira ticket próprio. O token do machine user fica sem a permissão `workflows`.
- **Agendador**: o usuário prefere tudo por evento, porque uma hora de espera é demais. Em aberto: como cobrir a remoção de dependência, que não gera evento.

## Progresso do grilling (rodada 2)

- **Agendador sem cron**: `factory-unblock.yml` escuta `issues: closed` e varre **todas** as issues com `ready-for-agent` a cada fechamento, o que recupera eventos perdidos no fechamento seguinte. Também tem `workflow_dispatch` para disparar na mão. O comentário "Waiting on …" orienta: "Removed a dependency? Re-add `ready-for-agent` to start now". Sem `schedule` e sem Worker de webhook.
- **Caminhos protegidos**: o prompt proíbe tocar em `.github/workflows/`. Se o diff tocar ali, o `publish` faz a Escalation sem PR, com o patch anexado ao comentário da issue. `.factory/` fica liberado, porque o `publish` sempre roda o harness da `main`.
- **Interrupção humana**: antes de escrever, o `publish` confere de novo o estado (issue aberta, `in-progress`, PR aberto). Se algo mudou, descarta sem push e comenta "Run discarded: …" com o link do run. Tirar `in-progress` é o jeito oficial de cancelar.
- **Segundo e terceiro seams**: o loop recebe `Agent.run(stage, prompt, {timeout})` e `Verify.run()` por injeção, cada um com adaptador real e falso roteirizado. Os testes do harness cobrem todos os caminhos do loop sem Claude e sem Docker.
- **`result.json`** validado com Zod nos dois lados: `outcome`, `reason`, `question`, `attempts[]`, `review`, `threadReplies[]`, `usage`, `evidence[]`. O `publish` filtra comentários inline fora do diff e respostas para threads inexistentes.
- Em aberto: concorrência entre o fluxo da issue e o de comentários (o usuário pediu explicação), conflito com a `main` (o usuário pediu o fluxo do Matt), e execução local com um adaptador do tracker em Markdown local.
- Fato (`7a4e7f7`): o `agent-update-branch.yml` do Matt é disparado só pela label `agent:update-branch`, posta por um humano no PR (`pull_request_target`, porque `pull_request` não roda quando o GitHub não consegue gerar o merge commit). O script tenta `git merge origin/main`. Se o merge é limpo, não chama o agente. Com conflito, chama o agente com a política "preserve both intents, do not invent new behaviour". Recusa sair sem commits ou com conflitos pendentes. Faz push com `--force-with-lease` contra o SHA lido no início. Não roda Review nem E2E depois: o CI do PR é a verificação.

## Progresso do grilling (rodada 3)

- **Seams `Tracker` × `CodeHost`**: o `Forge` foi dividido em dois. O `Tracker` cuida de issues, labels, bloqueios e comentários. O `CodeHost` cuida de push, PR, review, threads, evidência e `dispatch`. A configuração escolhe cada um de forma independente.
- Regra para a Q15b e a Q16b, pedida pelo usuário: usar só o que também funciona no Forgejo; o que não funcionar lá deve ser adaptado.
- Fatos do Forgejo (pesquisa 14):
  - `concurrency.group` existe, com fila "best-effort" e sem `queue: max`;
  - suporta o evento `push`;
  - o `dispatch` com o token automático funciona pelo código, sem documentação; o agendador já depende disso;
  - o `--force-with-lease` é do git e funciona em qualquer forja.
- Em aberto: para que serve o modo local. O usuário não tem posição formada; a pergunta original da Q19 era do agente.

## Progresso do grilling (rodada 4)

- **Q15b, duas camadas**: grupo `factory-N` com `cancel-in-progress: false` nos dois fluxos, mais push com `--force-with-lease` contra o SHA de partida. Se o branch andou, descarta e comenta "Run discarded: branch moved". Como o Forgejo tem fila "best-effort" e não tem `queue: max`, vale uma regra: **cada execução lê o estado atual da forja, nunca o conteúdo do evento**. O fluxo da issue age se ela tem `ready-for-agent`; o de comentários trata todas as threads sem resposta da Factory. Assim, uma execução pendente que for cancelada não perde trabalho. O `queue: max` entra só no GitHub, como ajuste da migração.
- **Q16b, (c)**: `factory-update-branches.yml` escuta `push` na `main` (existe no Forgejo) e testa cada PR da Factory com `git merge-tree --write-tree`. Só despacha `update-branch` para os que entraram em conflito. O `update-branch` faz como o Matt: merge limpo sem agente; com conflito, o agente resolve com a política dele. Depois roda o `Verify` e, se falhar, o loop normal com limite de 5. O ciclo de comentários também começa com merge da `main`.
- **Q19a**: o `Forge` vira dois seams, `Tracker` e `CodeHost`.
- **Q19b**: o usuário quer rodar algo localmente antes de testar no GitHub. Em aberto: como fazer isso sem `noSandbox()` no notebook.

## Progresso do grilling (rodada 5)

- **Q19b**: execução local em container descartável. O repo entra por `git clone`, nunca por bind-mount (bug #854 do Sandcastle). Só a auth do Claude entra no container. O Postgres roda num container irmão numa rede privada, e o container do agente nunca recebe o socket do Docker. O `publish` roda no host com os adaptadores locais.
- **Q20**: o `factory:verify` usa o `DATABASE_URL` se ele estiver definido; se não, sobe o `docker compose`.
- **Q21**: o modo local cobre só o fluxo da issue e a Triage, com `factory local NN`. O `--all` fica para depois.
- **Q22**: a linha `Status:` usa as strings das labels e mais `done`, que o humano põe à mão depois do merge.

## Answer

Princípio: **o YAML é fino e a lógica fica em TS**, num pacote `.factory/` testado contra adaptadores falsos. O agente nunca divide VM com o token que escreve na forja.

**Isolamento do token: três jobs por execução** (achado: com `noSandbox()`, steps do mesmo job dividem VM e usuário, então separar por step não isola o `FACTORY_TOKEN`)
- `claim` (`GITHUB_TOKEN`, `issues: write`): guard e troca `ready-for-agent` → `in-progress`.
- `work` (`contents: read`, `persist-credentials: false`, só a auth do Claude): loop Sandcastle e `Verify`. Sai como artifact: `git bundle`, `result.json`, prints e o `stream-json` de cada sessão.
- `publish` (VM nova, `FACTORY_TOKEN`, sempre o harness da `main`): valida o `result.json` com Zod, filtra a saída do agente (comentário inline fora do diff, resposta a thread inexistente) e faz push, PR, review `COMMENT`, evidência e `ready`, ou a Escalation. Roda com `if: always()`; sem resultado, a Escalation sai com o motivo "infra".
- A Triage segue o mesmo formato: `work` só leitura → `apply`.
- Runner `ubuntu-latest` hospedado, `timeout-minutes: 350`, teto interno de 5 h 30.

**Código**
- `.factory/` na raiz, como pacote do workspace pnpm (`@factory/harness`): `cli.ts`, `config.ts` (modelos, timeouts, 5 tentativas, labels; sobrescrevível por variável do repo), `prompts/`, adaptadores. Cada job termina em `pnpm factory <claim|work|publish|triage|unblock|update-branch|pr-feedback|local>`.
- Contrato com o produto: `pnpm install`; `pnpm factory:verify` (usa o `DATABASE_URL` se existir, senão sobe o Postgres via `docker compose`); diretório fixo de prints dos testes `@evidence`; `AGENTS.md`. O Strip não toca em `.factory/` nem em `.github/workflows/factory-*`.

**Quatro seams, cada um com adaptador real e falso**
- `Tracker`: `issue` (com pai e filhos), `blockers` (`done` normalizado: GitHub `closed`+`completed`, Forgejo `closed`), `blocking`, `labeled`, `swapLabel` (falso se a label sumiu: é a trava), `comment`, `canWrite`, `labelActor`. Adaptadores: GitHub, Markdown local (`.scratch/<feature>/issues/NN-*.md`: label = `Status:`, bloqueio = `Blocked by:`, comentário = `## Comments`) e falso.
- `CodeHost`: `push` (`--force-with-lease` contra o SHA de partida), `openPrFor`, `openDraftPr` (GitHub `draft: true`, Forgejo `WIP:`), `markReady`, `closePr`, `submitReview`, `threads`, `replyToThread`, `postEvidence` (cria ou edita o comentário único), `dispatch`. Adaptadores: GitHub (REST via `fetch` + Zod; `gh` só no `--attach`), local (branch local, review e Escalation no `## Comments`, prints em `.scratch/<feature>/evidence/NN/`) e falso. Tokens ficam fora da interface.
- `Agent.run(stage, prompt, {timeout}) → {commits, output, usage}`: Sandcastle e falso roteirizado.
- `Verify.run() → {ok, failedCommand, output}`: `factory:verify` e falso.
- Os testes do harness cobrem o loop inteiro (5 falhas, timeout, `needs-human`, gate de commits, Review incremental) sem Claude, sem Docker e sem forja, no CI normal.

**`result.json`** (Zod nos dois lados): `outcome: ready | escalated`, `reason: e2e-failures | time | needs-human | infra`, `question`, `attempts[]` (Stage, duração, saída, comando que falhou, saída cortada), `review {summary, inline[]}`, `threadReplies[]`, `usage` por Stage, `evidence[]`.

**Workflows** (todos por evento, sem cron)
- `factory-issue.yml`: `issues: labeled` (`ready-for-agent`) + `workflow_dispatch(issue)`.
- `factory-triage.yml`: `issues: labeled` (`agent:explore`), em lote, concorrência global.
- `factory-pr-feedback.yml`: `pull_request_review: submitted`, `pull_request_review_comment` e `issue_comment` em PR. Debounce num job com `cancel-in-progress: true` e `sleep 180` (review enviada pula a espera); trabalho com `cancel-in-progress: false`. Filtros: branch `factory/issue-N` (sem slug), autor com `write`+, nunca o próprio machine user. Começa com merge da `main`.
- `factory-unblock.yml`: `issues: closed` + `workflow_dispatch`; varre **todas** as issues com `ready-for-agent` a cada fechamento, o que recupera eventos perdidos. Remover uma dependência não gera evento: o comentário "Waiting on …" diz "Removed a dependency? Re-add `ready-for-agent` to start now".
- `factory-update-branches.yml`: `push` na `main`; testa cada PR da Factory com `git merge-tree --write-tree` e despacha `update-branch` só para os que entraram em conflito. O `update-branch` segue o Matt (merge limpo sem agente; conflito resolvido pelo agente com "preserve both intents, do not invent new behaviour"), depois roda o `Verify` e, se falhar, o loop normal com limite de 5.

**Guard e estado**
- Determinístico por cabeçalhos: `## Acceptance criteria` no corpo; `## Testing Decisions` no pai ou comentário da Triage com `<!-- factory:triage -->` escrito pelo machine user.
- Blocked Issue mantém `ready-for-agent` e recebe um único comentário "Waiting on #A, #B", só no evento `labeled`.
- **Cada execução lê o estado atual da forja, nunca o conteúdo do evento**, então uma execução pendente cancelada não perde trabalho (o Forgejo tem fila "best-effort" e não tem `queue: max`).
- Os fluxos da issue, de comentários e de update-branch dividem o grupo `factory-N` (`cancel-in-progress: false`; `queue: max` só no GitHub). A garantia de verdade é o `--force-with-lease`: se o branch andou, "Run discarded: branch moved".
- Antes de escrever, o `publish` confere de novo o estado (issue aberta, `in-progress`, PR aberto). Se mudou, descarta sem push e comenta "Run discarded: …". Tirar `in-progress` é o jeito oficial de cancelar.
- Diff que toca `.github/workflows/` → Escalation sem PR, com o patch no comentário (o `FACTORY_TOKEN` não tem a permissão `workflows`). `.factory/` fica liberado: só roda depois do Merge Gate.
- Sem teto global de execuções simultâneas na v1.

**Observabilidade**: `stream-json` de cada sessão como artifact (14 dias); `$GITHUB_STEP_SUMMARY` com uma linha por tentativa e Stage (duração, resultado, tokens); tokens e custo estimado no rodapé da review e na Escalation. Nada persistente.

**Execução local** (`pnpm factory local NN`, para testar antes do GitHub)
- Um container descartável faz o papel da VM do runner: imagem parecida com a do runner, repo por `git clone` (nunca bind-mount, por causa do bug #854 do Sandcastle), só a auth do Claude dentro. Roda o mesmo `factory work` com `noSandbox()`.
- O Postgres do E2E roda num container irmão numa rede Docker privada; o container do agente nunca recebe o socket do Docker.
- O `publish` roda no host com `Tracker` e `CodeHost` locais. A linha `Status:` usa as strings das labels mais `done`, que o humano põe depois do merge; desbloqueada = todas as de `Blocked by:` em `done`.
- Cobre o fluxo da issue e a Triage, uma issue por vez. Requisito: Docker (Docker Desktop ou OrbStack).

**Fora deste ticket**: o CI de preview roda o código do agente com os secrets de nuvem. Vira [Segurança do CI do PR com código da Factory](19-pr-ci-security.md).
