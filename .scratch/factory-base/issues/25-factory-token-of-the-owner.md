# 25: A Factory usa um token do dono do repo, sem machine user

Spec: [../spec.md](../spec.md)

**What to build:** o módulo Factory deixa de exigir uma segunda conta no GitHub. O `FACTORY_TOKEN` passa a ser um token fine-grained do próprio dono, restrito a este repo, colado uma vez no `pnpm bootstrap factory`. Como a Factory agora escreve com a identidade do dono, ela se reconhece por um marcador oculto no texto, e não mais pelo autor. O aviso de que o PR está pronto sai pelo `GITHUB_TOKEN`, porque o GitHub não notifica ninguém das próprias ações.

Decisão do usuário (2026-10-21):
- **Machine user rejeitado:** criar outra conta à mão é um fluxo ruim.
- **GitHub App rejeitado:** o Forgejo não tem.
- **`GITHUB_TOKEN` + botão "Criar PR" (como o `claude-code-action`) rejeitado:** commits da Factory num PR aberto não disparariam o CI.

**Blocked by:** 16, 17, 18

**Status:** done

## Acceptance criteria

- [x] **Token no `pnpm bootstrap factory`.** É um único prompt, com o token oculto. O wizard imprime **um** link pré-preenchido:
  ```text
  https://github.com/settings/personal-access-tokens/new?name=Factory+<repo>&description=<...>&target_name=<owner>&expires_in=none&contents=write&pull_requests=write&issues=write
  ```
  - O link vai sem `workflows`. Antes do link, o wizard diz que o único passo manual é escolher "Only select repositories" → este repo.
  - O token é conferido antes de ser gravado em `FACTORY_TOKEN`:
    - **prefixo:** aceita só `github_pat_` e recusa o clássico `ghp_` e os demais;
    - **acesso:** `GET /repos/{o}/{r}` com o token responde com `permissions.push`;
    - **workflows:** o token não tem permissão de `workflows`, se a API permitir saber. Se não der para saber, o wizard avisa.
  - São três tentativas, e nada é gravado de um token recusado. `FACTORY_TOKEN` no ambiente ou já como secret evita o prompt, pela regra de nunca perguntar duas vezes.
- [x] **Machine user removido de vez:**
  - os passos `machine-user` e `machine-collaborator`, o `machine.ts`, o convite e o aceite;
  - a variável `FACTORY_MACHINE_USER` no wizard, no `doctor`, no `destroy`, no `config.ts`, nos workflows e nos testes;
  - a conferência por `X-OAuth-Scopes`.

  O `destroy` continua apagando o `FACTORY_TOKEN`.
- [x] **Marcador da Factory.** Todo texto que a Factory escreve com o `FACTORY_TOKEN` leva o marcador oculto `<!-- factory -->`: corpo do PR, comentários, review, respostas em thread e comentário da Triage. O marcador é posto num lugar só, nos adaptadores de escrita, e não em cada chamador. Um teste prova que nenhum caminho de escrita sai sem ele.
- [x] **Filtros por marcador, não por autor:**
  - **comentários do PR** (`factory-pr-feedback.yml` e `pr-threads.ts`): um comentário com o marcador é da Factory e nunca a dispara. Um comentário sem marcador conta só se o autor tem `write`+;
  - **comentário da Triage:** é confiável se tem o marcador **e** o autor tem `write`+. Quem tem `write` já poderia aplicar as labels, então forjar o marcador não dá poder novo;
  - **troca aceita e documentada:** um comentário humano que contenha o marcador é ignorado;
  - **`pr-claim`:** deixa de recusar por machine user vazio.
- [x] **Aviso do Merge Gate.** Quando o `publish` abre ou atualiza o PR, ou termina em Escalation, um comentário curto na issue sai pelo `GITHUB_TOKEN` do job. Ele aparece como `github-actions[bot]`, menciona quem aplicou `ready-for-agent` e leva o link do PR. Com o `GITHUB_TOKEN`, o comentário não dispara workflows. Fica coberto por um teste de YAML e por um teste do adaptador.
- [x] **Testes contra os falsos:**
  - **loop:** um comentário escrito pelo adaptador não dispara o `pr-feedback`;
  - **marcador forjado:** um não-writer com o marcador é ignorado;
  - **comentário humano:** um writer sem marcador dispara o `pr-feedback`;
  - **token:** um token `ghp_` é recusado, e um token sem `push` também;
  - **fluxo do wizard:** a execução repetida não pergunta nada, e o link aparece uma vez.
- [x] **Spec e docs atualizados:**
  - na spec: histórias 8 e 16 e as seções de guard, de comentários no PR e da parte comum;
  - nos tickets 16, 17 e 18: nota "substituído pelo 25" nos trechos do machine user;
  - no ticket 22: a nota sobre o Forgejo, abaixo;
  - no `.factory/AGENTS.md` e no `GLOSSARY.md`, se citarem o machine user;
  - em `docs/adr/`: um ADR curto com a decisão e as alternativas rejeitadas.
- [x] `pnpm factory:verify` verde.

## Notes

- **Docs consultados em 2026-10-21:**
  - **GitHub:** "Pre-filling fine-grained personal access token details using URL parameters", em [Managing your PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). Os parâmetros são `name`, `description`, `target_name`, `expires_in` (1–366 ou `none`) e `<permission>=read|write`. Não há parâmetro para escolher repos. O `metadata: read` entra sozinho.
  - **Forgejo:** a v15, LTS até 2027-07-15, tem tokens restritos a repos específicos, só com `read/write:repository` e `read/write:issue` ([token scope](https://forgejo.org/docs/v15.0/user/authentication/token-scope/)).
- **No Forgejo não existe escopo `workflow`.** Um token com `write:repository` consegue alterar `.forgejo/workflows/`. Lá, a única defesa é a recusa de caminhos protegidos antes do `publish` (Escalation `protected-paths`), e o token nunca vai para o job `work`. Isso vai para o ticket 22.
- **Perdas aceitas:**
  - o histórico do repo não separa a Factory do dono;
  - o PR é do dono, então ele não pode aprová-lo. O ruleset pede 0 aprovações, então isso não bloqueia;
  - o token não expira (`expires_in=none`).

## Comments

2026-10-21, implementer (Sonnet 5.5). Código, testes e docs prontos; Status continua `ready-for-agent` porque falta a execução na conta real.

- **Token:** passo `factory-token` (`factory.ts`), cliente `TokenClient` (`token.ts`, `GitHubTokenApi`, que substitui `machine.ts`). O link usa `URLSearchParams` (espaços viram `+`). Prefixo `github_pat_`, depois `GET /repos/{o}/{r}` com o token e `permissions.push`. `FACTORY_TOKEN` no ambiente é conferido igual e, se recusado, falha na hora (repetir o mesmo valor 3 vezes não ajuda).
- **`workflows` não dá para detectar.** A doc de GitHub (consultada em 2026-10-21, "Managing your personal access tokens" e "Permissions required for fine-grained personal access tokens") só tem o cabeçalho `X-Accepted-GitHub-Permissions`, que diz o que o endpoint exige e não o que o token tem; não existe endpoint nem cabeçalho que liste as permissões de um token fine-grained (o `X-OAuth-Scopes` é só do clássico). O wizard avisa, em vez de recusar.
- **Marcador:** `src/marker.ts` (`<!-- factory -->`, no fim do texto, uma vez só) aplicado nos adaptadores de escrita: GitHub (`comment`, `createIssue`, `commentPr`, `openDraftPr`, `updatePrBody` com e sem prints, `closePr`, `submitReview` e os inline, `replyToThread`), Markdown local, CodeHost local e os falsos. `test/marker.test.ts` percorre todos os caminhos de escrita do adaptador GitHub contra o servidor falso e exige o marcador em cada texto.
- **Filtros:** `openThreads` (thread aberta = último comentário sem marcador; todo comentário de quem tem `write`+, então o marcador forjado por não-writer nunca chega ao agente), `isFactoryComment` (agora assíncrono: marcador do tema + marcador geral + autor com `write`+), `claimPrFeedback` (`no-machine-user` e `machine-user` saem; ator vazio dá `no-actor`) e o `if` do job `wait` (por `contains` do marcador no comentário e no corpo da review). Um comentário humano com o marcador é ignorado: troca aceita, no ADR 0002.
- **Aviso:** comando `pnpm factory notify` e job `notify` (depois do `publish`) em `factory-issue.yml` e `factory-pr-feedback.yml`, com `GITHUB_TOKEN` e `issues: write`. `claim` grava `requester` (quem aplicou `ready-for-agent`, lido antes do lock) em `$GITHUB_OUTPUT`; no `pr-feedback` menciona `github.actor`. `factory-update-branches.yml` não avisa (nenhum humano a mencionar). Autorizado pelo usuário: edição dos workflows `factory-*.yml`.
- **Remoção:** `machine.ts`, passos `machine-user`/`machine-collaborator`, `FACTORY_MACHINE_USER` (wizard, doctor, destroy, config, workflows, testes), convite/aceite/`removeCollaborator`/`collaboratorPermission` do `GitHubClient`. O `destroy` continua apagando `FACTORY_TOKEN`. Um repo antigo pode manter a variável `FACTORY_MACHINE_USER`, sem efeito; o `destroy` não a apaga mais.
- **Desvio pequeno:** o ticket pede o filtro "comentário sem marcador conta só se o autor tem write+" também em conversa do PR (`issue_comment`); como antes, só as threads de review geram resposta (`no-open-threads` para o resto), então o filtro vale para elas.
- **Verificação:** só testes direcionados (os arquivos tocados e afetados), `typecheck` e `lint` do `@factory/harness`; o `factory:verify` completo fica com o orquestrador, então o último critério continua aberto.

Pending (human): rodar `pnpm bootstrap factory` na conta real: criar o token pelo link impresso (escolher "Only select repositories" → este repo), colar uma vez; depois, na `main`, marcar uma issue de teste `ready-for-agent` e conferir que o PR sai com o marcador oculto, que um comentário humano numa thread dispara a rodada, que o comentário da Factory não dispara, e que `github-actions[bot]` menciona quem aplicou a label.

Demonstração real (2026-10-21, conta do dono com o `FACTORY_TOKEN` do ticket 25):
- O `pnpm bootstrap factory` pediu o token uma vez pelo link pré-preenchido, avisou sobre `workflows` e passou no doctor. Ele ligou o `FACTORY_ENABLED`.
- O PR #15 foi aberto em nome do dono, e o CI e o preview rodaram sem aprovação.
- O marcador evitou o loop: o claim do pr-feedback deu `no-open-threads`.
- O aviso do `github-actions[bot]` notificou o dono.
