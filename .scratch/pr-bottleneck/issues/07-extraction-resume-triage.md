# 07: Retomada de extração na Triage

Spec: [../spec.md](../spec.md)

**What to build:** quando a sessão da Triage termina sem um veredito válido, a Factory retoma a mesma sessão e pede o veredito de novo, até 2 vezes, com a retomada do ticket 01. Depois disso, vale o fallback que o ticket 17 da base definiu. Os tokens das retomadas entram no uso da Triage.

**Blocked by:** 01, [17 da base](../../factory-base/issues/17-blocked-issues-triage.md). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** done

- [x] A Triage usa a retomada de extração com o validador do veredito.
- [x] Testes pela CLI contra os falsos: veredito válido sem retomada; válido na 1ª e na 2ª retomada; inválido depois de 2, com o fallback do ticket 17; tokens somados (seam 1).
- [ ] `pnpm factory:verify` verde.

## Comments

2026-10-20: o fallback do ticket 17 da base está definido e implementado (`.factory/src/triage-output.ts`, `.factory/src/commands/triage.ts`). Depois de 2 retomadas sem um bloco `<triage>` válido para todas as issues do lote (ou em timeout), cada issue sem veredito válido recebe o veredito determinístico `needs-a-human` (`ready-for-human`, door `one-way`), com um comentário `<!-- factory:triage -->` que diz "no valid verdict after 2 resumes" (ou "timed out") e traz as últimas palavras da sessão como texto não confiável. Nada vira `ready-for-agent` por palpite. Vereditos válidos do mesmo bloco são mantidos. A retomada de extração já é usada pelo `triage` (`extract: triageExtraction(números)`); os testes por CLI do ticket 17 (`test/triage.test.ts`, grupo "extraction") cobrem sem retomada, 2 retomadas, parcial, nenhum bloco, timeout e a soma dos tokens. Este ticket pode ampliar os casos 1ª/2ª retomada.


2026-10-21: a Triage já usava a retomada (`extract: triageExtraction(números)`, ticket 17). Faltavam só casos: adicionados em `test/triage.test.ts` (sem retomada, válido na 1ª retomada, tokens somados mesmo em retomadas falhas); 2ª retomada, fallback e timeout já cobertos. Sem código de produção novo. `pnpm factory:verify` fica para o orquestrador no merge.
