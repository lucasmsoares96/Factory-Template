# 07: Retomada de extração na Triage

Spec: [../spec.md](../spec.md)

**What to build:** quando a sessão da Triage termina sem um veredito válido, a Factory retoma a mesma sessão e pede o veredito de novo, até 2 vezes, com a retomada do ticket 01. Depois disso, vale o fallback que o ticket 17 da base definiu. Os tokens das retomadas entram no uso da Triage.

**Blocked by:** 01, [17 da base](../../factory-base/issues/17-blocked-issues-triage.md). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** ready-for-agent

- [ ] A Triage usa a retomada de extração com o validador do veredito.
- [ ] Testes pela CLI contra os falsos: veredito válido sem retomada; válido na 1ª e na 2ª retomada; inválido depois de 2, com o fallback do ticket 17; tokens somados (seam 1).
- [ ] `pnpm factory:verify` verde.
