# 08: Caminho feliz da Factory contra falsos

Spec: [../spec.md](../spec.md)

**What to build:** o harness leva uma issue `ready-for-agent` até um PR `ready` com review e evidência, num teste que roda sem Claude, sem Docker e sem forja. É o esqueleto do pacote `.factory/`: a CLI, a configuração, os quatro seams e o caminho `claim` → `work` → `publish` em que tudo dá certo na primeira tentativa.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Pacote `.factory/` no workspace com a CLI `pnpm factory <comando>` e `config.ts` (modelos, timeouts, 5 tentativas, labels, limite de previews), sobrescrevível por variável do repo.
- [ ] Interfaces `Tracker`, `CodeHost`, `Agent` e `Verify` como na spec, com adaptadores falsos em memória (o `Agent` falso é roteirizado). Tokens fora das interfaces.
- [ ] `claim`: guard básico (aberta, `ready-for-agent` posta por quem tem `write`+, critérios e seams presentes, bloqueadores `done`) e trava `ready-for-agent` → `in-progress`.
- [ ] `work`: uma tentativa Development → Review → E2E, sessão nova por Stage, gate "gerou commits", saída em `result.json` validado por Zod.
- [ ] `publish`: valida o `result.json`, faz push com `--force-with-lease`, abre PR draft `Fix #N: <título>` com `Closes #N`, review `COMMENT` com inline filtrado ao diff, comentário de evidência único e `ready`.
- [ ] Testes do caminho feliz pela CLI contra os falsos, conferindo labels, PR, review e evidência (seam 1).
