# 01: Retomada de extração no seam `Agent`, usada pelo Review

Spec: [../spec.md](../spec.md)

**What to build:** quando a sessão do Review termina sem um bloco `<review>` válido, a Factory retoma a mesma sessão e pede o bloco de novo, até 2 vezes, como o `runWithExtraction` do Sandcastle (`maxRetries: 2`). Os tokens das retomadas entram no uso do Review, e a retomada conta dentro do timeout do Stage. Depois das 2 retomadas, vale o fallback de hoje: a mensagem crua vira o summary. A retomada serve só para extrair a saída; nenhum Stage é retomado para continuar o trabalho.

**Blocked by:** None (can start immediately). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** ready-for-agent

- [ ] O seam `Agent` aceita o validador do bloco esperado e devolve quantas retomadas houve, com os tokens somados.
- [ ] O adaptador do Sandcastle retoma a mesma sessão para extrair; o adaptador falso segue um roteiro (bloco inválido, depois válido).
- [ ] O comentário do seam diz que a sessão nunca é retomada para continuar o trabalho, só para extrair a saída.
- [ ] O Review usa a retomada.
- [ ] Testes pela CLI contra os falsos: bloco válido sem retomada; válido na 1ª e na 2ª retomada; inválido depois de 2, com o fallback da mensagem crua; tokens somados; timeout do Stage respeitado (seam 1).
- [ ] Teste do adaptador do Sandcastle para a retomada.
- [ ] ADR em `docs/adr/`: a retomada só para extração num seam de sessões novas, com as alternativas (sessão nova por retentativa; sem retentativa).
- [ ] `pnpm factory:verify` verde.
