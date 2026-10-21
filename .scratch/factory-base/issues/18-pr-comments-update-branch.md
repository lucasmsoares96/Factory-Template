# 18: Comentários no PR e update-branch

Spec: [../spec.md](../spec.md)

**What to build:** um humano com `write`+ comenta num PR da Factory e cada thread recebe Address (com commit), Decline (com motivo) ou Defer, com perguntas respondidas na thread. Quando a `main` anda e um PR da Factory entra em conflito, ele é atualizado sozinho.

**Blocked by:** 16

**Status:** ready-for-agent

- [x] `factory-pr-feedback.yml` (`pull_request_review: submitted`, `pull_request_review_comment`, `issue_comment` em PR): debounce num job com `sleep 180` e `cancel-in-progress: true` (review enviada pula a espera); trabalho no grupo `factory-N`. Filtros: branch `factory/issue-N`, autor com `write`+, nunca o machine user.
- [x] `pr-feedback`: merge da `main`, Address/Decline/Defer por thread → Development → Review → E2E → prints; ao estourar 5 falhas, responde no PR e põe `ready-for-human` sem virar draft; nunca resolve threads.
- [x] `factory-update-branches.yml` (`push` na `main`): `git merge-tree --write-tree` em cada PR da Factory e despacho de `update-branch` só para os em conflito.
- [x] `update-branch`: merge limpo sem agente; conflito resolvido pelo agente com "preserve both intents, do not invent new behaviour"; depois o `Verify` e, se falhar, o loop normal.
- [x] Testes pela CLI contra os falsos: filtros, cada resposta de thread, merge limpo, conflito, "branch moved" (seam 1).
- [ ] Demonstração com um PR de teste comentado e um em conflito, apagados no fim.

## Comments

2026-10-20 (Sonnet 5.5, AFK round 2). Código e testes prontos; falta só a demonstração, que precisava do machine user. *(Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)*

- Contrato: `pnpm factory pr-feedback --pr N --actor LOGIN` (claim com os filtros, lê o estado da forja), `pnpm factory update-branch <issue>` (claim) e `update-branch --scan`; `work <issue> --flow pr-feedback|update-branch --pr N`; `publish <issue> --pr N` (já existia). `CodeHost` ganhou `pullRequest(n)` e `commentPr(n, body)` (fake, local, GitHub).
- Decisões: uma thread está aberta até um comentário com o marcador da Factory ter a última palavra e todos os comentários serem de quem tem `write`+ *(Antes: o machine user tinha a última palavra. Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)* (o seam não tem flag de "resolvida"). `<replies>` ganhou a decisão `answer` (pergunta respondida sem commit; o prompt `pr-feedback.md` mudou). Rodada só com decline/defer/answer não faz commit e pula o Review. O `update-branch` roda o Verify logo após o merge; só uma falha entra no loop normal (conta como a 1ª das 5 tentativas). Conflito que o agente não resolve vira Escalation `needs-human` (merge abortado). O `update-branch` não roda o Pull Request Stage nem toca no corpo; o comentário de evidência continua o do ticket 16 (o ticket 06 do pr-bottleneck o substitui).
- Desvio: o despacho do `scan` chama `factory-update-branches.yml` (o `update-branch` vive nesse mesmo arquivo, `workflow_dispatch` com `issue`) e não um `factory-update-branch.yml` à parte. O grupo `factory-<N>` fica só no job `work` (o N sai do `claim`, e num `issue_comment` o evento não traz a branch); a garantia continua sendo o `--force-with-lease`. Reviews/comentários de nível PR (`issue_comment`, corpo da review) sem thread inline não geram resposta: `claim` devolve `no-open-threads`.
- Testes: `test/pr-feedback.test.ts`, `test/update-branch.test.ts`, `test/github/code-host.test.ts`, `test/ci-workflows.test.ts`. Pelo `FakeAgent`/`FakeCodeHost`, sem forja real.

Pending (human): *(Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)* A demonstração (PR de teste comentado e outro em conflito, apagados no fim) precisava do machine user do ticket 16, ainda não criado. Passos: (1) `pnpm bootstrap factory` (PAT clássico `repo` de uma conta separada) e merge desta branch na `main` (os workflows `pull_request_review*`, `issue_comment` e `push` rodam da `main`); (2) abrir uma issue de teste `ready-for-agent` com critérios e esperar o PR `factory/issue-N`; (3) comentar numa linha do diff com uma conta `write`+ e conferir a espera de 180 s, a resposta na thread e o commit; comentar de novo dentro da espera e conferir que só uma rodada corre; (4) em outra branch/PR da Factory, mexer na mesma linha na `main` e conferir que o `scan` despacha o `update-branch` e o PR volta sem conflito; (5) apagar PRs, branches, issues de teste.


Merge (2026-10-21): na `factory-base`, combinado com o 17 (conflitos resolvidos mantendo os dois lados). `verify` completo verde duas vezes. Falta a demonstração no repo.

- Review fixes 2 (2026-10-21): `openThreads` só devolve threads em que todo comentário é do machine user ou de quem tem `write`+ (o prompt nunca recebe texto de não-writer); `claimPrFeedback` falhava fechado (`no-machine-user`; Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.) se `machineUser` é vazio; escalação numa rodada de PR pronto não escreve mais o aviso "this draft holds its progress"; palavras de fechamento (close/fix/resolve + variantes, `owner/repo#N`, listas, `:`) são removidas também dentro de frases (viram `[closing reference removed]`).

- Defeito achado na demonstração real (PR #15, 2026-10-21): uma writer pediu, numa thread, um tagline pt-BR mais curto em `apps/example/product.config.ts`. A rodada `pr-feedback` fez (f36056a, resposta "Address: Done in f36056a"), mas o Review da mesma rodada desfez (cb3b067, "restore the pt-BR sign-in tagline the issue asks for"): `reviewPrompt` só recebia a issue, nunca as threads. A resposta seguia dizendo "Done" e o aviso do Merge Gate dizia que as respostas foram enviadas; o pedido humano foi desfeito em silêncio.
- Correção: numa rodada `pr-feedback`, o Review e o Pull Request Stage recebem também as threads da rodada e a decisão da Factory em cada uma (`<feedback-round>` com `<thread>` e `<decision kind=...>`, conteúdo não confiável como o bloco da issue). O Review ganhou a regra: o que uma writer pediu e a Factory atendeu (Address) prevalece sobre o texto da issue, nunca é revertido; se conflitar com os critérios, vira achado para o humano no resumo, sem commit que desfaça. O Pull Request Stage descreve a mudança combinada e diz quando ela se afasta da issue. Run normal de issue: prompts inalterados. Testes em `test/pr-feedback.test.ts` e `test/work.test.ts`.

Demonstração real (2026-10-21, conta do dono com o `FACTORY_TOKEN` do ticket 25):
- **PR comentado: feito no PR #15.**
  - **1ª rodada:** o Address fez o pedido (f36056a), mas a Review do mesmo round o desfez (cb3b067). Corrigido no PR #18: a Review e o Pull Request Stage recebem as threads.
  - **2ª rodada:** com a correção, o pedido ficou (8ac41d4), a resposta "Done in 8ac41d4" bate com o commit e o corpo foi reescrito.
  - Nenhuma resposta da Factory disparou outra rodada: o claim deu `no-open-threads` graças ao marcador.
  - A rodada começou mesclando a `main` no branch.
- **Ainda aberto: um PR da Factory em conflito com a `main`.** Ficou sem demonstração, e o Status segue `ready-for-agent`.
