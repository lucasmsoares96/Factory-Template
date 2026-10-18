# Contrato de cada Stage e do loop

Type: grilling
Status: resolved

## Question

Com o Sandcastle como motor, o que exatamente cada Stage recebe, faz e devolve? Pontos a fechar:
- **Exploration**: lê a issue e o código e produz o quê (um plano? critérios de aceitação → testes `@evidence`?).
- **Development**: TDD obrigatório? Commits por volta?
- **E2E**: quais comandos e o que conta como "passou".
- **Review**: quais critérios (skill `code-review`: Standards + Spec?) e veredito tipado `{passed, feedback}`.
- **Estado entre voltas**: o que passa de uma volta para a outra (feedback, sessão do Claude retomada ou nova, mesmo sandbox).
- **Modelo e esforço por Stage.**
- **Escalation**: o formato do PR em draft e do comentário na issue após a 5ª falha.
- **Re-execução**: o que acontece quando a issue é re-rotulada depois de uma Escalation.

## Progresso do grilling (rodada 1)

Pesquisas: [loop do Sandcastle](../research/15-sandcastle-loop-pattern.md), [skills do Matt](../research/15-pocock-skills-workflow.md). O usuário pediu para seguir o padrão do Matt Pocock.

- Adotado do padrão: o agente só mexe em código (o harness faz push, PR, labels e comentários); sessão nova por Stage e por volta, sem `resume()`; Development segue o processo do `implement` no prompt + skill `tdd`; o E2E é determinístico; o conteúdo da issue entra como "untrusted"; o guard recusa a spec pai e issue com PR aberto; Opus em todos os Stages, sem esforço por papel.
- **Review corrige e nunca reprova** (padrão Matt). Só o E2E manda de volta ao Development; as 5 falhas contam só o E2E. Achados restantes vão para o corpo do PR. Glossário atualizado.
- **Comentários no PR entram no escopo**: pergunta → resposta; pedido de correção → correção. Vira ticket próprio.
- **Runner self-hosted**, sem limite de tempo. Reabre parte de [Escolha do motor da Factory](12-factory-engine-choice.md) (`noSandbox()` foi justificado pela VM efêmera do runner hospedado).

## Progresso do grilling (rodada 1)

Base: o padrão do Matt Pocock, levantado em [loop do Sandcastle](../research/15-sandcastle-loop-pattern.md) e [skills e fluxo](../research/15-pocock-skills-workflow.md).

- Adotado do padrão (sem objeção): o agente só mexe em código e o harness faz todos os efeitos na forja. Sessão nova a cada Stage e a cada volta, sem `resume()`; passam adiante a issue com os comentários, o `git log main..HEAD` e o feedback da última volta. Development segue o processo do `implement` escrito no prompt, com `tdd` red-green em fatias verticais. Conventional Commits com `#N`, hooks de pre-commit, gate "a volta gerou commits?". Conteúdo da issue entra como untrusted. O guard recusa a spec pai e issue com PR aberto. Opus em todos os Stages, sem esforço por Stage, valores num arquivo de configuração.
- **Review corrige, não reprova** (padrão Matt). O revisor, em sessão nova, usa `code-review`, conserta o que achar e commita; depois o E2E roda de novo. Só o E2E faz o loop para o Development. Achados restantes vão para o corpo do PR.
- **Orçamento de tempo**: timeouts configuráveis por Stage (Exploration 20 min, Development 60 min, E2E 20 min, Review 30 min); timeout de Stage conta como falha; teto global de 5 h 30 leva a Escalation com motivo "tempo".
- **Comentários no PR entram no escopo**: comentário no PR é avaliado; pergunta é respondida, pedido de correção é corrigido (padrão `implement-pr` do Matt). Detalhes em aberto.
- Em aberto: Exploration, re-execução e trava, conteúdo do E2E Stage.

## Progresso do grilling (rodada 2)

- **Re-execução após Escalation** (padrão Matt): a trava passa a ser a label. Ao começar, a Factory troca `ready-for-agent` por `in-progress`; a concorrência por issue serializa, e uma segunda execução sai por não achar a label. No retry, fecha o PR draft antigo (link no comentário) e recria o branch a partir da `main`. **Revisa** o lock por ref de [Gatilho por label e agendador de Blocked Issues](03-trigger-and-scheduler.md).
- **E2E Stage mantido**: o harness roda `pnpm factory:verify` (typecheck → lint → integração → front → Playwright na stack local), o mesmo script do CI do PR; código de saída decide; feedback = comando que falhou + saída cortada + relatório do Playwright; prints saem dessa execução.
- **Comentários no PR**: só de quem tem `write`+; disparo ao enviar uma review do GitHub, e comentários avulsos agrupados por alguns minutos; concorrência por PR. Cada thread recebe Address (commit linkado), Decline (com motivo) ou Defer (sugere issue nova); perguntas respondidas na thread; a Factory nunca resolve threads. Depois da correção: Development → E2E → Review → atualização dos prints, limite de 5 falhas; ao estourar, responde no PR e põe `ready-for-human`, sem virar draft.
- Usuário quer seams e critérios 100% definidos antes (no `to-spec`/`to-tickets`), para o agente só executar. Fato: o `to-spec` já combina os seams com o humano (passo 2) e os grava em "Testing Decisions"; o `to-tickets` cria sub-issues da spec com critérios de aceite. Agent Briefs do `triage` têm critérios, mas não seams.
- Usuário pergunta se `tdd` e `implement` viram etapas separadas no Sandcastle.

## Progresso do grilling (rodada 3)

- **Issue sem seams** (bug da `triage`, issue à mão): aceita; o agente escolhe o seam existente mais alto (regra da `to-spec`); para bug, o teste que reproduz (`diagnosing-bugs`); o seam escolhido aparece no PR. Issue sem critérios de aceite é recusada pelo guard (`needs-info`).
- **Ordem dentro de cada tentativa**: Development → Review → E2E (um único E2E, depois da Review). Falha no E2E volta ao Development; limite de 5.
- **PR igual ao Matt** (`agent-implement.yml` em `7a4e7f7`): PR aberto em draft com corpo mínimo (`Closes #N` + "Implemented by the Factory"), título `Fix #N: <título>`; a Review vira uma review do GitHub com `event: COMMENT` (resumo + comentários inline, nunca `REQUEST_CHANGES`); o comentário de evidência é separado; `gh pr ready` no fim. Como push e PR rodam depois do Sandcastle, tudo acontece no step final do job.
- **Escalation**: o PR fica em draft (não roda `gh pr ready`), com o aviso "Escalated after 5 failed attempts"; comentário na issue com o motivo (5 falhas no E2E, tempo, ou `needs-human` com a pergunta), uma linha por tentativa com o comando que falhou, a saída cortada da última falha, o link do run e "re-add `ready-for-agent` to retry (starts over from `main`)"; tira `in-progress` e põe `ready-for-human`. `needs-human` sem commits não abre PR.
- Em aberto: remover a Exploration (usuário pediu explicação) e o sinal `needs-human` no Development; escopo da Review nas tentativas seguintes.

## Progresso do grilling (rodada 4)

- **Review nas tentativas seguintes**: só o que mudou desde a última Review (ponto fixo = último commit revisado) + checagem focada dos achados anteriores; o PR traz um resumo único de todas as tentativas.
- Usuário propõe manter um explore (triagem) para issues sem seams, como o `agent:explore` do Matt. Fato (`7a4e7f7`): `agent-explore.yml` é um workflow separado, disparado pela label `agent:explore`, que tria em lote todas as issues com a label (agrupa duplicatas), só leitura, veredito `easy-call | needs-a-human | blocked` + comentário (dificuldade, arquivos, claims verificados, perguntas abertas, abordagem, one-way/two-way door); `apply.ts` aplica; `easy-call` vira `agent:implement` automaticamente via `AGENT_PAT` (label posta com `GITHUB_TOKEN` não dispara workflows).

## Progresso do grilling (rodada 5)

- **Triagem automática** (padrão `agent:explore` do Matt): workflow `factory-explore`, disparado pela label `agent:explore` aplicada por quem tem `write`+; só leitura, em lote, agrupa duplicadas; veredito `easy-call | needs-a-human | blocked` + comentário (dificuldade, arquivos, claims verificados, perguntas abertas, abordagem, one-way/two-way door) **e os seams sob teste**, cada um com o que pega e o que deixa passar.
- `easy-call` → a Factory troca para `ready-for-agent` com o `FACTORY_TOKEN` (dispara o workflow); `needs-a-human` → `ready-for-human`; `blocked` → `needs-info`.
- **Guard exige seams**: "Testing Decisions" na spec pai ou comentário da triagem na issue; sem eles, troca `ready-for-agent` por `agent:explore` e sai. Substitui a decisão da rodada 3 de o agente escolher o seam; o prompt do Development diz "Do not improvise new test seams".

## Answer

Segue o padrão do Matt Pocock levantado em [loop do Sandcastle](../research/15-sandcastle-loop-pattern.md) e [skills e fluxo](../research/15-pocock-skills-workflow.md): loop determinístico em TS, sessão nova por papel, o agente só mexe em código e o harness faz todos os efeitos na forja.

**Antes da Factory**
- **Seams vêm prontos**: da seção "Testing Decisions" da spec pai (`to-spec`/`to-tickets`) ou do comentário da **Triage** (`factory-explore`, label `agent:explore` aplicada por quem tem `write`+). A Triage é só leitura, em lote, agrupa duplicadas e dá o veredito `easy-call | needs-a-human | blocked` com comentário (dificuldade, arquivos, claims verificados, perguntas abertas, abordagem, one-way/two-way door, seams com o que pegam e o que deixam passar). `easy-call` → `ready-for-agent` com o `FACTORY_TOKEN`; `needs-a-human` → `ready-for-human`; `blocked` → `needs-info`.
- **Guard recusa**: spec pai (issue com sub-issues), issue com PR aberto, issue sem critérios de aceite (`needs-info`), issue sem seams (volta para `agent:explore`).
- **Trava = label**: ao começar, `ready-for-agent` → `in-progress`; a concorrência por issue serializa. Substitui a trava por ref.

**Cada tentativa: Development → Review → E2E** (a Exploration deixou de ser Stage)
- **Development**: sessão nova; começa explorando o repo (ticket, spec pai, `GLOSSARY.md`, ADRs); segue o processo do `implement` escrito no prompt, com a skill `tdd` red-green em fatias verticais só nos seams combinados ("Do not improvise new test seams"); typecheck frequente; Conventional Commits com `#N`; hooks de pre-commit. Gate do harness: a volta gerou commits. Pode encerrar com `needs-human` + pergunta → Escalation imediata, que não conta como falha.
- **Review**: sessão nova com `code-review`; **corrige e commita, não reprova**. Nas tentativas seguintes, ponto fixo = último commit revisado, mais checagem focada dos achados anteriores.
- **E2E**: o harness roda `pnpm factory:verify` (typecheck → lint → integração → front → Playwright na stack local), o mesmo script do CI do PR; o código de saída decide; falha devolve ao Development o comando que falhou, a saída cortada e o relatório do Playwright; os prints saem desta execução.
- **Estado entre tentativas**: nunca `resume()`; passam a issue com comentários, o `git log main..HEAD` e o último feedback.
- **Modelo**: Opus em todos os Stages, sem esforço por Stage; valores num arquivo de configuração, sobrescrevível por variável do repo.
- **Tempo**: timeout configurável por Stage (Development 60 min, Review 30 min, E2E 20 min), que conta como falha; teto global de 5 h 30 → Escalation com motivo "tempo".

**Fim da execução**
- **PR igual ao Matt**: draft, título `Fix #N: <título>`, corpo `Closes #N` + "Implemented by the Factory"; a Review vira uma review do GitHub com `event: COMMENT` (resumo único de todas as tentativas + comentários inline); comentário de evidência separado; `gh pr ready` no fim.
- **Escalation** (5 falhas no E2E, tempo ou `needs-human`): PR fica em draft com o aviso "Escalated after 5 failed attempts"; comentário na issue com o motivo, uma linha por tentativa com o comando que falhou, a saída cortada da última falha, o link do run e "re-add `ready-for-agent` to retry (starts over from `main`)"; `in-progress` → `ready-for-human`. `needs-human` sem commits não abre PR. O retry fecha o draft antigo (link no comentário) e recria o branch a partir da `main`.

**Comentários no PR** (padrão `implement-pr` do Matt)
- Só de quem tem `write`+. Disparo ao enviar uma review do GitHub; comentários avulsos agrupados por alguns minutos; concorrência por PR.
- Cada thread: Address (commit linkado), Decline (motivo) ou Defer (sugere issue nova); perguntas respondidas na thread; a Factory nunca resolve threads.
- Depois: Development → Review → E2E → atualização dos prints, limite de 5 falhas; ao estourar, responde no PR e põe `ready-for-human`, sem virar draft.
