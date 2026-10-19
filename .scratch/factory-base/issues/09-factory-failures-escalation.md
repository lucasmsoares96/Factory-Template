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
