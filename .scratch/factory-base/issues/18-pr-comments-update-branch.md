# 18: Comentários no PR e update-branch

Spec: [../spec.md](../spec.md)

**What to build:** um humano com `write`+ comenta num PR da Factory e cada thread recebe Address (com commit), Decline (com motivo) ou Defer, com perguntas respondidas na thread. Quando a `main` anda e um PR da Factory entra em conflito, ele é atualizado sozinho.

**Blocked by:** 16

**Status:** ready-for-agent

- [ ] `factory-pr-feedback.yml` (`pull_request_review: submitted`, `pull_request_review_comment`, `issue_comment` em PR): debounce num job com `sleep 180` e `cancel-in-progress: true` (review enviada pula a espera); trabalho no grupo `factory-N`. Filtros: branch `factory/issue-N`, autor com `write`+, nunca o machine user.
- [ ] `pr-feedback`: merge da `main`, Address/Decline/Defer por thread → Development → Review → E2E → prints; ao estourar 5 falhas, responde no PR e põe `ready-for-human` sem virar draft; nunca resolve threads.
- [ ] `factory-update-branches.yml` (`push` na `main`): `git merge-tree --write-tree` em cada PR da Factory e despacho de `update-branch` só para os em conflito.
- [ ] `update-branch`: merge limpo sem agente; conflito resolvido pelo agente com "preserve both intents, do not invent new behaviour"; depois o `Verify` e, se falhar, o loop normal.
- [ ] Testes pela CLI contra os falsos: filtros, cada resposta de thread, merge limpo, conflito, "branch moved" (seam 1).
- [ ] Demonstração com um PR de teste comentado e um em conflito, apagados no fim.
