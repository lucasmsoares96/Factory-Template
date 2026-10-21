# 16: Factory no Actions

Spec: [../spec.md](../spec.md)

**What to build:** com o módulo Factory configurado, uma issue do GitHub marcada `ready-for-agent` por quem tem `write`+ vira um PR do machine user, com review, evidência dos Products afetados e preview, sem o `FACTORY_TOKEN` jamais dividir a máquina com o agente.

**Blocked by:** 09, 10, 15

**Status:** ready-for-agent

- [x] *(Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)* Módulo Factory: machine user com PAT clássico `repo` sem `workflow`, convite `write` aceito pelo wizard, conferência por `X-OAuth-Scopes` e recusa do mesmo login do dono; auth do Claude (`CLAUDE_CODE_OAUTH_TOKEN` recomendado ou `ANTHROPIC_API_KEY`, aviso se houver os dois); `FACTORY_ENABLED` ligado depois do `doctor`.
- [x] Adaptadores GitHub de `Tracker` e `CodeHost` (REST por `fetch` + Zod; `gh` só no `--attach`; `done` = `closed`+`completed`).
- [ ] `factory-issue.yml` (`issues: labeled` + `workflow_dispatch`): `claim` (`GITHUB_TOKEN`) → `work` (imagem, `contents: read`, só a auth do Claude, `runs-on` aceita `vars.FACTORY_RUNNER`) → `publish` (VM nova, `FACTORY_TOKEN`, harness da `main`, `if: always()`), ligados por `git bundle` + `result.json` + prints; grupo `factory-N` com `cancel-in-progress: false`; `timeout-minutes: 350`.
- [ ] Evidência agrupada por Product no comentário único; `stream-json` como artifact por 14 dias; resumo no `$GITHUB_STEP_SUMMARY`.
- [x] Testes estáticos do YAML: `work` sem `FACTORY_TOKEN` e só em `container:`; `claim` e `publish` não aceitam `vars.FACTORY_RUNNER` (seam 2).
- [x] Testes do módulo contra os falsos: PAT do mesmo login recusado, aviso de duas auths (seam 8).
- [ ] Issue de exemplo opcional (padrão "não"); quando usada, ela, o PR, o branch e o preview são apagados no fim.

## Comments

Código implementado em 2026-10-20 (branch `ticket-16`). Marcados: o módulo (contra os falsos, com os adaptadores reais testados com `fetch`/`gh` falsos), os adaptadores GitHub, os testes estáticos do YAML e os testes do módulo. Desmarcados porque só a conta real e o Actions os provam: o workflow `factory-issue.yml` rodando de verdade, a evidência no comentário único e a issue de exemplo. Status continua `ready-for-agent`.

**Módulo** = comando próprio `pnpm bootstrap factory` (`.factory/src/bootstrap/factory.ts`), depois da parte comum (como o `previews`; a parte comum não ganha prompt). Passos `labels`, `machine-user`, `machine-collaborator`, `claude-auth`; depois o doctor (seção "Factory", sem as checagens da Cloudflare) e, só se passar, `FACTORY_ENABLED=true`.
- *(Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)* Único prompt: o PAT clássico (`factory-pat`, oculto), uma vez; vai direto ao secret `FACTORY_TOKEN` e o login à variável `FACTORY_MACHINE_USER`. Conferido por `GET /user` (`X-OAuth-Scopes`): exige `repo`, recusa `workflow`, recusa token sem o cabeçalho (fine-grained), recusa o login do dono do repo e o login da sessão `gh`; três tentativas, nada gravado de um PAT recusado. `FACTORY_TOKEN` no ambiente evita o prompt.
- *(Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)* Convite `write` por `gh api PUT collaborators/<login> permission=push`, aceito com o PAT (`GET/PATCH /user/repository_invitations`, `machine.ts`). Se o aceite falhar, o PAT já está guardado; a nova execução não pergunta de novo e diz onde aceitar (`https://github.com/<repo>/invitations`).
- Auth do Claude nunca é perguntada (seria um segundo prompt): vem de `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` no ambiente ou de um secret existente (o `CLAUDE_CODE_OAUTH_TOKEN` já existente conta). Os dois no ambiente: grava só o OAuth e avisa; os dois como secrets: aviso (`ANTHROPIC_API_KEY` ganha). Sem nenhum: imprime `claude setup-token`, o doctor fica vermelho e `FACTORY_ENABLED` não liga.
- Execução repetida com os secrets no lugar não pergunta nem grava nada (teste com contador de prompts).

**Adaptadores** (`.factory/src/adapters/github/`): `api.ts` (`fetch` + Zod, token só aqui), `github-tracker.ts`, `github-code-host.ts`, e o `create-issue.ts` que já existia. `FACTORY_ADAPTERS=github` (`GITHUB_REPOSITORY`; token `FACTORY_TOKEN`, senão `GITHUB_TOKEN`).
- Tracker: pai por `/issues/N/parent`, filhos por `/sub_issues`, bloqueadores por `/dependencies/blocked_by` (`done` = `closed` + `state_reason: completed`), `swapLabel` é o `DELETE /labels/<from>` (404 = a trava), `canWrite` por `role_name` (`maintain` conta, `triage` não), `labelActor` pelos eventos `labeled`/`unlabeled`.
- CodeHost: `push` com `git push --force-with-lease=refs/heads/<b>:<sha>` (vazio = o branch não pode existir; testado com git de verdade contra um repo bare); o token vai por `GIT_CONFIG_*` no ambiente (`http.extraheader`), nunca no argv. `markReady` é a única chamada GraphQL (a REST não tem endpoint). Threads = comentários de review agrupados pela raiz (REST). `postEvidence`: apaga o comentário de evidência anterior e cria um novo com `gh pr comment --attach` (token em `GH_TOKEN`); se o `gh` não anexar, posta um comentário de texto com os nomes e o motivo. `dispatch("issue")` → `factory-issue.yml` na branch base.
- Testes: `test/github/{tracker,code-host,issue-flow}.test.ts`; o `issue-flow` roda `claim` e `publish` pela CLI sobre os adaptadores GitHub reais e uma API REST falsa com estado (trava por 404, bloqueador `not_planned`, label posta por quem não tem write, Escalation `infra` sem resultado, "Run discarded").

**Workflow** `.github/workflows/factory-issue.yml` ("Factory issue"): jobs `claim` → `image` (o job reaproveitável) → `work` → `publish`. `claim` (`contents: read`, `issues: write`, `pull-requests: read`, sem secrets) só roda com `vars.FACTORY_ENABLED == 'true'` e, no evento `labeled`, para a label `ready-for-agent` (ou `FACTORY_LABELS_READY_FOR_AGENT`); `work` (imagem, Postgres por `services:`, `persist-credentials: false`, checkout completo sem filtro, só `secrets.CLAUDE_CODE_OAUTH_TOKEN` e `secrets.ANTHROPIC_API_KEY`, vazios são removidos do ambiente, `runs-on: vars.FACTORY_RUNNER || 'ubuntu-latest'`, 350 min); `publish` (VM nova, `secrets.FACTORY_TOKEN`, harness da branch padrão, `if: always() && claimed`, `download-artifact` com `continue-on-error`). Artifact `work-out` por 14 dias (bundle, `result.json`, prints, `stream-json` em `sessions/`). Grupo `factory-<N>`, `cancel-in-progress: false`. As variáveis `FACTORY_*` do repo passam por `src/ci/vars.ts` (só nomes do `config.ts`) para o `$GITHUB_ENV`. `claim` escreve `claimed`, `start_sha` e `branch` em `$GITHUB_OUTPUT`.

**Desvios:**
- `work` ganhou `issues: read` além de `contents: read`: é como ele lê a issue (o token do job só lê; a allowlist do Agent nunca o repassa). O spec dizia só `contents: read`.
- O módulo é um comando separado (`pnpm bootstrap factory`), não uma seção da parte comum.
- Na VM do `publish` o checkout é completo e sem `filter: blob:none` (sem credencial guardada, um objeto faltando não poderia ser buscado).
- No `work`, o `HOME` do container é o do runner: o workflow recria os links `~/.cache/node/corepack` e `~/.cache/ms-playwright` (a pendência do ticket 10).
- O endpoint `user-attachments` do `--attach` não é REST documentado e o `gh` do `ubuntu-latest` precisa ser >= 2.99.0; o `publish` imprime a versão.

Versões e docs (2026-10-20): nenhuma biblioteca nova; ações nos mesmos pins do ticket 12. Docs lidas: REST sub-issues (`/parent`, `/sub_issues`, páginas de 100) e a página de PATs. A URL pré-preenchida de PAT **clássico** (`settings/tokens/new?scopes=repo&description=`) não está nessa página (só a de fine-grained); o wizard a imprime e diz para marcar `repo` à mão se o formulário abrir vazio.

Pending (human): *(Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)* Criar a conta do machine user (conta GitHub separada, com e-mail próprio), logar nela, criar o PAT clássico só com `repo` (sem `workflow`) e rodar `export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token) && pnpm bootstrap factory` na conta real (cola o PAT uma vez; se o aceite do convite falhar, aceitar em `https://github.com/<owner>/<repo>/invitations` logado como o machine user e rodar de novo); conferir no `doctor` a seção Factory e `FACTORY_ENABLED=true`.
Pending (human): depois de mergear na `main`, criar uma issue pequena com `## Acceptance criteria` (e seams no pai), marcar `ready-for-agent` com a conta com `write` e conferir: `claim` → `work` (artifact `work-out`, resumo do job) → `publish` abre o PR do machine user, com review, comentário de evidência agrupado por Product e preview; conferir que `FACTORY_TOKEN` não aparece no log do `work`, que o `gh` do runner aceita `--attach` (senão o comentário de texto avisa) e que `HOME=/github/home` no container deixa `pnpm` e o Playwright funcionarem. Depois apagar a issue, o PR, o branch `factory/issue-N` e o preview (a issue de exemplo opcional, padrão "não").


Merge (2026-10-21): na `factory-base`; `verify` completo verde duas vezes (703 testes do harness). Falta a parte com conta real (Pending (human) acima).

- Review fixes 2 (2026-10-21): `concurrency.queue: max` adicionado a todo grupo `factory-<N>` (factory-issue, factory-pr-feedback e factory-update-branches, jobs `work`); a chave existe na doc atual do GitHub Actions (workflow-syntax, consultada em 2026-10-21; `max` = até 100 pendentes em FIFO, não combina com `cancel-in-progress: true`). Testes YAML estendidos. `runGit`/`runGh` agora usam env em allowlist (`childEnv`: `BASE_ENV` + o token que o gh/git lê), sem herdar `FACTORY_TOKEN`; `branchHead` codifica cada segmento do branch na URL; `anything` (api.ts) removido.
- Nota: o pr-bottleneck 06 trocou `postEvidence` por imagens no corpo do PR (`EvidenceImage`/`--attach`); referências a `postEvidence` neste ticket estão obsoletas.
