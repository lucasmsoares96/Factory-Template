# Pesquisa 15: o fluxo que as skills do Matt Pocock codificam

Pesquisa feita em 2026-10-17, só com fontes primárias. Versões de referência:

- **Upstream `mattpocock/skills`**: `main` em **`49dd158`** (`49dd158d1076134a641b33efb035946536778336`, commit de 2026-10-09 11:56 +0100), `package.json` **v1.3.1** mais 17 changesets ainda não lançados em `.changeset/`. Clone lido em `/tmp/pocock-research/skills`.
- **Cópias locais**: `.agents/skills/` e `.claude/skills/` deste repo, adicionadas no commit `6ce4b5d` (2026-10-17, "chore: add Matt Pocock Skills"). As duas pastas são idênticas entre si (`diff -rq`).

Convenção de citação:

- **L:** é um caminho local relativo a `.agents/skills/`.
- **U:** é um caminho no upstream, sempre em `https://github.com/mattpocock/skills/blob/49dd158/<caminho>`.
- As páginas `docs/engineering/*.md` e `docs/productivity/*.md` do upstream são o FAQ oficial de cada skill. **Não vêm na instalação local**, e é nelas que estão quase todas as ressalvas para uso AFK.

Separo **"o que as skills dizem"** (com citação) de **"Inferência"** (marcado assim).

---

## Resposta curta

1. **Fluxo principal:** `grill-with-docs → (prototype) → to-spec → to-tickets → implement | implement-spec → code-review → (pr) → retro`. O triage é uma entrada paralela que termina no mesmo ponto: uma issue com `ready-for-agent`. Tudo até `to-tickets` é **HITL**. A implementação de um ticket com `ready-for-agent` é o trecho pensado para **AFK**. Merge é sempre humano.
2. **A entrada da Exploration** tem dois formatos possíveis: um ticket do `to-tickets` (What to build + Acceptance criteria + Blocked by + Parent) ou um **Agent Brief** do triage (Category, Summary, Current/Desired behavior, Key interfaces, Acceptance criteria, Out of scope). Nenhum dos dois traz caminhos de arquivo.
3. **`implement`:** lê o ticket, acha os seams, roda `tdd` nos seams pré-acordados, typecheck frequente, suíte completa uma vez no fim, `code-review`, commit no branch atual. Não fecha o ticket nem marca critérios.
4. **`tdd`:** só red → green, em fatias verticais, um teste por vez, e só em seams confirmados. **Não há etapa de refactor desde junho de 2026**: o refactor ficou com o `code-review`.
5. **`code-review`:** recebe um fixed point e o spec. Roda dois eixos (Standards, Spec) em subagents paralelos e reporta os dois sem fundir. Não tem severidade numérica nem veredito. O FAQ recomenda **contexto novo** e avisa que o review **nunca converge**.
6. **Estado entre sessões:** o upstream prefere **ponteiros de contexto** (spec, ticket, notas, commits) a resumos. O `handoff` serve só para levar trabalho a outro harness, diretório ou pessoa. `ready-for-human` é "o mesmo brief + por que um agente não consegue fazer".
7. **Modelo e esforço:** não há prescrição. "They work with any model". A orientação é quebrar o ticket em vez de subir o esforço.
8. **Local × upstream:** as skills locais são **idênticas** ao `main@49dd158`. O que está defasado são `docs/agents/issue-tracker.md` e `docs/agents/triage-labels.md`, gerados por um template antigo do `setup-matt-pocock-skills`.
9. **Sobre o Sandcastle**, o próprio FAQ do `implement-spec` diz: "For work that is truly AFK, a deterministic loop (Sandcastle, a shell script, a CI job) is faster, cheaper, and more reliable, because no agent makes the orchestration decisions." ([U: docs/engineering/implement-spec.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement-spec.md)). Isso valida o desenho da Factory: orquestração determinística por fora e skills por dentro.

---

## Achados detalhados

### 1. O fluxo de ponta a ponta (idea → merge)

**O que as skills dizem**

- **Main flow** ([L: ask-matt/SKILL.md](../../../.agents/skills/ask-matt/SKILL.md), [U: skills/engineering/ask-matt/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158/skills/engineering/ask-matt/SKILL.md)):
  1. `/grill-with-docs` afia a ideia por entrevista e grava `GLOSSARY.md` e ADRs.
  2. Se uma pergunta só se resolve com código rodando, o desvio é `/handoff` → `/prototype` → `/handoff` de volta.
  3. Para build de **várias sessões**: `/to-spec` → `/to-tickets`, depois `/implement` por ticket ("`/clear`ing context between each one") ou `/implement-spec` para o spec inteiro. Para build de uma sessão só: `/implement` direto.
  4. "Either way, the code gets built by driving `/tdd` … and closes out with `/code-review`". O `/pr` formata o corpo do PR.
  5. `/retro` fecha o ciclo e muda o **ambiente** do agente, não o código.
- A cadeia canônica aparece literalmente como `grill-with-docs → to-spec → to-tickets → implement → code-review → retro` ([U: docs/engineering/implement.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement.md)).
- **Higiene de contexto:** os passos 1–3 ficam numa janela só ("don't compact or clear until after `/to-tickets`"). "Each `/implement` then starts fresh, working from the ticket." A "smart zone" é de cerca de 150k tokens ([L: ask-matt/SKILL.md](../../../.agents/skills/ask-matt/SKILL.md)).
- **Entradas (on-ramps):**
  - `/triage` é só para issues "you didn't create". Tickets do `to-tickets` "are already agent-ready, so **don't triage them**" (mesma fonte).
  - `/wayfinder` produz "decisions, not deliverables" e entra no fluxo principal pelo `/to-spec`.
- **HITL × AFK:**
  - `ready-for-agent` = "Fully specified, ready for an AFK agent" ([L: setup-matt-pocock-skills/triage-labels.md](../../../.agents/skills/setup-matt-pocock-skills/triage-labels.md)).
  - O `to-tickets` pede aprovação humana da quebra ("Iterate until the user approves the breakdown") e aplica `ready-for-agent` porque os tickets "are agent-grabbable by construction" ([L: to-tickets/SKILL.md](../../../.agents/skills/to-tickets/SKILL.md)).
  - No `to-spec`, a checagem de seams é HITL: "Check with the user that these seams match their expectations" ([L: to-spec/SKILL.md](../../../.agents/skills/to-spec/SKILL.md)).
  - O `grilling` é HITL por definição: "a grilling session that nobody answers has produced the agent's opinion rather than yours" ([U: docs/productivity/grilling.md](https://github.com/mattpocock/skills/blob/49dd158/docs/productivity/grilling.md)).
  - Na árvore de fronteira de fase, a pergunta 4 é "Can the task be done AFK? … Automated review is the standard case" ([L: ask-matt/PHASE-BOUNDARIES.md](../../../.agents/skills/ask-matt/PHASE-BOUNDARIES.md)).
- **Merge:** nenhuma skill faz merge para `main`.
  - O `implement` "commits to the branch you are on" ([U: docs/engineering/implement.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement.md)).
  - O `implement-spec` termina no integration branch, ou com um PR draft marcado como pronto ([L: implement-spec/SKILL.md](../../../.agents/skills/implement-spec/SKILL.md)).
  - O triage, para PRs: "`ready-for-human` means it's ready for a human to merge" ([L: triage/SKILL.md](../../../.agents/skills/triage/SKILL.md)).
- **Invocação:**
  - `implement`, `implement-spec`, `to-spec`, `to-tickets`, `triage`, `retro` e `handoff` são **user-invoked** (`disable-model-invocation: true`). "no other skill can call it" e "A user-invoked skill may invoke model-invoked skills, but it can never reach another user-invoked skill" ([U: .agents/invocation.md](https://github.com/mattpocock/skills/blob/49dd158/.agents/invocation.md)).
  - `tdd`, `code-review`, `diagnosing-bugs`, `codebase-design` e `pr` são **model-invoked**.

**Inferência:** na Factory, o Sandcastle faz o papel do "humano que digita `/implement`". Os Stages devem chamar as skills **model-invoked** (`tdd`, `code-review`, `pr`, `diagnosing-bugs`) pelo Skill tool. As user-invoked (`implement`) ficam como **prompt do Stage**: copiar o processo para o prompt, ou passar `/implement` como texto do prompt headless. A segunda opção depende de o Claude Code expandir slash command em `claude -p`, o que **não verifiquei** aqui.

### 2. O que uma issue `ready-for-agent` contém (entrada da Exploration)

Há três origens possíveis. Cada uma tem um formato.

**a) Ticket do `to-tickets`** ([L: to-tickets/SKILL.md](../../../.agents/skills/to-tickets/SKILL.md), `<issue-template>`):

- Seções `## Parent`, `## What to build` ("end-to-end behaviour … from the user's perspective, not layer-by-layer"), `## Acceptance criteria` (checkboxes) e `## Blocked by` (omitida quando o bloqueio é nativo).
- Regras de fatia: vertical ("schema, API, UI, tests"), "demoable or verifiable on its own", "sized to fit in a single fresh context window", prefactor primeiro.
- "avoid specific file paths or code snippets". A exceção é snippet de protótipo.
- Cada ticket é sub-issue do spec, com bloqueio nativo do GitHub (`gh issue create --blocked-by`) ([U: docs/engineering/to-tickets.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/to-tickets.md)).

**b) Agent Brief do `triage`** ([L: triage/AGENT-BRIEF.md](../../../.agents/skills/triage/AGENT-BRIEF.md)):

- É um **comentário** na issue. "the agent brief is the contract", e o corpo original é só contexto.
- Template: `**Category:**`, `**Summary:**`, `**Current behavior:**`, `**Desired behavior:**`, `**Key interfaces:**`, `**Acceptance criteria:**` e `**Out of scope:**`.
- Princípios: "Durability over precision" (sem caminhos de arquivo nem números de linha), "Behavioral, not procedural" ("The agent will explore the codebase fresh and make its own implementation decisions"), critérios "concrete, testable" e "independently verifiable", escopo explícito.
- Os comentários de triage começam com `> *This was generated by AI during triage.*` ([L: triage/SKILL.md](../../../.agents/skills/triage/SKILL.md)).
- Antes de `ready-for-agent`, o triage **reproduz o bug**: "A confirmed verification makes a much stronger agent brief" (mesma fonte).

**c) O próprio spec do `to-spec`**, que também recebe `ready-for-agent` ([L: to-spec/SKILL.md](../../../.agents/skills/to-spec/SKILL.md)). Isso é uma **armadilha conhecida**:

> "AFK agents that poll for `ready-for-agent` cannot see that difference. They will try to build the whole spec in one run instead of picking up the ticket slices. This is the most-reported problem with the skill. Until it changes, exclude the parent spec explicitly in your AFK agent's prompt, or remove the label after `/to-tickets` has run."
> ([U: docs/engineering/to-spec.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/to-spec.md))

Template do spec: Problem Statement, Solution, User Stories (lista "LONG"), Implementation Decisions (sem caminhos), **Testing Decisions** (inclui "Which modules will be tested", "Prior art"), Out of Scope e Further Notes. **Os seams acordados vão no spec**, e o `tdd`/`code-review` dependem deles ([U: docs/engineering/to-spec.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/to-spec.md), "Seams before prose").

**Lacunas documentadas na máquina de estados** ([U: docs/engineering/triage.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/triage.md)):

- Não há estado "bloqueado". Uma issue "fully specified but waits on another issue" recebe `ready-for-agent` e "an agent picks it up and gets stuck".
- Não há estado terminal "implemented". "Without it, an AFK runner can queue finished tickets again."
- Critérios de aceite podem "grade nothing": alguns já são verdadeiros no commit base. A recomendação é "name the observation that would show it false, and confirm it fails at the commit the implementer starts from" ([U: docs/engineering/to-tickets.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/to-tickets.md)).

### 3. `implement` e `implement-spec`: o processo prescrito

**`implement`** ([L: implement/SKILL.md](../../../.agents/skills/implement/SKILL.md), 16 linhas):

- Busca o ticket no tracker e "state its title before starting". Se a referência for ambígua, pergunta.
- "Call the Skill tool with "tdd" where possible, at pre-agreed seams."
- "Run typechecking regularly, single test files regularly, and the full test suite once at the end."
- "Once done, call the Skill tool with "code-review"." Depois, "Commit your work to the current branch."

Ressalvas do FAQ ([U: docs/engineering/implement.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement.md)):

- **Não reabre o plano:** "There is no interview, no clarifying round, no proposal of a different approach."
- **Não há fase explícita de exploração/planejamento.** O passo 1 do run é "Read the ticket or spec and work out the seams". A concordância sobre seams "happens either upstream in the spec, or in the first exchange of the run. If it happens nowhere, the run becomes 'just write the code' and nothing warns you."
- **Não fecha nada:** "`implement` has no completion step. It ends at the commit and never touches the work item … does not act on the findings `code-review` produced, and does not tick the `- [ ]` boxes."
- **Bug de review vazio:** `code-review` usa `git diff <fixed-point>...HEAD`, e o `implement` chama o review **antes** do commit. "Commit first, then review against the point you branched from."
- **Viés de auto-review:** "an agent reviewing the code it just wrote is biased toward its own solution. Running code-review in a fresh session against a fixed point is a valid alternative."
- **Custo:** "a non-trivial ticket exceeding 100k tokens is normal". Se um ticket estoura sempre, "split it rather than raising the effort level".
- **Commit vs PR:** não há modo PR, e "People override it in the invocation".
- **Paralelismo no mesmo checkout** é "worse than unsupported": um `--amend` cai no commit de outra sessão, o stash some etc.
- **Sinais de que está funcionando:** abre restaurando o que vai construir, chama `tdd` de fato pelo Skill tool, chega ao commit sem pedir para continuar, e o diff é "one ticket's worth of change".

**`implement-spec`** ([L: implement-spec/SKILL.md](../../../.agents/skills/implement-spec/SKILL.md)):

- Lê o grafo de tickets. Opcionalmente, um **exploration subagent** salva "markdown notes in a directory outside the repo, accessible by all future subagents", para que os implementadores "focus on implementation rather than exploration".
- Cada implementador trabalha em worktree própria, baseada no integration branch, chama `tdd` e faz merge do tip do integration branch antes de reportar.
- No fim, **um** `code-review` sobre o integration branch, e "Fix all issues raised by the code review in a single implementer subagent".
- A comunicação é "sparse … primarily through context pointers".
- Ressalvas do FAQ ([U: docs/engineering/implement-spec.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement-spec.md)):
  - O loop review/fix "took roughly four hours" num caso real. O skill "doesn't yet say when to stop after that fix". A sugestão é: "tell it to run focused checks for the fixed findings and stop".
  - Testes que dependem de arquivos gitignorados "can silently skip" em worktree.
  - No GitHub, o contador `blocked_by` só cai quando o bloqueador **fecha**.

### 4. `tdd`: o loop exato

Fonte: [L: tdd/SKILL.md](../../../.agents/skills/tdd/SKILL.md), [tests.md](../../../.agents/skills/tdd/tests.md), [mocking.md](../../../.agents/skills/tdd/mocking.md) e [U: docs/engineering/tdd.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/tdd.md).

- **Loop:** "TDD is the red → green loop." As regras:
  - "Red before green. Write the failing test first, then only enough code to pass it."
  - "One slice at a time. One seam, one test, one minimal implementation per cycle."
  - "Refactoring is not part of the loop. It belongs to the review stage."
- **Por que não há refactor:** "The skill dropped it in June 2026 because agents almost never performed it, and because review and implementation work better as separate sessions" (FAQ).
- **Fatias verticais / tracer bullet:** um teste → uma implementação. **Horizontal slicing** (todos os testes primeiro) é anti-padrão.
- **Seams pré-acordados:** "Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam." Cada seam proposto leva uma nota de uma linha sobre o que pega e o que deixa passar (mudança do changeset `tdd-seam-tradeoffs`). No fluxo completo, os seams são acordados no `to-spec`, e "`/code-review` checks that only agreed-upon test seams were used" (FAQ).
- **Testes de integração:** "Integration-style: Test through real interfaces, not mocks of internal parts". Mock só em fronteira de sistema (APIs externas, tempo, aleatoriedade, às vezes FS/DB), "Don't mock … Anything you control" ([L: tdd/mocking.md](../../../.agents/skills/tdd/mocking.md)).
- **Três anti-padrões:** acoplado à implementação, **tautológico** (o valor esperado tem de vir de "a known-good literal, a worked example, the spec") e horizontal.
- **E2E/browser:** "Should it write browser or end-to-end tests first? Usually not … Browser tests are slow enough that the red-green feedback loop stops paying for itself. State in your repo's `CLAUDE.md` that browser tests come after the behaviour works" (FAQ).
- **É obrigatório para agentes?**
  - O `implement` diz "where possible", e o `implement-spec` manda cada implementador chamar `tdd`.
  - O FAQ aceita a não-conformidade: "No instruction makes an agent comply 100% of the time … The loop is worth running even when the agent does not follow it strictly."
  - Há uma lacuna aberta ([issue #746](https://github.com/mattpocock/skills/issues/746)): config, wiring, glue e CRUD não se encaixam. Rodar TDD nesses casos gera teste tautológico.
- **Sinal de conformidade:** "You can see an actual `tdd` Skill tool call in the trace" ([U: docs/engineering/implement.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement.md)).

### 5. `code-review`

Fonte: [L: code-review/SKILL.md](../../../.agents/skills/code-review/SKILL.md) e [U: docs/engineering/code-review.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/code-review.md).

- **Entradas:**
  - Um **fixed point**, obrigatório ("If they didn't specify one, ask for it"). Antes de tudo, valida com `git rev-parse` e diff não vazio.
  - O diff `git diff <fixed-point>...HEAD` (três pontos) e `git log <fixed-point>..HEAD --oneline`.
  - O **spec**, procurado nesta ordem: (1) refs `#123`/`Closes #45` **nas mensagens de commit**; (2) um caminho passado como argumento; (3) arquivo em `docs/`, `specs/` ou `.scratch/`; (4) perguntar. Sem spec, o eixo Spec é pulado com "no spec available".
- **Eixos:**
  - **Standards:** arquivos de padrão do repo (sempre `CODING_STANDARDS.md`/`CONTRIBUTING.md` se existirem), mais um **baseline de 12 smells de Fowler**. "The repo overrides". Smell é "always a judgement call". "skip anything tooling already enforces."
  - **Spec:** (a) requisitos faltando ou parciais; (b) scope creep; (c) requisito implementado errado. Cada achado cita a linha do spec.
- **Formato de saída:**
  - Dois subagents paralelos, em foreground, com menos de 400 palavras cada.
  - O relatório tem `## Standards` e `## Spec` "verbatim or lightly cleaned", sem fundir nem reordenar.
  - Termina com "a one-line summary: total findings per axis, and the worst issue within each axis". "Don't pick a single winner across axes."
- **Severidade:** a única distinção é **hard violation** (quebra de padrão documentado) × **judgement call** (smells). Não há escala nem veredito pass/fail.
- **Contexto novo:** "Prefer a fresh one. … 'Same context reviewing itself isn't review, it's confirmation bias with a slash command.'" (FAQ). Os dois eixos já rodam em subagents separados "so they don't pollute each other's context".
- **O que fazer com os achados:**
  - "Sub-agent output is a hypothesis, not evidence … Read the citation on each finding before you act on it."
  - "There is no convergence guarantee. Treat a pass as a list of leads. Act on the ones with a cited rule behind them, then stop. Do not run it in a loop until it comes back clean, because it never will."
  - No `implement-spec`, todos os achados vão para **um** implementador de correção.
- **Riscos para uso AFK** (FAQ):
  - Os subagents podem se re-invocar recursivamente (um relato chegou a mais de 50 agentes). O upstream considera isso **trabalho do harness**, não da skill ([U: .out-of-scope/subagent-recursion.md](https://github.com/mattpocock/skills/blob/49dd158/.out-of-scope/subagent-recursion.md)).
  - Há colisão de nome com o `/code-review` embutido do Claude Code. Numa instalação por arquivos, "the local file wins".
  - Não vê trabalho não commitado.
- **Por ticket ou no fim:** os dois modos funcionam. "If you are unsure, review per ticket and run one final pass against the branch point."
- O `retro` reforça a divisão: "the review agent should be responsible for imposing coding standards, not the implementation agent", e o `CODING_STANDARDS.md` "is read during review, not implementation" ([L: retro/SKILL.md](../../../.agents/skills/retro/SKILL.md)).

### 6. Estado entre sessões e quando parar e passar para um humano

**Handoff / estado** ([L: ask-matt/PHASE-BOUNDARIES.md](../../../.agents/skills/ask-matt/PHASE-BOUNDARIES.md), [L: handoff/SKILL.md](../../../.agents/skills/handoff/SKILL.md), [U: docs/productivity/handoff.md](https://github.com/mattpocock/skills/blob/49dd158/docs/productivity/handoff.md)):

- Na fronteira de fase há cinco opções, em ordem: Continue → `/clear` → `/handoff` → Subagent → `/compact`.
- "Every move except **Continue** turns a primary source into a secondary source".
- O `/handoff` é "narrow": serve para trocar de harness, de diretório, passar para um colega ou bifurcar uma tarefa lateral. "If nothing is travelling, you don't need it."
- O documento de handoff vai para `$TMPDIR`, com uma seção "suggested skills", e "Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead."
- Risco: "watch for confident claims the session never verified … a belief written as a fact becomes a false premise for everything that follows" (FAQ).
- O `claude-handoff` é **in-progress** (beta, fora do plugin). Lança `claude --bg --name … -- "$(cat <file>)"` ([L: claude-handoff/SKILL.md](../../../.agents/skills/claude-handoff/SKILL.md), [U: skills/in-progress/README.md](https://github.com/mattpocock/skills/blob/49dd158/skills/in-progress/README.md)).
- O `implement-spec` e o `chief-of-staff` (in-progress) usam **context pointers** e notas de exploração em um diretório fora do repo ([L: chief-of-staff/SKILL.md](../../../.agents/skills/chief-of-staff/SKILL.md)).
- O `loop-me` (in-progress) **não é** um loop de execução. É uma sessão de grilling que escreve specs de *workflows* em `workflows/*.md`. Vocabulário útil:
  - **Trigger** (evento ou agenda).
  - **Checkpoint** (HITL).
  - **Push right**: "defer the checkpoint as far as it will go".
  - **Brief**: "a tight, decision-ready summary … never the raw output".
  - Fonte: [L: loop-me/SKILL.md](../../../.agents/skills/loop-me/SKILL.md).

**Quando parar / passar para humano:**

- `ready-for-human`: "same structure as an agent brief, but note why it can't be delegated (judgment calls, external access, design decisions, manual testing)" ([L: triage/SKILL.md](../../../.agents/skills/triage/SKILL.md)).
- `needs-info`: template "## Triage Notes" com "What we've established so far" e "What we still need from you (@reporter)". As perguntas têm de ser "specific and actionable" (mesma fonte).
- No `diagnosing-bugs`, quando não dá para montar o loop: "Stop and say so explicitly. List what you tried. Ask the user for…". No Phase 3, "Don't block on it; proceed with your ranking if the user is AFK" ([L: diagnosing-bugs/SKILL.md](../../../.agents/skills/diagnosing-bugs/SKILL.md)). Isso é **orientação explícita para AFK**.
- O `wizard` cobre passos que só um humano pode fazer, como credenciais e dashboards ([L: ask-matt/SKILL.md](../../../.agents/skills/ask-matt/SKILL.md), seção Standalone).
- O `wayfinder` classifica tickets como HITL ou AFK. Pesquisa é AFK, grilling e protótipo são HITL ([L: wayfinder/SKILL.md](../../../.agents/skills/wayfinder/SKILL.md)).

### 7. Escolha de modelo e esforço

Não há nenhuma prescrição de modelo por skill. O que existe:

- "They work with any model." ([U: README.md](https://github.com/mattpocock/skills/blob/49dd158/README.md))
- Para ticket grande, "split it rather than raising the effort level" ([U: docs/engineering/implement.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement.md)).
- "Weaker and faster models still skip the gate … most often on lower-effort or non-frontier models" ([U: docs/productivity/grilling.md](https://github.com/mattpocock/skills/blob/49dd158/docs/productivity/grilling.md)).
- O template de bug pede "Model and effort — e.g. Opus, high effort. Roughly how full was the context" ([U: .github/ISSUE_TEMPLATE/bug.yml](https://github.com/mattpocock/skills/blob/49dd158/.github/ISSUE_TEMPLATE/bug.yml)).
- Sobre orçamento de contexto: a smart zone tem cerca de 150k tokens ([L: ask-matt/SKILL.md](../../../.agents/skills/ask-matt/SKILL.md)). Um ticket do wayfinder é "sized to one 100K token agent session" ([L: wayfinder/SKILL.md](../../../.agents/skills/wayfinder/SKILL.md)). Um ticket do `implement` passar de 100k é "normal".

**Inferência:** a decisão de modelo e esforço por Stage fica com a Factory (pesquisa do Sandcastle e ticket 15). As skills só dizem para dimensionar o ticket para uma janela nova.

### 8. Diferenças entre as cópias locais e o upstream

- **Skills:** as 38 pastas locais são **idênticas** às do upstream `main@49dd158` (`diff -rq` sem saída, pasta por pasta). Isso inclui os changesets ainda não lançados depois da v1.3.1:
  - `implement` busca o ticket e declara o título.
  - `implement` chama `tdd`/`code-review` pelo Skill tool.
  - `tdd` dá o trade-off de cada seam.
  - `code-review` procura arquivos de padrão e roda subagents em foreground.
  - `to-tickets` cria sub-issues e omite `Blocked by` quando o bloqueio é nativo.
  - `wayfinder` não aplica `ready-for-agent`.
  - Fonte: [U: .changeset/](https://github.com/mattpocock/skills/tree/49dd158/.changeset).
- **Não vem localmente:**
  - As páginas `docs/engineering/*` e `docs/productivity/*` (o FAQ), onde estão as ressalvas de AFK citadas acima.
  - O `.out-of-scope/` do upstream.
  - O `resolving-merge-conflicts`, que foi **removido** na v1.3.0: "the agent works through an in-progress merge or rebase conflict without a dedicated skill" ([U: CHANGELOG.md](https://github.com/mattpocock/skills/blob/49dd158/CHANGELOG.md)).
- **Defasado localmente:**
  - `docs/agents/issue-tracker.md` lê issues com `gh issue view <n> --comments`, enquanto o template atual usa `--json number,title,body,labels,comments`. Também falta o comando de sub-issue (`gh issue create --parent`) e muda a listagem de PRs externos.
  - `docs/agents/triage-labels.md` difere em uma linha de texto.
  - Origem: esses arquivos vieram de uma versão anterior do template do `setup-matt-pocock-skills`. O changeset `setup-tracker-fixes` manda "Re-run `/setup-matt-pocock-skills` to refresh `docs/agents/`".
- **Status das skills:**
  - `loop-me`, `claude-handoff`, `chief-of-staff`, `setup-ts-deep-modules` e `writing-*` estão em `skills/in-progress/`: "Beta … can change or disappear without warning".
  - Os `misc/` (`git-guardrails-claude-code`, `setup-pre-commit`, `migrate-to-shoehorn`, `scaffold-exercises`) estão "frozen and unmaintained" ([U: SCOPE.md](https://github.com/mattpocock/skills/blob/49dd158/SCOPE.md)).
- **Pequena inconsistência upstream:** o `GLOSSARY.md` do upstream dá `ready-for-afk` como exemplo de triage role, mas o label canônico é `ready-for-agent` ([U: GLOSSARY.md](https://github.com/mattpocock/skills/blob/49dd158/GLOSSARY.md)). Irrelevante para nós.

### 9. AFK, Sandcastle e automação no próprio repo do Matt

- Não há nenhuma skill "afk", "ralph" ou "sandcastle" no upstream (busca por esses termos em todo o repo).
- A única menção ao Sandcastle é o FAQ do `implement-spec`: as skills **não substituem** um loop determinístico. Para trabalho "truly AFK", Sandcastle, shell ou CI é "faster, cheaper, and more reliable" ([U: docs/engineering/implement-spec.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/implement-spec.md)).
- O FAQ do triage fala de um "AFK runner" que lê `ready-for-agent`: "`to-tickets` applies the `ready-for-agent` label when it publishes them, so an AFK runner picks them up without another pass" ([U: docs/engineering/triage.md](https://github.com/mattpocock/skills/blob/49dd158/docs/engineering/triage.md)).
- O `writing-for-agents` vale também para "system and AFK prompts" ([U: docs/productivity/writing-for-agents.md](https://github.com/mattpocock/skills/blob/49dd158/docs/productivity/writing-for-agents.md)). Na prática, os prompts dos Stages devem seguir essa skill.
- A automação de GitHub Actions do próprio repo é só de rótulos:
  - `triage-label.yml` aplica `needs-triage` em issue nova.
  - `needs-info.yml` fecha `needs-info` depois de 14 dias, via `actions/stale`.
  - Nenhum agente roda em CI ali ([U: .github/workflows/](https://github.com/mattpocock/skills/tree/49dd158/.github/workflows)).

---

## Padrão recomendado aplicado à Factory

Tudo nesta seção é **inferência** a partir dos achados acima. Os números entre parênteses apontam para a seção do achado.

**Princípio geral:** o Sandcastle é o "loop determinístico" que o Matt recomenda para AFK (§9) e faz o papel do humano que despacha tickets (§1). Dentro de cada Stage, o agente usa as skills **model-invoked**. O processo das user-invoked (`implement`) vira texto do prompt do Stage, escrito segundo `writing-for-agents`.

| Stage | Skill(s) | Como usar |
| - | - | - |
| **Exploration** | Processo do `implement-spec` passo 2 (exploration subagent), `codebase-design` (vocabulário), leitura de `GLOSSARY.md` e ADRs | Ler a issue **inteira** (corpo + comentários, porque o Agent Brief é comentário), o spec pai e os bloqueadores. Produzir **notas em arquivo** fora do código (ponteiros, não resumo) com: critérios de aceite normalizados, **seams sob teste com a nota "pega / deixa passar"**, módulos tocados e prior art de testes. Checar se cada critério **falha no commit base** (§2). Se a issue não tem critérios testáveis, ou é o spec pai, ou é "não delegável", **parar** e sair com `needs-info` ou `ready-for-human` em vez de seguir (§6). |
| **Development** | Processo do `implement` + `tdd` (Skill tool) + `diagnosing-bugs` quando o feedback for um bug difícil | Seams = os fixados na Exploration, que **substituem a confirmação humana** do `tdd`. Red → green em fatias verticais. Typecheck e teste unitário de um arquivo com frequência, suíte completa uma vez no fim. Commit no branch com a **ref da issue na mensagem** (`#N`), para o eixo Spec do review achar o spec (§5). **Sem** o `code-review` interno do `implement`: o review é um Stage separado em contexto novo (§3, §5). Nas voltas 2–5, a entrada é o feedback tipado do E2E/Review mais ponteiros (issue, notas, `git log`), não um handoff em prosa (§6). |
| **E2E** | Nenhuma skill cobre. O `diagnosing-bugs` serve de referência para montar o loop red-capable. O `pr` serve para a evidência | Rodar depois de o comportamento existir: o `tdd` diz explicitamente que browser/E2E não entra no red-green (§4). O veredito é determinístico (código de saída dos testes), não opinião de agente. A saída para a Development é o comando que falhou mais a saída redigida, no formato da "completion criterion" do `diagnosing-bugs`. |
| **Review** | `code-review` (Skill tool) em **sessão nova** | Fixed point = merge-base com `main`. Spec = issue (ref no commit) mais o spec pai. Os dois eixos seguem separados. **Critério de falha:** só achados **Spec (a)/(c)** e **hard violations** de Standards com regra citada. Smells e scope creep viram comentário no PR, não loop (§5: "never converges", "then stop"). Proteger contra recursão de subagents no harness: limitar a ferramenta Agent ou a profundidade (§5). |
| **Escalation** | Formato `ready-for-human` do `triage` + `pr` + disclaimer | Comentário na issue com a estrutura do Agent Brief mais **por que não foi possível** (as 5 falhas, último veredito de cada eixo, ponteiros para os commits). Primeira linha no estilo `> *This was generated by AI …*`. PR draft com corpo no template do `pr` (Summary / Evidence / Merge Danger). |
| **Pós-run (opcional)** | `retro` (HITL) | Rodar sobre o log de runs escalados para propor checks determinísticos e regras de `CODING_STANDARDS.md` lidas pelo Review (§5, `retro`). |

### Lacunas

1. **Seams sem humano:** `tdd` e `to-spec` exigem confirmação humana dos seams. A Factory precisa declarar no prompt que os seams vêm do spec, do brief ou da Exploration e contam como pré-acordados. Se faltarem, a Exploration decide e registra.
2. **Sem veredito tipado:** o `code-review` não emite `{passed, feedback}`. A Factory tem de mapear a saída dos dois eixos para pass/fail, ou pedir um bloco estruturado extra no prompt do Review.
3. **Sem convergência:** o upstream avisa que review/fix pode girar por horas. O limite de 5 falhas da Factory é coerente com isso, mas o critério de falha do item 2 precisa ignorar smells.
4. **Estados faltando:** não há "blocked" nem "implemented" na máquina de triage. A Factory já tem Blocked Issue e precisa **tirar `ready-for-agent`** (ou equivalente) ao assumir uma issue, para não reenfileirar (§2).
5. **Spec pai com `ready-for-agent`:** a Factory precisa excluir issues que têm sub-issues, ou que são spec, do gatilho (§2).
6. **`implement` não fecha nada:** fechar a issue e marcar critérios fica com a Factory, via `Closes #N` no PR, aplicado no Merge Gate (§3).
7. **User-invoked × headless:** `implement`, `triage` e `to-tickets` não podem ser chamados por outra skill. Se o prompt do Stage depender de `/implement` em `claude -p`, é preciso verificar a expansão de slash commands no modo headless (não verificado aqui).
8. **Não há `CODING_STANDARDS.md` no repo**, então o eixo Standards vai rodar só com o baseline de smells até a Factory ganhar um.
9. **`docs/agents/` defasado:** rodar de novo o `/setup-matt-pocock-skills` (passo humano) antes de a Factory depender dos comandos `gh` desses arquivos (§8).
10. **Nenhuma skill de E2E:** o Stage E2E vai precisar de prompt próprio. A pesquisa 08 cobre o tooling.

---

## Riscos em aberto

- **Mudança frequente:** o upstream muda rápido (17 changesets pendentes em 9 dias). Vale fixar o SHA no `skills-lock.json` e reler o FAQ ao atualizar.
- **FAQ citando GitHub issues:** algumas ressalvas do FAQ citam issues abertas no upstream (#746, #589, #139, #297), que podem mudar o comportamento das skills.
- **Fora do escopo desta pesquisa:** os artigos do Matt sobre loops e o README do Sandcastle estão sendo lidos pelo agente paralelo. Esta pesquisa não verificou se eles contradizem algo acima.
