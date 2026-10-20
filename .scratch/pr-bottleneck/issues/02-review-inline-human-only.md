# 02: Review: inline só para decisão humana

Spec: [../spec.md](../spec.md)

**What to build:** o Review só abre comentário inline no PR para o que pede decisão humana e ele não corrigiu. O que ele corrigiu aparece só no summary da review `COMMENT`. A review `COMMENT`, com o summary e o rodapé de custo, continua em todo run. Nenhuma regra nova de revisão: o Review segue com `code-review` e `tdd`.

**Blocked by:** None (can start immediately). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** ready-for-agent

- [ ] O prompt do Review diz: inline só para o que pede decisão humana e não foi corrigido; o que foi corrigido vai no summary.
- [ ] Teste do prompt renderizado com a instrução.
- [ ] Testes pela CLI contra os falsos: um `<review>` sem inline gera review `COMMENT` sem comentários; com inline, os comentários chegam filtrados ao diff (seam 1).
- [ ] `pnpm factory:verify` verde.
