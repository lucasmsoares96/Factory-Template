# 05: Pull Request Stage no run da issue e no run local

Spec: [../spec.md](../spec.md)

**What to build:** todo run da Factory que deixa commits termina com o Pull Request Stage: uma sessão nova, depois do E2E, que escreve o corpo do PR com a skill `pr` (Summary, Evidence, Merge Danger). O humano no Merge Gate abre o PR e lê o que ele muda, a prova de que funciona e a door e o blast radius. O draft de uma Escalation com commits também recebe o corpo, com a saída do último E2E que falhou na Evidence. Se o Stage falhar, o PR sai com o corpo mínimo de hoje e o rodapé diz por quê. Os prints continuam no comentário de evidência separado até o ticket 06.

**Blocked by:** 01. Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** ready-for-agent

- [x] Stage `pull-request` depois do loop Development → Review → E2E, uma vez, quando houver commits; também na Escalation (`e2e-failures`, `needs-human`, `time` se sobrar tempo). Não roda sem commits, em `infra` nem com o limite global esgotado.
- [x] Não conta para o limite de tentativas; aparece numa linha própria no histórico do run e no resumo do job.
- [x] Timeout e modelo próprios na config e nas variáveis, com o timeout cortado ao que sobra do limite global.
- [x] Prompt: usar a skill `pr`; traz a issue, o log de commits, o resultado do run (E2E verde e tentativa, ou motivo da Escalation e saída do último E2E) e os prints por Product com os caminhos locais; proíbe `Closes`, avisos de Escalation e de `harness-change`. A sessão termina com o corpo num bloco marcado, extraído com a retomada do ticket 01.
- [x] Um commit da sessão é descartado: o branch publicado é o que o E2E validou.
- [x] `result.json` com o corpo (nulo quando não houver), o registro do Stage e os tokens dele; a linha de custo soma todos os Stages.
- [x] O `publish` monta o corpo: avisos `[!WARNING]`/`[!CAUTION]` no topo, texto do Stage no meio, `Closes #N` no fim. Sem texto, o meio é "Implemented by the Factory." e o rodapé registra a falha do Pull Request Stage e o motivo.
- [x] Os tickets de acompanhamento abertos pela regra do Skeleton (`followUps` do `result.json`, ticket 09 da base) são parte determinística do corpo, montados pelo `publish` junto dos avisos; o prompt proíbe o agente de escrevê-los, e o texto do Stage não os apaga nem os duplica.
- [x] Num run que continua um PR aberto, o corpo é reescrito. Num run sem PR (caminho protegido, sem commits), o texto é descartado.
- [x] `pnpm factory local` roda o Stage e escreve o corpo no PR local.
- [x] Testes pela CLI contra os falsos: Stage depois do E2E verde; na Escalation com commits; ausente sem commits, em `infra`, com o tempo esgotado e por caminho protegido; ordem do corpo; corpo mínimo e motivo quando o Stage falha ou estoura o timeout; commit descartado; fora das tentativas; tokens no rodapé e no resumo; corpo reescrito ao continuar um PR (seam 1).
- [x] Teste de configuração: timeout e modelo do Stage na config e nas variáveis (seam 2).
- [x] Critério medido e registrado aqui: run local com o Claude real em que o Pull Request Stage escreve o corpo com a skill `pr` e uma retomada de extração funciona no adaptador do Sandcastle.
- [x] `pnpm factory:verify` verde.

## Comments

- Implementado por testes pela CLI contra os falsos (`pull-request-stage.test.ts`, `pull-request-body.test.ts`) mais ajustes em `prompts`, `local`, `local-code-host` e `work`. Rodei só os arquivos tocados e os afetados com vitest e o `typecheck`; o `pnpm factory:verify` completo fica para o orquestrador no merge.
- Decisões: `result.json` ganha `pullRequestBody`, `pullRequestStage` (`ok|failed|timeout|skipped`, com `reason`) e `usage.pullRequest` (todos com default, então resultados antigos continuam válidos). `skipped` registra o run com commits e sem tempo global. Uma exceção da sessão também vira Stage `failed`, nunca derruba o run. O `CodeHost` ganha `updatePrBody` (fake e local) para reescrever o corpo ao continuar um PR; se o Stage falhar nesse caso o corpo antigo fica. O `publish` descarta do texto do agente qualquer `Closes/Fixes/Resolves #N`.
- Config nova: `models.pullRequest` (`FACTORY_MODELS_PULL_REQUEST`) e `timeouts.pullRequest` = 15 min (`FACTORY_TIMEOUTS_PULL_REQUEST`).
- Pending (human/orquestrador): critério medido (run local com o Claude real em que o Pull Request Stage escreve o corpo com a skill `pr` e uma retomada de extração funciona no adaptador do Sandcastle) e `pnpm factory:verify` verde. Por isso o Status segue `ready-for-agent`.


Medido com Claude real (2026-10-20, `pnpm factory local`, Opus 5.5):
- Issue de Product (frase na tela de login do `example`): Escalation `needs-human` sem commits, US$ 2,36. O Development viu que o `example` estava travado ao molde e que um Product não tinha specs E2E próprios, não mexeu no Skeleton e abriu sozinho o ticket de acompanhamento "The Skeleton must grow" (regra do ticket 09 da base). Virou o ticket 24 da base. Sem commits, o Pull Request Stage não rodou, como esperado.
- Issue do Skeleton (frase de boas-vindas na tela de login): `ready` na 1ª tentativa, 2 commits, US$ 4,66. O Pull Request Stage escreveu o corpo com a skill `pr`: Summary com diffs de árvore de componentes e de chaves do i18n, Evidence com o teste antes/depois e o print, Merge Danger (two-way, blast radius pequeno). O `publish` pôs o `Closes #1` no fim.
- Defeito achado e corrigido: o corpo trazia a linha "🤖 Generated with Claude Code", que o modelo da skill `pr` manda acrescentar. O prompt agora a proíbe e o `publish` a remove (com `Co-Authored-By`), com teste.
- Retomada de extração: não exercitada com Claude real. A Review e o Pull Request Stage entregaram o bloco na primeira resposta (nenhuma sessão `-resume`). Não dá para forçar o modelo a esquecer o bloco; a retomada segue coberta pelo teste do adaptador do Sandcastle com um `claude` falso.


Merge (2026-10-20): mesmo caso do ticket 24 da base: o `verify` completo fica com o CI do PR.


Verify (2026-10-21): verde no CI do PR #4 e nos `verify` completos locais desde então.
