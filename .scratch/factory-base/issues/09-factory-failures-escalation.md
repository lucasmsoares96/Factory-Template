# 09: Falhas, recusas e Escalation

Spec: [../spec.md](../spec.md)

**What to build:** o harness se comporta certo em tudo o que não é o caminho feliz: recusa issues que não pode construir, espera bloqueadores, repete até 5 vezes, escala com um relato claro, descarta trabalho quando o estado mudou e trata caminhos protegidos. Tudo provado contra os falsos.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] Guard: recusa spec pai, issue com PR aberto, sem `## Acceptance criteria` (→ `needs-info`), sem seams (→ `agent:explore`), label posta por quem não tem `write`+. Seams vêm de `## Testing Decisions` no pai ou do comentário da Triage com `<!-- factory:triage -->` do machine user.
- [ ] Blocked Issue mantém `ready-for-agent` e recebe um único "Waiting on …", só no evento `labeled`, com a dica de recolocar a label.
- [ ] Falha no E2E volta ao Development com o comando que falhou e a saída cortada; limite de 5; timeouts por Stage contam como falha; teto global leva a Escalation "time".
- [ ] `needs-human` com pergunta: Escalation imediata, sem PR quando não há commits.
- [ ] Review incremental: só o que mudou desde o último commit revisado + checagem dos achados anteriores; resumo único de todas as tentativas.
- [ ] Escalation: PR em draft com aviso, comentário na issue (motivo, uma linha por tentativa, saída cortada, link do run, como tentar de novo), `in-progress` → `ready-for-human`. Sem `result.json`, Escalation "infra".
- [ ] Retry fecha o draft antigo e recomeça da `main`.
- [ ] `publish` relê o estado antes de escrever; issue fechada, sem `in-progress`, PR fechado ou branch que andou → "Run discarded: …" sem push.
- [ ] Diff em caminho protegido → Escalation sem PR com o patch; diff em `AGENTS.md`, `docs/agents/`, `GLOSSARY.md`, `docs/adr/` ou `.factory/` → `harness-change` + aviso no PR.
- [ ] Observabilidade: uma linha por tentativa e Stage no resumo, tokens e custo estimado na review e na Escalation.
- [ ] Um teste por caminho acima, pela CLI contra os falsos (seam 1).

## Comments

Sem dependência nova. Preço do Opus 5.5 (US$ 4 / US$ 20 por milhão de tokens de entrada/saída) conferido na tabela de modelos da Anthropic em 2026-10-19 e posto em `config.ts` como `pricing` (sobrescrevível por `FACTORY_PRICING_INPUT_PER_M_TOK` / `FACTORY_PRICING_OUTPUT_PER_M_TOK`). Versões do pacote seguem as do 08.

Como rodar: `pnpm --filter @factory/harness test` e `pnpm --filter @factory/harness typecheck`. Testes novos em `test/work-failures.test.ts` e `test/publish-failures.test.ts`; guard em `test/claim.test.ts`. `testTimeout` foi para 120 s: cada teste dispara dezenas de processos git, e com a máquina carregada (load ~80 com os agentes vizinhos) 30 s não bastavam.

Mudanças nos seams e na CLI (sobre o 08):
- `CodeHost.labelPr(pr, label)` para a `harness-change`. `closePr(pr, comment)` passa a ser usado no retry ("Superseded…").
- `Verify.run` devolve também `timedOut` (timeout do E2E conta como falha, como o do `Agent`).
- `CommandContext` ganhou `now()` (relógio injetável; o teto global e as durações usam ele) e `stepSummary()` (anexa ao `$GITHUB_STEP_SUMMARY` quando existe).
- `claim --event labeled`: só o evento `labeled` comenta "Waiting on …" (comentário único, marcado `<!-- factory:waiting -->`). Recusa a spec pai (issue com filhos) e issue com PR **não-draft** aberto; um draft aberto é o de uma Escalation e não impede o retry. Sem critérios → troca `ready-for-agent` por `needs-info` com comentário; sem seams → `agent:explore`.
- `publish --run-url <url>` (cai para `GITHUB_SERVER_URL/GITHUB_REPOSITORY/actions/runs/GITHUB_RUN_ID`) e `publish --pr <n>` para os fluxos que continuam um PR aberto (18). `publish` agora imprime `outcome: ready | escalated | discarded` em vez de lançar erro.
- `publish` relê a forja antes de qualquer escrita: issue aberta, `in-progress` presente, PR esperado (nenhum PR pronto no fluxo da issue; o `--pr` ainda aberto no fluxo do PR) e head do branch igual ao `--start-sha`. Se mudou, comenta "Run discarded: … Nothing was pushed." e não escreve mais nada. O lease recusado no push também vira "Run discarded".
- Escalation: comentário na issue (motivo, pergunta, uma linha por tentativa, última saída cortada, PR draft, link do run, como tentar de novo, tokens e custo) e `in-progress` → `ready-for-human`. PR draft com `> [!WARNING]` no topo quando há commits; sem PR quando não há commits. Sem `result.json` ou inválido → Escalation `infra` sem push.
- Caminhos protegidos (`src/paths.ts`) → Escalation com motivo novo `protected-paths` (fora do enum de `result.json`, só na saída do `publish`), sem PR e com o patch num `<details>`. Caminhos de harness → label `harness-change` + `> [!CAUTION]` no topo do PR. `AGENTS.md` conta em qualquer nível.
- `needs-human`: o Development termina a mensagem com `<needs-human>pergunta</needs-human>` (instrução no prompt). Escalation imediata.
- Retry: o `work` sempre recria o branch a partir da `main`; o `publish` faz o push com lease contra o head antigo, fecha o draft antigo e abre um novo.
- Review incremental: o prompt traz o SHA do último commit revisado (`git diff <sha>..HEAD`) e os achados anteriores. O resumo da review junta todas as tentativas ("**Attempt N.** …") e os inline de todas, sem repetir.
- Teto global: o timeout de cada Stage é cortado pelo que resta do teto; sem tempo restante, ou estouro durante um Stage, a execução escala com `time`.
- Fake Tracker escreve como o machine user (`self`), para o teste do comentário único.
