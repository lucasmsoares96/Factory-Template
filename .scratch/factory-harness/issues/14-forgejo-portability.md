# Portabilidade GitHub → Forgejo

Type: research
Status: resolved

## Question

O usuário quer que a Factory seja o mais simples possível de migrar do GitHub para outra forja, como o Forgejo. Para cada peça que a Factory usa no GitHub, o que existe hoje no Forgejo (e no Gitea, se for diferente)?

1. **Actions:** compatibilidade do Forgejo Actions com a sintaxe do GitHub Actions; eventos `issues: labeled`/`closed`, `pull_request`, `workflow_dispatch`; uso de actions de terceiros (`cloudflare/wrangler-action`, `neondatabase/create-branch-action`, `actions/checkout`); existência de runners hospedados (por exemplo no Codeberg) ou necessidade de runner próprio, e se ele tem Docker.
2. **Token automático:** comportamento do token automático do job (equivalente ao `GITHUB_TOKEN`) e se PRs/eventos criados com ele disparam outros workflows.
3. **Issues:** dependências nativas (blocked by/blocking) e a API para ler essas dependências; labels; sub-issues.
4. **Imagens no PR:** API de anexos (assets) em issues, PRs e comentários; formato de URL raw de arquivo num branch; renderização em repo privado.
5. **Identidade:** contas de bot/machine user e access tokens com escopo; CLI equivalente ao `gh` (`tea`, `fj`, ou só a REST API).

Conclua com a lista de operações de forja que a Factory precisa (a interface de um módulo adaptador) e, para cada uma, como ela é feita no GitHub e no Forgejo.

## Answer

- **Portável só para Forgejo próprio, com runner próprio com Docker.** O Codeberg está fora: os Termos de Uso (§ 2 (1) 7, desde 2026-06) proíbem projetos feitos majoritariamente por IA, e os runners hospedados têm teto de 10 min e só aceitam projeto público.
- **Workflows:** o YAML porta quase sem mudança. O Forgejo v16/v17 lê `.github/workflows/`, aceita `issues: labeled/closed`, `pull_request` e `workflow_dispatch`, preenche `github.event.label`, ignora `permissions:` e roda actions do github.com por URL completa (`node24`). A concorrência é "best-effort" e não tem `queue: max`.
- **Token automático:** nada criado com ele dispara workflow, nem em estado "approval-required". O PR da Factory exige uma identidade de usuário de máquina: no Forgejo ≥ v16, uma Authorized Integration via OIDC, sem segredo estático, ou um PAT restrito ao repo. Sem conta bot e sem App. O `workflow_dispatch` com o token automático parece funcionar pelo código, mas não está documentado.
- **Issues:** existem dependências nativas (`/dependencies`, `/blocks`), e o Forgejo impede fechar uma issue ou mergear um PR com bloqueador aberto. Não há `state_reason` nem sub-issues. Draft = prefixo `WIP:`. O lock é `POST /branches` (409).
- **Prints:** a API REST de anexos (`/issues/{index}/assets`, `/issues/comments/{id}/assets`) aceita o token automático, e o anexo herda a permissão do repo. O `fj` v0.7.0 **não** tem anexos (#709), nem saída JSON, nem token por variável de ambiente. Por isso o adaptador deve falar REST direto.
- **O que prende ao GitHub:** `claude-code-action`, `gh` (incluindo `--attach`), `state_reason`, `queue: max`, `POST /git/refs` e GitHub App. O ideal é isolar tudo isso num `ForgeAdapter` de cerca de 20 operações (tabela na pesquisa).

[pesquisa](../research/14-forgejo-portability.md)
