# 25: A Factory usa um token do dono do repo, sem machine user

Spec: [../spec.md](../spec.md)

**What to build:** o módulo Factory deixa de exigir uma segunda conta no GitHub. O `FACTORY_TOKEN` passa a ser um token fine-grained do próprio dono, restrito a este repo, colado uma vez no `pnpm bootstrap factory`. Como a Factory agora escreve com a identidade do dono, ela se reconhece por um marcador oculto no texto, e não mais pelo autor. O aviso de que o PR está pronto sai pelo `GITHUB_TOKEN`, porque o GitHub não notifica ninguém das próprias ações.

Decisão do usuário (2026-10-21):
- **Machine user rejeitado:** criar outra conta à mão é um fluxo ruim.
- **GitHub App rejeitado:** o Forgejo não tem.
- **`GITHUB_TOKEN` + botão "Criar PR" (como o `claude-code-action`) rejeitado:** commits da Factory num PR aberto não disparariam o CI.

**Blocked by:** 16, 17, 18

**Status:** ready-for-agent

## Acceptance criteria

- [ ] **Token no `pnpm bootstrap factory`.** É um único prompt, com o token oculto. O wizard imprime **um** link pré-preenchido:
  ```text
  https://github.com/settings/personal-access-tokens/new?name=Factory+<repo>&description=<...>&target_name=<owner>&expires_in=none&contents=write&pull_requests=write&issues=write
  ```
  - O link vai sem `workflows`. Antes do link, o wizard diz que o único passo manual é escolher "Only select repositories" → este repo.
  - O token é conferido antes de ser gravado em `FACTORY_TOKEN`:
    - **prefixo:** aceita só `github_pat_` e recusa o clássico `ghp_` e os demais;
    - **acesso:** `GET /repos/{o}/{r}` com o token responde com `permissions.push`;
    - **workflows:** o token não tem permissão de `workflows`, se a API permitir saber. Se não der para saber, o wizard avisa.
  - São três tentativas, e nada é gravado de um token recusado. `FACTORY_TOKEN` no ambiente ou já como secret evita o prompt, pela regra de nunca perguntar duas vezes.
- [ ] **Machine user removido de vez:**
  - os passos `machine-user` e `machine-collaborator`, o `machine.ts`, o convite e o aceite;
  - a variável `FACTORY_MACHINE_USER` no wizard, no `doctor`, no `destroy`, no `config.ts`, nos workflows e nos testes;
  - a conferência por `X-OAuth-Scopes`.

  O `destroy` continua apagando o `FACTORY_TOKEN`.
- [ ] **Marcador da Factory.** Todo texto que a Factory escreve com o `FACTORY_TOKEN` leva o marcador oculto `<!-- factory -->`: corpo do PR, comentários, review, respostas em thread e comentário da Triage. O marcador é posto num lugar só, nos adaptadores de escrita, e não em cada chamador. Um teste prova que nenhum caminho de escrita sai sem ele.
- [ ] **Filtros por marcador, não por autor:**
  - **comentários do PR** (`factory-pr-feedback.yml` e `pr-threads.ts`): um comentário com o marcador é da Factory e nunca a dispara. Um comentário sem marcador conta só se o autor tem `write`+;
  - **comentário da Triage:** é confiável se tem o marcador **e** o autor tem `write`+. Quem tem `write` já poderia aplicar as labels, então forjar o marcador não dá poder novo;
  - **troca aceita e documentada:** um comentário humano que contenha o marcador é ignorado;
  - **`pr-claim`:** deixa de recusar por machine user vazio.
- [ ] **Aviso do Merge Gate.** Quando o `publish` abre ou atualiza o PR, ou termina em Escalation, um comentário curto na issue sai pelo `GITHUB_TOKEN` do job. Ele aparece como `github-actions[bot]`, menciona quem aplicou `ready-for-agent` e leva o link do PR. Com o `GITHUB_TOKEN`, o comentário não dispara workflows. Fica coberto por um teste de YAML e por um teste do adaptador.
- [ ] **Testes contra os falsos:**
  - **loop:** um comentário escrito pelo adaptador não dispara o `pr-feedback`;
  - **marcador forjado:** um não-writer com o marcador é ignorado;
  - **comentário humano:** um writer sem marcador dispara o `pr-feedback`;
  - **token:** um token `ghp_` é recusado, e um token sem `push` também;
  - **fluxo do wizard:** a execução repetida não pergunta nada, e o link aparece uma vez.
- [ ] **Spec e docs atualizados:**
  - na spec: histórias 8 e 16 e as seções de guard, de comentários no PR e da parte comum;
  - nos tickets 16, 17 e 18: nota "substituído pelo 25" nos trechos do machine user;
  - no ticket 22: a nota sobre o Forgejo, abaixo;
  - no `.factory/AGENTS.md` e no `GLOSSARY.md`, se citarem o machine user;
  - em `docs/adr/`: um ADR curto com a decisão e as alternativas rejeitadas.
- [ ] `pnpm factory:verify` verde.

## Notes

- **Docs consultados em 2026-10-21:**
  - **GitHub:** "Pre-filling fine-grained personal access token details using URL parameters", em [Managing your PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). Os parâmetros são `name`, `description`, `target_name`, `expires_in` (1–366 ou `none`) e `<permission>=read|write`. Não há parâmetro para escolher repos. O `metadata: read` entra sozinho.
  - **Forgejo:** a v15, LTS até 2027-07-15, tem tokens restritos a repos específicos, só com `read/write:repository` e `read/write:issue` ([token scope](https://forgejo.org/docs/v15.0/user/authentication/token-scope/)).
- **No Forgejo não existe escopo `workflow`.** Um token com `write:repository` consegue alterar `.forgejo/workflows/`. Lá, a única defesa é a recusa de caminhos protegidos antes do `publish` (Escalation `protected-paths`), e o token nunca vai para o job `work`. Isso vai para o ticket 22.
- **Perdas aceitas:**
  - o histórico do repo não separa a Factory do dono;
  - o PR é do dono, então ele não pode aprová-lo. O ruleset pede 0 aprovações, então isso não bloqueia;
  - o token não expira (`expires_in=none`).
