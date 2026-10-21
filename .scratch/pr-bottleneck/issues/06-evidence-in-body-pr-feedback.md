# 06: Evidência no corpo do PR e reescrita no pr-feedback

Spec: [../spec.md](../spec.md)

**What to build:** os prints da evidência passam a ficar no corpo do PR, cada um junto do texto que sustenta, e o comentário de evidência separado deixa de existir. Depois de cada rodada de pr-feedback, o Pull Request Stage reescreve o corpo, para que Summary, Evidence e Merge Danger descrevam o PR como ele está. O update-branch não roda o Stage e não toca no corpo. Isso substitui o comentário único de evidência do ticket 16 da base e os prints refeitos pelo pr-feedback do ticket 18 da base, sem editá-los.

**Blocked by:** 05, [16 da base](../../factory-base/issues/16-factory-on-actions.md), [18 da base](../../factory-base/issues/18-pr-comments-update-branch.md). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** done

- [x] O `CodeHost` recebe o corpo com as imagens da evidência: o adaptador sobe cada print, troca a referência local pela URL e escreve o corpo, na abertura e na reescrita. No GitHub, `gh pr create|edit --attach`; no adaptador local, as imagens ficam ao lado do PR local.
- [x] Um print da evidência que o texto não referencia entra no fim da seção Evidence, agrupado por Product; uma referência a um arquivo que não está na evidência é removida.
- [x] O comentário único de evidência sai do `CodeHost` e do `publish`.
- [x] O pr-feedback roda o Pull Request Stage e reescreve o corpo; o update-branch não.
- [x] Testes pela CLI contra os falsos: referências trocadas; print não referenciado no fim da Evidence; referência inexistente removida; nenhum comentário de evidência; corpo reescrito no pr-feedback e intacto no update-branch (seam 1).
- [x] Teste do adaptador local para o corpo com imagens.
- [x] Demonstração no repo com um PR de teste com prints no corpo e uma rodada de pr-feedback, apagados no fim (PR, branch, preview).
- [x] `pnpm factory:verify` verde.


## Comments

2026-10-21 (Sonnet 5.5, AFK round 2). Código e testes prontos; falta só a demonstração com conta real. Status segue `ready-for-agent`.

- Seam: `openDraftPr({..., body, images?})` e `updatePrBody(pr, body, images?)`; `EvidenceImage {product, name, path}`. O corpo referencia cada print por `![alt](<path>)`; o adaptador sobe o print, troca a referência pela URL e escreve o corpo. `postEvidence` e `EvidenceGroup` saíram do `CodeHost` (fake, local, GitHub) e do `publish`.
- `src/pull-request-evidence.ts` (`withEvidence`, usado pelo `publish` ao montar o corpo): referência local a um print (o Stage vê `test-results/evidence/<product>/<name>`) vira o `path` da imagem; referência local a outro arquivo é removida (imagem remota `http(s)` fica); print sem referência entra no fim da seção Evidence, agrupado por Product (`### product`), ou numa seção `## Evidence` nova se o texto não tem. Vale também para o corpo mínimo.
- GitHub: sem imagens, PATCH REST; com imagens, `gh pr edit N --body-file --attach <print>...` (token só em `GH_TOKEN`); o PR abre por REST e o `gh pr edit` vem em seguida. Se o `gh` falhar, o corpo é escrito com os prints nomeados no lugar da imagem e o motivo (nunca derruba o run). Local: copia os prints para `.scratch/<feature>/evidence/NN/` e aponta o corpo para eles, relativo ao ticket.
- pr-feedback já rodava o Pull Request Stage (ticket 05) e reescreve o corpo; o update-branch não roda o Stage nem chama `updatePrBody`. Um run que continua um PR sem texto do Stage deixa o corpo antigo (com as URLs de antes).
- Testes: `test/pull-request-evidence.test.ts` (CLI contra os falsos), `test/local-code-host.test.ts`, `test/github/code-host.test.ts`, `test/publish.test.ts` ajustado.

Pending (human): a demonstração (PR de teste com prints no corpo e uma rodada de pr-feedback) precisa do machine user do ticket 16, ainda não criado. Passos: (1) `export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token) && pnpm bootstrap factory` (PAT clássico `repo` de conta separada), mergear esta branch na `main`; (2) issue pequena `ready-for-agent` que gere prints `@evidence`; esperar o PR `factory/issue-N` e conferir os prints no corpo, junto do texto, sem comentário de evidência; confirmar que o `gh` do runner (>= 2.99.0) aceita `--attach` (senão o corpo traz os prints nomeados e o motivo); (3) comentar numa linha do diff com conta `write`+ e conferir que a rodada de pr-feedback reescreve o corpo; (4) apagar PR, branch `factory/issue-N`, issue e preview. O `pnpm factory:verify` completo fica com o orquestrador no merge.


Merge (2026-10-21): `TURBO_FORCE=1 pnpm factory:verify` verde na `factory-base` (13/13, 716 testes do harness). Falta a demonstração com um PR de teste (machine user do ticket 16 da base).

Demonstração real (2026-10-21, conta do dono com o `FACTORY_TOKEN` do ticket 25):
- **Prints no corpo:** o PR #15 trouxe o print `sign-in-tagline` junto do texto da Evidence, e os outros prints no fim da seção, agrupados em `### example`. Nenhum comentário de evidência separado foi criado.
- **Rodada de pr-feedback:** um comentário de review pediu a frase curta em pt-BR. O corpo foi reescrito com a nova Evidence e com o aviso "Departs from the issue text".
- **Defeito da 1ª rodada, corrigido no PR #18:** a Review desfazia o pedido.
- **`--attach`:** o `gh` do runner subiu os prints (URLs `user-attachments`).
- **Melhoria anotada:** todos os 12 prints da rodada entram no corpo, inclusive os de telas que a mudança não toca. Está conforme o critério, mas fica ruidoso.
- **Limpeza:** o PR foi mesclado, o preview e o branch foram apagados.
