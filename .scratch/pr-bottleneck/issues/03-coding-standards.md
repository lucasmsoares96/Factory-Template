# 03: `CODING_STANDARDS.md` na raiz

Spec: [../spec.md](../spec.md)

**What to build:** o repo ganha um `CODING_STANDARDS.md` na raiz, que o eixo Standards do `code-review` já lê no Review e que o Development nunca carrega. Ele nasce do placeholder do template `sequential-reviewer` do Sandcastle: um comentário de topo dizendo que o arquivo é lido pelo Review, não pelo Development, e que as regras saem do `/retro`; seções Style, Testing e Architecture vazias, sem os exemplos do Sandcastle. Um PR da Factory que altere o arquivo ganha o label `harness-change` e o aviso no topo.

**Blocked by:** None (can start immediately). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** ready-for-agent

- [ ] `CODING_STANDARDS.md` na raiz, com o comentário de topo e as três seções vazias.
- [ ] O caminho entra no grupo `harness-change`.
- [ ] Nenhum ponteiro para ele no `AGENTS.md`.
- [ ] Teste de arquivos do harness: o arquivo existe e está no grupo `harness-change` (seam 2).
- [ ] Teste pela CLI contra os falsos: um diff no arquivo gera o label e o aviso `[!CAUTION]` (seam 1).
- [ ] `pnpm factory:verify` verde.
