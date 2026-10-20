# 03: `CODING_STANDARDS.md` na raiz

Spec: [../spec.md](../spec.md)

**What to build:** o repo ganha um `CODING_STANDARDS.md` na raiz, que o eixo Standards do `code-review` já lê no Review e que o Development nunca carrega. Ele nasce do placeholder do template `sequential-reviewer` do Sandcastle: um comentário de topo dizendo que o arquivo é lido pelo Review, não pelo Development, e que as regras saem do `/retro`; seções Style, Testing e Architecture vazias, sem os exemplos do Sandcastle. Um PR da Factory que altere o arquivo ganha o label `harness-change` e o aviso no topo.

**Blocked by:** None (can start immediately). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** ready-for-human

- [x] `CODING_STANDARDS.md` na raiz, com o comentário de topo e as três seções vazias.
- [x] O caminho entra no grupo `harness-change`.
- [x] Nenhum ponteiro para ele no `AGENTS.md`.
- [x] Teste de arquivos do harness: o arquivo existe e está no grupo `harness-change` (seam 2).
- [x] Teste pela CLI contra os falsos: um diff no arquivo gera o label e o aviso `[!CAUTION]` (seam 1).
- [ ] `pnpm factory:verify` verde.

## Comments

- Fonte do template: `sequential-reviewer/CODING_STANDARDS.md` do pacote `@ai-hero/sandcastle@0.12.0` (`dist/templates/`; repo mattpocock/sandcastle, `src/templates/sequential-reviewer/`), lido em 2026-10-20. Só o comentário de topo (adaptado: lido pelo Review, não pelo Development; regras vêm do `/retro`) e as seções Style, Testing, Architecture, sem exemplos.
- Também atualizado: tabela de labels em `docs/agents/triage-labels.md` (lista dos caminhos `harness-change`). `AGENTS.md` não aponta para o arquivo (teste cobre todos os AGENTS.md).
- Testes alterados em blocos separados (`describe("CODING_STANDARDS.md")` em `harness-files.test.ts`, um `it` novo em `publish-failures.test.ts`) para merge simples com o pb-04.
- Pending (human/orquestrador): `pnpm factory:verify` não foi concluído por ordem do coordenador (máquina sobrecarregada); rodar em série no merge. Na tentativa parcial, `harness-files.test.ts` passou inteiro (116 testes); as falhas vistas eram timeouts de 120s em testes não tocados (claim/pipeline/auth e2e) sob carga.
