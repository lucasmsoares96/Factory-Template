# Spec: Merge Danger, `CODING_STANDARDS.md` e Retro

Status: ready-for-agent
Origem: comparação do planejamento com a palestra "Fixing the PR Bottleneck" (Matt Pocock, AI Engineer Code 2025, https://youtu.be/LlgiOCmFG_w) e o `/grill-with-docs` que se seguiu. Complementa a [spec da base](../factory-base/spec.md) sem editá-la: tudo aqui fecha antes do [ticket 21 da base](../factory-base/issues/21-base-ready-adrs.md) apagar o `.scratch/`.

## Problem Statement

O pull request da Factory chega ao Merge Gate com um corpo que não diz nada: `Closes #N` e "Implemented by the Factory.". O humano que vai mergear não sabe o que o PR muda, onde está a prova de que funciona, nem quanto custa errar: se a mudança volta atrás com um revert ou se é uma one-way door, e o que ela pode quebrar. A door só aparece no comentário da Triage, escrito antes da implementação, e não descreve o código que de fato foi feito. Os prints ficam num comentário separado, longe do texto que deveriam sustentar. O draft de uma Escalation, justamente o PR que mais precisa de contexto, tem o mesmo corpo vazio.

O Review aplica os padrões do repo pelo eixo Standards do `code-review`, mas o repo não documenta padrão nenhum: o eixo roda só com o baseline de smells. E quando o humano acha no Merge Gate algo que o Review deixou passar, ou quando a Factory escala, nada transforma esse achado num check, numa regra de coding standards ou num ponteiro de navegação. A skill `retro`, que faz isso, saiu do Template, e ninguém sabe onde ficam os logs dos runs para ela ler. O mesmo erro volta no próximo PR.

O Review também comenta inline cada achado, inclusive o que ele mesmo já corrigiu, e o humano lê threads que não pedem nada dele. E quando uma sessão termina sem o bloco de saída estruturada válido, o trabalho dela vira texto cru ou se perde, sem uma segunda chance.

## Solution

Cada run da Factory que deixa commits termina com um quarto Stage, o **Pull Request Stage**: uma sessão nova que escreve o corpo do PR com a skill `pr`. O corpo passa a ter Summary (a menor visualização que mostra a mudança), Evidence (o teste que falhava e passou, e os prints junto do texto que cada um sustenta) e **Merge Danger** (door e blast radius). O comentário de evidência separado deixa de existir. O corpo é reescrito a cada run que pode mudar o comportamento do PR (o run da issue e o pr-feedback), e o draft de uma Escalation também o recebe, com a saída do último E2E que falhou na Evidence. Se o Stage falhar, o PR sai como hoje, com o corpo mínimo, e o rodapé diz por quê.

O Review continua postando a review `COMMENT` com o que conferiu e o que corrigiu, mas só comenta inline o que pede decisão humana e ele não corrigiu.

Toda sessão que devolve saída estruturada (Review, Triage e Pull Request Stage) ganha até duas retentativas que retomam a mesma sessão e pedem o bloco de novo, como o `runWithExtraction` do Sandcastle.

O repo ganha um `CODING_STANDARDS.md` na raiz, vazio por enquanto, que o `code-review` já lê no eixo Standards e que o Development nunca carrega. A skill `retro` volta ao Template, e um doc curto diz onde ficam os logs de cada run. Um humano roda `/retro` sobre uma Escalation, ou sobre um PR em que achou algo no Merge Gate, e o achado vira um check, uma regra no `CODING_STANDARDS.md` ou um ponteiro de navegação.

## User Stories

### Quem revisa no Merge Gate

1. Como humano no Merge Gate, quero que o corpo do PR da Factory tenha Summary, Evidence e Merge Danger, para decidir o merge sem reconstruir a mudança a partir do diff.
2. Como humano no Merge Gate, quero ver no Summary a menor visualização que explica a mudança (árvore, diff de call tree, pseudocódigo, Mermaid), para entender o formato da mudança antes de ler o código.
3. Como humano no Merge Gate, quero que a Merge Danger diga se a mudança é one-way ou two-way door, para saber se um erro se desfaz com um revert.
4. Como humano no Merge Gate, quero que a Merge Danger diga o blast radius, para saber o que conferir no preview antes de mergear.
5. Como humano no Merge Gate, quero que a Merge Danger descreva o código que foi feito, e não o plano da Triage, para que o risco corresponda ao diff.
6. Como humano no Merge Gate, quero ver na Evidence o teste que falhava e passou, para confiar no comportamento sem rodar nada.
7. Como humano no Merge Gate, quero ver cada print junto do texto que ele sustenta, para não precisar casar imagens soltas com a mudança.
8. Como humano no Merge Gate, quero a evidência num lugar só, o corpo do PR, para não procurar prints num comentário separado.
9. Como humano no Merge Gate, quero que os prints sejam agrupados por Product quando o PR afeta vários, para conferir cada Product separado.
10. Como humano no Merge Gate, quero que o corpo use os termos do `GLOSSARY.md`, para ler o PR na mesma língua das issues.
11. Como humano no Merge Gate, quero que os avisos de Escalation e de `harness-change` continuem no topo do corpo, para não perder um aviso por causa do texto do agente.
12. Como humano no Merge Gate, quero que o `Closes #N` esteja sempre certo, para que o merge feche a issue certa.
13. Como humano no Merge Gate, quero que o corpo seja reescrito depois de cada rodada de pr-feedback, para que Summary e Merge Danger descrevam o PR como ele está agora.
14. Como humano no Merge Gate, quero que uma atualização de branch sem mudança de comportamento não reescreva o corpo, para não gastar tokens nem trocar um texto que continua certo.
15. Como humano no Merge Gate, quero continuar vendo, em cada run, a review `COMMENT` com o que o Review conferiu e corrigiu e o custo do run, para acompanhar o histórico do PR.
16. Como humano no Merge Gate, quero que o Review só abra comentário inline para o que pede decisão minha e ele não corrigiu, para que cada thread no PR peça algo de mim.
17. Como humano no Merge Gate, quero que o que o Review corrigiu apareça só no summary da review, para saber o que mudou sem ter de resolver threads.
18. Como humano no Merge Gate, quero que o PR saia mesmo quando o Pull Request Stage falha, com o corpo mínimo e o motivo no rodapé, para que um texto que faltou não jogue fora um trabalho revisado e com E2E verde.

### Quem pega uma Escalation

19. Como humano que pega uma Escalation, quero que o draft tenha o mesmo corpo com Summary, Evidence e Merge Danger, para avaliar o progresso antes de decidir continuar ou recomeçar.
20. Como humano que pega uma Escalation, quero ver na Evidence do draft a saída do último E2E que falhou, para saber onde o trabalho parou.
21. Como humano que pega uma Escalation, quero que o draft continue com o aviso de Escalation no topo, para não confundi-lo com um PR pronto.
22. Como humano que pega uma Escalation sem commits ou por caminho protegido, quero que nada mude no comentário da issue, para continuar recebendo o mesmo relatório de hoje.

### Quem opera a Factory

23. Como operador, quero que o Pull Request Stage tenha timeout e modelo próprios na config, como os outros Stages, para controlar quanto ele custa e quanto tempo ele tira do limite global.
24. Como operador, quero que o Pull Request Stage nunca use o tempo que sobra para o E2E, rodando só depois dele, para que escrever o corpo não cause uma Escalation.
25. Como operador, quero ver os tokens do Pull Request Stage no rodapé de custo, no comentário de Escalation e no resumo do job, para saber o custo real do run.
26. Como operador, quero que o Pull Request Stage não conte para o limite de 5 tentativas, para que ele não troque uma entrega por uma Escalation.
27. Como operador, quero que uma sessão que termina sem bloco de saída válido seja retomada até duas vezes para entregar o bloco, para não perder o trabalho de uma sessão inteira por um formato errado.
28. Como operador, quero que a retentativa retome a mesma sessão, e não abra uma nova, para que ela custe só a extração e não refaça o trabalho.
29. Como operador, quero que o Review, a Triage e o Pull Request Stage usem a mesma retentativa, para que o comportamento seja igual em todo Stage com saída estruturada.
30. Como operador, quero que, depois das retentativas, cada sessão caia no mesmo fallback de hoje (Review: mensagem crua como summary; Pull Request Stage: corpo mínimo), para que a retentativa só acrescente uma chance.
31. Como operador, quero que um run local (`pnpm factory local`) também rode o Pull Request Stage e escreva o corpo no PR local, para conferir o corpo antes do GitHub.

### Quem escreve os coding standards

32. Como mantenedor, quero um `CODING_STANDARDS.md` na raiz, lido pelo Review e não pelo Development, para impor julgamentos de estilo sem gastar tokens na implementação.
33. Como mantenedor, quero que o `CODING_STANDARDS.md` comece vazio, com um comentário dizendo quem o lê e as seções Style, Testing e Architecture, para que só entrem regras tiradas de achados reais.
34. Como mantenedor, quero que um diff da Factory no `CODING_STANDARDS.md` ganhe o label `harness-change` e o aviso no topo do PR, para revisar com cuidado uma mudança que dirige o Review.
35. Como mantenedor, quero que o `AGENTS.md` não aponte para o `CODING_STANDARDS.md`, para que o Development não o carregue.

### Quem roda o Retro

36. Como mantenedor, quero a skill `retro` de volta no Template, vendorada do Matt sem alteração, para rodar `/retro` sobre um run da Factory.
37. Como mantenedor, quero um doc que diga onde estão os logs de um run (artifact `stream-json` do run do Actions, `.jsonl` de um run local, threads do PR), para que o `/retro` leia as fontes primárias sem eu explicar de novo.
38. Como mantenedor, quero rodar `/retro` sobre uma Escalation, seguindo o link do workflow run do comentário, para descobrir onde a Factory travou.
39. Como mantenedor, quero rodar `/retro` sobre um PR em que achei algo no Merge Gate, para transformar o que o Review deixou passar num check ou numa regra.
40. Como mantenedor, quero que o `retro` mande violação mecânica para um check determinístico e só julgamento para o `CODING_STANDARDS.md`, para que o arquivo não vire um lint escrito à mão.

### Quem copia o Template

41. Como quem copia o Template, quero receber o `CODING_STANDARDS.md`, a skill `retro` e o doc dos logs, para ter o loop de retrospectiva desde o primeiro PR.
42. Como quem instala a Factory no Forgejo pelo prompt do último ticket da base, quero que o Pull Request Stage e o `retro` venham junto com o harness, para ter o mesmo corpo de PR e o mesmo loop.

## Implementation Decisions

### Pull Request Stage

- Quarto Stage, depois do loop Development → Review → E2E. Roda uma vez no fim do run, numa sessão nova, sempre que o run deixou commits, também quando o run escala (`e2e-failures`, `needs-human`, e `time` se ainda sobrar tempo). Não roda quando não há commits, quando o `work` não deixou resultado (`infra`) nem quando o limite global já acabou.
- Não muda código. Um commit da sessão é descartado: o branch publicado é o que o E2E validou.
- Não conta para o limite de tentativas. Fica registrado fora das tentativas, numa linha própria no histórico do run e no resumo do job.
- Timeout e modelo próprios na config, como os outros Stages. O timeout é cortado ao que sobra do limite global, como já acontece nos outros.
- O prompt manda usar a skill `pr` e traz: a issue, o log de commits e a base do diff, o resultado do run (E2E verde e em que tentativa, ou o motivo da Escalation e a saída do último E2E que falhou) e a lista de prints de evidência por Product, com os caminhos locais. Proíbe escrever `Closes`, avisos de Escalation ou de `harness-change`.
- A sessão termina com um bloco marcado contendo o corpo em Markdown, como o `<review>` do Review.
- Os prints entram no corpo como referência de imagem ao caminho local da evidência, junto do texto que sustentam. O agente decide onde cada um vai.

### Corpo do PR montado pelo `publish`

- O `publish` monta o corpo em três partes: os avisos `[!WARNING]` (Escalation) e `[!CAUTION]` (`harness-change`) no topo, o texto do Pull Request Stage no meio e `Closes #N` no fim. O agente nunca escreve as partes determinísticas.
- Sem texto do Stage (falhou, estourou o tempo ou não rodou), o meio é a frase de hoje, "Implemented by the Factory.", e o rodapé de custo diz que o Pull Request Stage falhou e por quê.
- O corpo é escrito na abertura do PR e **reescrito** em todo run que continua um PR aberto pelo run da issue ou pelo pr-feedback. O update-branch não roda o Pull Request Stage e não toca no corpo.
- Num run que não abre PR (caminho protegido, sem commits), o texto do Stage é descartado.

### Evidência no corpo

- O `CodeHost` passa a receber o corpo junto com as imagens: o adaptador sobe cada print, troca a referência local pela URL e escreve o corpo. No GitHub, isso é o `gh pr create|edit --attach` (pesquisa 04 da base), que já reescreve a referência no lugar. O adaptador local guarda as imagens ao lado do PR local.
- Um print da evidência que o texto não referencia entra no fim da seção Evidence, agrupado por Product. Uma referência a um arquivo que não está na evidência é removida.
- O comentário único de evidência (`postEvidence`) deixa de existir. Isso substitui o que os tickets 16 e 18 da base entregam (comentário agrupado por Product; pr-feedback refazendo os prints), e por isso esta parte é bloqueada por eles.

### `result.json`

- Ganha o corpo escrito pelo Pull Request Stage (nulo quando não houver), o registro do Stage (resultado, duração, tokens, motivo da falha) e os tokens dele no total de uso. Continua validado com Zod nos dois lados, e o `publish` continua sendo o único com token da forja.
- A linha de custo soma os tokens de todos os Stages, Pull Request Stage incluído.

### Review

- O prompt do Review muda: comentário inline só para o que pede decisão humana e não foi corrigido. O que o Review corrigiu vai só no summary. A review `COMMENT` continua com o summary e o rodapé de custo, em todo run.
- Nenhuma regra nova de revisão: o Review continua com `code-review` e `tdd`.

### Retentativa de extração no seam `Agent`

- O seam `Agent` ganha a retentativa de extração: quem chama passa o validador do bloco esperado, e o adaptador, quando a mensagem final não traz um bloco válido, **retoma a mesma sessão** e pede o bloco de novo, até 2 vezes (`maxRetries: 2` do `runWithExtraction` do Sandcastle). O resultado diz quantas retentativas houve e soma os tokens de todas.
- A retomada só serve para extrair a saída. A regra "uma sessão nova por Stage, nunca retomada para continuar o trabalho" continua valendo para todo o resto, e o comentário do seam passa a dizer isso.
- Usam a retentativa: Review (`<review>`), Triage (veredito) e Pull Request Stage. Depois das 2 retentativas, cada um mantém o fallback que tem: o Review usa a mensagem crua como summary, o Pull Request Stage usa o corpo mínimo, e a Triage o que o ticket 17 da base definir. A parte da Triage é bloqueada pelo ticket 17.
- A retomada conta dentro do timeout do Stage.
- É uma decisão difícil de reverter e que surpreende quem lê o seam, então ganha um ADR em `docs/adr/`.

### `CODING_STANDARDS.md`

- Na raiz, a partir do placeholder do template `sequential-reviewer` do Sandcastle: um comentário de topo dizendo que o arquivo é lido pelo Review (eixo Standards do `code-review`) e não pelo Development, e que as regras saem do `/retro`; seções Style, Testing e Architecture vazias, sem os exemplos do Sandcastle.
- Entra no grupo de caminhos `harness-change`, com o `AGENTS.md`, o `GLOSSARY.md` e o resto.
- Nenhum ponteiro no `AGENTS.md`. O `code-review` já o encontra sozinho.

### Retro

- A skill `retro` volta vendorada sem alteração, no `skills-lock.json` e em `.agents/skills/` (com o link em `.claude/skills/`). Esses caminhos são protegidos, então a instalação é feita por um humano. O agente atualiza a lista de skills do Matt no teste de arquivos do harness e a seção de skills do `AGENTS.md`.
- Um doc novo em `docs/agents/` diz onde o `/retro` encontra as fontes primárias de um run: o artifact `stream-json` do workflow run linkado no comentário de Escalation ou no PR, baixado com `gh run download`; num run local, os `.jsonl` do diretório de sessões; as threads e reviews do PR, onde ficam os achados humanos. Diz também sobre quais runs rodar: Escalations e PRs em que um humano achou algo no Merge Gate.
- O `/retro` é HITL e user-invoked: a Factory nunca o roda sozinha.

### Ordem em relação à base

- Tudo aqui fecha antes do ticket 21 da base. O ticket 21 não é editado: a restrição fica escrita nos tickets desta spec.
- A evidência no corpo e a reescrita no pr-feedback dependem dos tickets 16 e 18 da base; a retentativa da Triage depende do 17. O resto (Pull Request Stage no run da issue e no run local, Review, retentativa no Review, `CODING_STANDARDS.md`, Retro) pode ir antes.

## Testing Decisions

Um bom teste entra pelo seam e confere só o comportamento externo: o corpo e as reviews do PR no `CodeHost` falso, os comentários e labels no `Tracker` falso, o `result.json`, o estado dos arquivos do repo. Ele não confere chamadas internas, e continua passando depois de uma refatoração que não muda o comportamento. Nenhum seam novo: os dois da base cobrem tudo.

1. **Seam 1 da base: CLI da Factory com os quatro adaptadores falsos.**
   - O `Agent` falso ganha roteiro para o Pull Request Stage e para a retomada (primeira resposta com bloco inválido, a seguinte com bloco válido).
   - O `CodeHost` falso guarda o corpo do PR e as imagens recebidas, para o teste ler.
   - Casos: Pull Request Stage depois do E2E verde; na Escalation com commits, com a saída do E2E no prompt; ausente sem commits, em `infra`, com o tempo global esgotado e por caminho protegido; ordem avisos → texto → `Closes #N`; corpo mínimo e motivo no rodapé quando o Stage falha ou estoura o timeout; commit do Stage descartado; Stage fora das tentativas; tokens dele na linha de custo e no resumo do job; corpo reescrito no run que continua um PR e no pr-feedback, intacto no update-branch; referências de print trocadas, print não referenciado no fim da Evidence, referência a arquivo inexistente removida; nenhum comentário de evidência separado; inline só quando o `<review>` os traz; retomada até 2 vezes no Review, na Triage e no Pull Request Stage, com fallback depois disso e tokens somados.
   - O adaptador local tem teste próprio no mesmo nível para o corpo com imagens.
2. **Seam 2 da base: arquivos de configuração.** O teste de arquivos do harness confere: `CODING_STANDARDS.md` na raiz e no grupo `harness-change`; `retro` na lista de skills do Matt, no `skills-lock.json` e em `.agents/skills/`; o doc dos logs presente; timeout e modelo do Pull Request Stage na config e nas variáveis.

Prior art: `publish.test.ts` e `publish-failures.test.ts` (corpo, avisos, review, Escalation), `work.test.ts`, `work-failures.test.ts` e `local.test.ts` (loop de Stages, timeouts, uso), `sandcastle-agent.test.ts` (adaptador do `Agent`, onde entra a retomada), `local-code-host.test.ts` (adaptador local), `harness-files.test.ts` (lista de skills e caminhos), os helpers dos falsos em `.factory/test/helpers.ts`.

**Critério de aceite medido**: um run local com o Claude real (`pnpm factory local`), como o do ticket 10 da base, em que o Pull Request Stage escreve o corpo com a skill `pr` e uma retomada de extração funciona no adaptador do Sandcastle. O resultado é registrado no ticket.

## Out of Scope

- Regra nova de revisão para teste que não prova nada ("detector de mentiras"): o Review continua só com `code-review` e `tdd`.
- Alterar as skills do Matt (`pr`, `code-review`, `retro`, `tdd`).
- Rodar o `/retro` automaticamente, ou dentro da Factory.
- Preencher o `CODING_STANDARDS.md` com regras: elas saem do `/retro` sobre runs reais.
- Pull Request Stage no update-branch.
- Retomar sessão para continuar trabalho: a retomada é só para extração.
- Editar os tickets ou a spec da base.
- Adaptadores Forgejo para o corpo com imagens: ficam com o prompt de instalação do ticket 22 da base, que leva o harness inteiro.

## Further Notes

- Termos novos já no `GLOSSARY.md`: **Merge Danger**, **Retro** e o **Pull Request Stage** dentro de **Stage**. Escreva sempre "Pull Request Stage": "pull request" sozinho é o PR.
- Fontes: a skill `pr` (template Summary / Evidence / Merge Danger); o `ask-matt` ("`/pr` shapes the body… the agent reaches for it whenever it writes a PR"; "`/retro` closes the loop"); a skill `retro` ("Mechanical mistakes become deterministic checks; judgement calls become coding standards"; `CODING_STANDARDS.md` "is read during review, not implementation"); o Sandcastle (`agent-implement.yml` com corpo fixo, `agent-review.yml` com review `COMMENT`, `runWithExtraction` com `maxRetries: 2`, o `CODING_STANDARDS.md` do `sequential-reviewer`). Ver também a [pesquisa do loop do Sandcastle](../factory-harness/research/15-sandcastle-loop-pattern.md) e a [do fluxo das skills](../factory-harness/research/15-pocock-skills-workflow.md).
- O Matt não diz quando o `/pr` roda em relação ao E2E. O Pull Request Stage depois do E2E foi a escolha para que a Evidence traga o resultado real e os prints.
- A Triage continua postando a door no comentário dela. Ela descreve o plano. A Merge Danger do corpo descreve o código.
