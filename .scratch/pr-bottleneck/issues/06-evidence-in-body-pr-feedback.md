# 06: Evidência no corpo do PR e reescrita no pr-feedback

Spec: [../spec.md](../spec.md)

**What to build:** os prints da evidência passam a ficar no corpo do PR, cada um junto do texto que sustenta, e o comentário de evidência separado deixa de existir. Depois de cada rodada de pr-feedback, o Pull Request Stage reescreve o corpo, para que Summary, Evidence e Merge Danger descrevam o PR como ele está. O update-branch não roda o Stage e não toca no corpo. Isso substitui o comentário único de evidência do ticket 16 da base e os prints refeitos pelo pr-feedback do ticket 18 da base, sem editá-los.

**Blocked by:** 05, [16 da base](../../factory-base/issues/16-factory-on-actions.md), [18 da base](../../factory-base/issues/18-pr-comments-update-branch.md). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** ready-for-agent

- [ ] O `CodeHost` recebe o corpo com as imagens da evidência: o adaptador sobe cada print, troca a referência local pela URL e escreve o corpo, na abertura e na reescrita. No GitHub, `gh pr create|edit --attach`; no adaptador local, as imagens ficam ao lado do PR local.
- [ ] Um print da evidência que o texto não referencia entra no fim da seção Evidence, agrupado por Product; uma referência a um arquivo que não está na evidência é removida.
- [ ] O comentário único de evidência sai do `CodeHost` e do `publish`.
- [ ] O pr-feedback roda o Pull Request Stage e reescreve o corpo; o update-branch não.
- [ ] Testes pela CLI contra os falsos: referências trocadas; print não referenciado no fim da Evidence; referência inexistente removida; nenhum comentário de evidência; corpo reescrito no pr-feedback e intacto no update-branch (seam 1).
- [ ] Teste do adaptador local para o corpo com imagens.
- [ ] Demonstração no repo com um PR de teste com prints no corpo e uma rodada de pr-feedback, apagados no fim (PR, branch, preview).
- [ ] `pnpm factory:verify` verde.
