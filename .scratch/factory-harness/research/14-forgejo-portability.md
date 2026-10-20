# Pesquisa 14: portabilidade GitHub → Forgejo

Ticket: [14-forgejo-portability](../issues/14-forgejo-portability.md) · Pesquisado em 2026-10-17 · Só fontes primárias: docs `forgejo.org` (Docs v17.0), código do Forgejo na tag `v17.0.0` (`codeberg.org/forgejo/forgejo`, 2026-10-15), swagger da API (`templates/swagger/v1_json.tmpl` @ v17.0.0), docs e Termos de Uso do Codeberg, `codeberg.org/actions/meta`, `forgejo-contrib/forgejo-cli` (`fj`) v0.7.0, `gitea/tea` v0.16.0 e docs do Gitea. Quando a fonte não diz nada, este documento avisa. Quando a conclusão vem da leitura do código, e não da documentação, isso aparece como **(código)**.

Versões consultadas: Forgejo **v17.0.0** (2026-10-15), v16.0.6 e LTS v15.0.10 (ambas de 2026-10-12). Forgejo Runner **v13.2.0** (2026-09-18). `fj` **v0.7.0** (2026-10-16). `tea` **v0.16.0** (2026-09-10). O Codeberg roda build própria: `/api/v1/version` respondeu `16.0.0-dev-785-465b60ef+gitea-1.22.0` em 2026-10-17.

## Resposta

**Dá para portar, mas só para um Forgejo próprio (self-hosted) e com runner próprio com Docker. O Codeberg está fora.**
- Os Termos de Uso do Codeberg (§ 2 (1) 7, aprovados na assembleia de 2026, commit de 2026-06-29) proíbem "projects that mostly consist of code written by "generative AI"-tools (including services such as *Claude*, *OpenAI Codex*)". Isso é exatamente o que a Factory produz.
- Os runners hospedados do Codeberg têm teto de **10 min** por job, e só para projeto público e com licença livre.

**O formato dos workflows é quase todo portável. O que prende ao GitHub são as decisões já tomadas em volta deles:**
- O Forgejo lê `.github/workflows/` se não existir `.forgejo/workflows/` **(código)**.
- Ele aceita os eventos `issues: labeled/closed`, `pull_request` e `workflow_dispatch`, e preenche `github.event.label` **(código)**.
- Ele expõe `GITHUB_TOKEN` e o contexto `github` como aliases.
- Ele ignora `permissions:`.
- Ele roda actions JavaScript do github.com por URL completa. O runner aceita `node24`, que é o runtime de `cloudflare/wrangler-action@v4` e de `neondatabase/create-branch-action@v6`.

**O que não porta e precisa ficar atrás de um adaptador:**
1. **`claude-code-action` e o token da Claude GitHub App.** São só para GitHub. O motor via `claude -p` (ticket 02) é o caminho portável.
2. **Todas as chamadas `gh`.** O `fj` não cobre tudo (ver § fj CLI).
3. **`state_reason == completed`.** O Forgejo **não tem** `state_reason`, então um filtro copiado do GitHub descarta todos os fechamentos.
4. **O lock via `POST /git/refs`.** O Forgejo não tem esse endpoint. O equivalente é `POST /branches`, que responde 409 se o branch já existe.
5. **`concurrency.queue: max`.** Não existe no Forgejo, e lá a concorrência é "best-effort".
6. **PR em draft.** No Forgejo, draft = prefixo `WIP:` ou `[WIP]` no título.
7. **A identidade da Factory.** O Forgejo não tem GitHub App nem conta "bot". O equivalente é um usuário de máquina com uma **Authorized Integration** (OIDC do próprio Actions, sem segredo estático, Forgejo ≥ v16) ou um access token restrito ao repo.

**O token automático do Forgejo é mais restrito que o `GITHUB_TOKEN`.** Nenhuma mudança feita com ele dispara workflow: "no workflow will be triggered as a side effect of a change authored with this token". Não existe nem o estado "approval-required" do GitHub. Por isso o PR da Factory **tem** de sair com a identidade do usuário de máquina, nas duas forjas. O re-disparo do agendador via `workflow_dispatch` com o token automático **parece** funcionar, porque o caminho do dispatch não passa pelo filtro anti-recursão **(código)**. A doc não fala disso, então precisa de teste.

**Prints no PR ficam mais fáceis no Forgejo.** Existe API REST documentada de anexos (`POST /repos/{o}/{r}/issues/{index}/assets` e `.../issues/comments/{id}/assets`), que aceita qualquer token com escrita em issues, inclusive o token automático **(código)**. A imagem é servida em `/attachments/{uuid}` com checagem de permissão do repo, então em repo privado só quem tem acesso vê **(código)**. O branch órfão (decisão 04) também porta: só muda o template da URL (`/{o}/{r}/raw/commit/{sha}/{path}`).

**O que isso significa para o desenho da Factory:**
- **(a)** Toda operação de forja passa por um módulo `ForgeAdapter` em TypeScript, que fala **REST direto** (`fetch`) com as duas forjas. Ele não chama `gh` nem `fj`: nenhum dos dois CLIs cobre as duas forjas, e o `fj` não tem saída JSON, nem token por variável de ambiente, nem anexos.
- **(b)** O YAML dos workflows fica mínimo e sem lógica de forja. Ele só chama o script da Factory com `ISSUE`, `FORGE` e o token.
- **(c)** A regra "desbloqueada" passa a ser "todos os bloqueadores `closed`", e a verificação extra de "fechada por PR mergeado" fica dentro do adaptador.
- **(d)** A identidade é sempre "usuário de máquina" do ponto de vista do adaptador. No GitHub, um token de App. No Forgejo, um JWT de Authorized Integration ou um PAT.
- **(e)** Evitar: `claude-code-action`, `gh --attach` como caminho padrão, `queue: max` como garantia, GraphQL do GitHub e `issue_dependencies_summary`.

## Operação de forja → GitHub → Forgejo

Esta é a proposta de interface do módulo adaptador. As rotas do Forgejo têm o prefixo `/api/v1`. Todas as rotas do Forgejo foram conferidas no swagger e no `routers/api/v1/api.go` da tag v17.0.0.

| # | Operação do adaptador | GitHub | Forgejo (v17) |
|---|---|---|---|
| 1 | **Gatilho: issue ficou pronta** | `on: issues: types: [labeled]` + `github.event.label.name == 'ready-for-agent'` | Igual. `issues` aceita `labeled`, e o payload traz `label` (preenchido por label adicionada) **(código)**. Atenção: o padrão de `types` é `[opened, edited]` |
| 2 | **Gatilho: bloqueador fechado** | `on: issues: types: [closed]` + `state_reason == 'completed'` | `on: issues: types: [closed]`. **Não existe `state_reason`**: filtrar só por `state`, e no adaptador |
| 3 | **Despachar execução de uma issue** (`dispatchRun(issue)`) | `POST /repos/{o}/{r}/actions/workflows/{id}/dispatches` `{ref, inputs}` (`gh workflow run`). O `GITHUB_TOKEN` cria run (exceção documentada) | `POST /repos/{o}/{r}/actions/workflows/{arquivo}/dispatches` `{ref (obrigatório), inputs, return_run_info}`. O token automático tem escrita, e o dispatch não passa pelo filtro anti-recursão **(código, não documentado)** |
| 4 | **Ler issue** (`getIssue`: estado, labels) | `GET /repos/{o}/{r}/issues/{n}` | `GET /repos/{o}/{r}/issues/{index}` (sem `state_reason` e sem `issue_dependencies_summary`) |
| 5 | **Listar issues prontas** (varredura) | `GET /repos/{o}/{r}/issues?labels=ready-for-agent&state=open` | `GET /repos/{o}/{r}/issues?labels=ready-for-agent&state=open&type=issues` |
| 6 | **Listar bloqueadores** (`listBlockers`) | `GET .../issues/{n}/dependencies/blocked_by` | `GET .../issues/{index}/dependencies` ("all issues that block this issue") |
| 7 | **Listar bloqueadas** (`listBlocked`) | `GET .../issues/{n}/dependencies/blocking` | `GET .../issues/{index}/blocks` |
| 8 | **Regra "desbloqueada"** (`isUnblocked`) | todos `closed` **e** `state_reason == completed` | todos `closed`. O Forgejo **impede fechar** uma issue com bloqueador aberto e **impede o merge** de um PR com dependência aberta **(código)** |
| 9 | **Lock atômico** (`acquireLock(issue)`) | `POST /repos/{o}/{r}/git/refs` (falha se o ref existe) | `POST /repos/{o}/{r}/branches` `{new_branch_name, old_ref_name}` → **409** se já existe **(código)** |
| 10 | **Branch existe?** | `GET /repos/{o}/{r}/branches/{b}` | `GET /repos/{o}/{r}/branches/{branch}` |
| 11 | **Abrir PR** (`openPullRequest`, corpo com `Closes #N`) | `POST /repos/{o}/{r}/pulls` | `POST /repos/{o}/{r}/pulls` `{head, base, title, body, labels…}`. Palavras-chave de fechamento: close/closes/closed, fix…, resolve… |
| 12 | **Marcar PR como draft** (Escalation) | `draft: true` na criação, ou GraphQL `convertPullRequestToDraft` | Sem campo de escrita: título com prefixo `WIP:` ou `[WIP]` (`PATCH /pulls/{index}` `{title}`). O `draft` só aparece na leitura **(código)** |
| 13 | **Comentar** na issue ou no PR | `POST /repos/{o}/{r}/issues/{n}/comments` | `POST /repos/{o}/{r}/issues/{index}/comments` |
| 14 | **Editar o comentário de evidências** | `PATCH /repos/{o}/{r}/issues/comments/{id}` | `PATCH /repos/{o}/{r}/issues/comments/{id}` |
| 15 | **Adicionar ou remover label** | `POST .../issues/{n}/labels` `{labels:[nomes]}`; `DELETE .../labels/{nome}` | `POST .../issues/{index}/labels` `{labels:[ids ou nomes]}`; `DELETE .../labels/{identifier}` |
| 16 | **Publicar imagem de evidência** (`uploadEvidence`) | Sem REST documentado. Branch órfão + `../blob/{sha}/{path}?raw=true`, ou `gh … --attach` (só token de usuário) | `POST .../issues/{index}/assets` ou `.../issues/comments/{id}/assets` (multipart `attachment`) → `browser_download_url` = `{AppURL}attachments/{uuid}`. Ou branch órfão + `/{o}/{r}/raw/commit/{sha}/{path}` |
| 17 | **Ler estado de CI do PR** (opcional, para Review) | checks/statuses | `GET /repos/{o}/{r}/commits/{ref}/status` (combinado), `.../statuses` |
| 18 | **Branch padrão** | `GET /repos/{o}/{r}` → `default_branch` | `GET /repos/{o}/{r}` → `default_branch` |
| 19 | **Credencial "de máquina"** (`machineToken()`) | Token de instalação de GitHub App (Claude App ou App própria) ou PAT | JWT de **Authorized Integration** (OIDC do Actions, ≥ v16, age como o usuário dono) ou access token restrito ao repo (`write:repository` + `write:issue`) de um usuário de máquina |
| 20 | **Token "do job"** (`jobToken()`) | `GITHUB_TOKEN` (eventos não disparam workflows, exceto dispatch; PR fica em "approval-required") | `FORGEJO_TOKEN`/`GITHUB_TOKEN`: escrita em todas as unidades do próprio repo (exceto PR de fork), 404 em outros repos, **nenhum** evento dispara workflow |

## Achados detalhados

### 1. Actions

**A1. Compatibilidade declarada: "familiaridade, não compatibilidade".** O Forgejo Actions "is not designed to be compatible" com o GitHub Actions, e "Workflows should work with some minimal changes". Diferenças listadas na página:
- a imagem padrão do runner é Debian bookworm só com Node.js;
- faltam chaves do contexto `github` (a página não diz quais);
- `permissions` e `continue-on-error` no job são ignorados;
- OIDC usa `enable-openid-connect`, e não `permissions: id-token: write`.

A página avisa "This list may be incomplete".
Fonte: [Forgejo Actions | GitHub Actions](https://forgejo.org/docs/latest/user/actions/github-actions/) (Docs v17.0).

**A2. Eventos suportados (Docs v17.0):** `push`, `issues`, `issue_comment`, `pull_request`, `pull_request_target`, `release`, `schedule`, `workflow_call` e `workflow_dispatch`.
- `issues` aceita `opened`, `reopened`, `closed`, `labeled`, `unlabeled`, `assigned`, `unassigned` e `edited`. O padrão é `[opened, edited]`.
- `pull_request` aceita também `synchronize`. O padrão é `[opened, synchronize, reopened]`.
- `workflow_dispatch` pode ser disparado pela UI ou por `POST /repos/{owner}/{repo}/actions/workflows/{workflowname}/dispatches`, com inputs `choice`, `boolean`, `number` e `string`.
- `schedule` roda só a partir da branch padrão. Aceita `timezone:`, e no horário de verão pula ou repete execuções.
- O contexto `github` é alias de `forgejo` (e de `forge`). Cada `FORGEJO_*` tem um `GITHUB_*` equivalente.

Fonte: [Forgejo Actions | Reference](https://forgejo.org/docs/latest/user/actions/reference/).

**A3. `github.event.label` é preenchido em `labeled` (código).**
- `IssuePayload` tem `Label *Label` (`modules/structs/hook.go`).
- `actionsNotifier.IssueChangeLabels` emite um evento **por label adicionada**, com `apiLabel` preenchido (`services/actions/notifier.go`).
- `label_updated` é mapeado para `labeled` (`modules/actions/workflows.go`).

O filtro da pesquisa 03 (`github.event.label.name == 'ready-for-agent'`) porta sem mudança.
Fonte: código @ v17.0.0.

**A4. Diretório de workflows (código).** O `ListWorkflows` procura `.forgejo/workflows`, depois `.gitea/workflows`, depois `.github/workflows`, e usa **o primeiro que encontrar**. Um template que só tenha `.github/workflows/` roda no Forgejo. Se um dia existir `.forgejo/workflows/`, o `.github/` passa a ser ignorado. Fonte: `modules/actions/workflows.go` @ v17.0.0.

**A5. Concorrência.**
- Existem `concurrency.group` e `cancel-in-progress`, também em `jobs.<id>.concurrency`. Os grupos não diferenciam maiúsculas de minúsculas.
- Com `cancel-in-progress: false`, as execuções entram em fila, mas "exact sequential ordering is not guaranteed". A aplicação é "**best-effort**".
- Não existe `queue: max`.
- Sem `concurrency` explícito, `push` e `pull_request` (synchronize) cancelam execuções antigas do mesmo workflow.

A seção existe nas docs v15.0, v16.0 e v17.0.
Fonte: [Reference § concurrency](https://forgejo.org/docs/latest/user/actions/reference/).

**A6. Resolução de `uses:` e actions de terceiros.**
- Nome curto (`actions/checkout@v7`) recebe o prefixo `DEFAULT_ACTIONS_URL`, que por padrão é `https://data.forgejo.org`. O admin pode mudar isso, então a doc diz "it is strongly recommended to choose fully qualified URLs".
- O `data.forgejo.org/actions` espelha `cache`, `checkout`, `download-artifact`, `upload-artifact`, `setup-node`, `setup-python`, `setup-go` e outras (API `orgs/actions/repos`, 2026-10-17). `checkout` é mirror de `github.com/actions/checkout`.
- Actions de outro host usam URL completa. Exemplo: `uses: https://github.com/cloudflare/wrangler-action@v4.1.3`.
- Actions JavaScript exigem Node na imagem do job: "NodeJS will *not* automatically be installed".
- O runner v13.2.0 aceita `node12`, `node16`, `node20` e `node24` (`act/model/action.go`).
- `cloudflare/wrangler-action` v4.1.3 (2026-09-24) e `neondatabase/create-branch-action` v6.3.1 usam `node24`, e o `action.yml` de nenhuma delas pede token do GitHub.

Fontes: [Using Actions](https://forgejo.org/docs/latest/user/actions/actions/); [Reference § uses](https://forgejo.org/docs/latest/user/actions/reference/); `code.forgejo.org/forgejo/runner` v13.2.0; `action.yml` dos dois repos no GitHub.

**A7. Artifacts e cache.**
- Artifacts: "you must use v3 or patched v4" de upload/download-artifact. Não há acesso entre execuções. Expiram em 90 dias por padrão.
- **Contradição:** o mirror `data.forgejo.org/actions/upload-artifact` publica tags `v7.0.x`, e a doc não diz se a v7 funciona.
- Cache: não há garantia de população, e a imagem precisa de `zstd`.
- Services: só no backend `docker`, não no `lxc`.

Fonte: [Advanced features](https://forgejo.org/docs/latest/user/actions/advanced-features/).

**A8. Runners hospedados do Codeberg: inviáveis para a Factory.**
- A doc do Codeberg diz "we are currently providing hosted Actions in limited fashion" e sugere Woodpecker para CI hospedado.
- Labels e limites do `actions/meta` (README de 2026-10-06):

  | Label | CPU | RAM | Tempo máximo |
  |---|---|---|---|
  | `codeberg-tiny` | 1 | 2G | 2 min |
  | `codeberg-small` | 2 | 4G | 5 min |
  | `codeberg-medium` | 4 | 8G | 10 min |

  As variantes `-lazy` buscam concluir "within 24 hours".
- A imagem é `ghcr.io/catthehacker/ubuntu:act-latest`.
- "running the Docker daemon inside those runners is not officially supported", mas podman funciona.
- Exigência: "project must be **public (and available under a free/libre license**".

Um Stage da Factory leva de minutos a horas, então só serve runner próprio.
Fontes: [docs.codeberg.org/ci/actions](https://docs.codeberg.org/ci/actions/); [codeberg.org/actions/meta](https://codeberg.org/actions/meta).

**A9. Codeberg proíbe projeto majoritariamente gerado por IA.** Os Termos de Uso, § 2 (1) 7, dizem: "You must not share projects that mostly consist of code written by "generative AI"-tools (including services such as *Claude*, *OpenAI Codex*)". A cláusula entrou pelo commit `96fac426a3` ("Proposal Assembly 2026: prohibit LLM-extrusions", 2026-06-29), e a última mudança no arquivo é de 2026-07-21. Repos privados só são permitidos "for things required for FLOSS projects". **Consequência:** "migrar para o Forgejo" significa uma instância própria (ou outro host Forgejo comercial, não pesquisado aqui), não o Codeberg. Fonte: [Codeberg TermsOfUse.md](https://codeberg.org/Codeberg/org/src/branch/main/TermsOfUse.md).

**A10. Runner próprio com Docker.** Opções documentadas para dar Docker aos jobs:
- DinD, com container `docker:dind` separado e `DOCKER_HOST`;
- `docker_host: automount`, que monta o socket do host;
- jobs LXC que instalam Docker;
- runner dentro de uma VM.

Avisos da doc: o automount "provides no security isolation", e DinD com capacidade > 1 deixa jobs se enxergarem.

Para a Factory, o Postgres em container (pesquisa 08) via `services:` exige o backend `docker`. Recomendação: runner com backend docker, capacidade 1 por VM ou DinD por runner.
Fonte: [Utilizing Docker within Actions](https://forgejo.org/docs/latest/admin/actions/docker-access/).

### 2. Token automático

**T1. Escopo e permissões.**
- "It can be used to read the repositories associated with the workflow, even when they are private".
- "This token also has write permission to the repository and can be used to push commits", e também serve para "creating a label or merge a pull request".
- "any attempt to use it on other repositories … will return a 404 error".
- Em PR de fork, o token não tem escrita.
- Ele "is automatically destroyed when the workflow finishes".
- Para mais permissões: "using an Authorized Integration is recommended".

No código, `GetActionRepoPermission` dá `AccessModeWrite` em **todas as unidades** do próprio repo, ou `Read` em PR de fork. O `permissions:` do YAML é ignorado (A1).
Fontes: [Basic concepts § Automatic token](https://forgejo.org/docs/latest/user/actions/basic-concepts/); [Security](https://forgejo.org/docs/latest/user/actions/security/); `models/perm/access/repo_permission.go` @ v17.0.0.

**T2. Nada criado com o token dispara workflow.**
- A doc diz: "no workflow will be triggered as a side effect of a change authored with this token… if a branch is pushed… it will not fire".
- No código, `Notify` retorna cedo quando `input.Doer.IsActions()`, com o comentário "avoiding triggering cyclically". O usuário é `forgejo-actions`, id `-2`.
- Diferente do GitHub de 2026, não há estado "approval-required" para PR: o PR criado com o token **simplesmente não roda CI nem preview**.

Fontes: Basic concepts; `services/actions/notifier_helper.go` @ v17.0.0 (linhas 135–151); `models/user/user_system.go`.

**T3. `workflow_dispatch` com o token automático: provavelmente funciona (código, não documentado).**
- A rota `POST …/dispatches` exige `reqToken()` + `reqRepoWriter(unit.TypeActions)` (`routers/api/v1/api.go`).
- O token automático tem escrita (T1).
- `Workflow.Dispatch` (`services/actions/workflows.go`) insere a execução direto, com `TriggerUser = doer`, **sem** passar por `Notify` e, portanto, sem o filtro `IsActions()`.

A doc é omissa. Testar antes de adotar. Se não funcionar, o agendador usa a credencial de máquina (linha 19 da tabela).

### 3. Issues

**I1. Dependências nativas existem, com a API completa.**
- `GET|POST|DELETE /repos/{o}/{r}/issues/{index}/dependencies` ("List an issue's dependencies, i.e all issues that block this issue").
- `GET|POST|DELETE …/issues/{index}/blocks` ("List issues that are blocked by this issue").
- O body de escrita é `IssueMeta {owner, repo, index}`. É o **número**, não o id como no GitHub.
- Paginação por `page`/`limit`, com teto em `API.MaxResponseItems`.
- O recurso precisa estar habilitado no repo (`IsDependenciesEnabled`, senão 404). Dependência entre repos depende de `ALLOW_CROSS_REPOSITORY_DEPENDENCIES`.

Fontes: swagger v17.0.0; `routers/api/v1/repo/issue_dependency.go`.

**I2. O Forgejo faz cumprir a dependência (código).**
- Fechar uma issue com bloqueador aberto falha com `ErrDependenciesLeft` (`models/issues/issue_update.go`). A API responde 412 "cannot close this pull request because it still has open dependencies".
- Um PR com dependência aberta não é mergeável (`services/pull/check.go`: "is blocked by an open dependency").
- No merge, se o fechamento automático de uma issue referenciada esbarrar em `ErrDependenciesLeft`, o erro é engolido ("Allow ErrDependenciesLeft", `services/pull/merge.go`). O merge passa e a issue continua aberta.

Isso é mais forte que o GitHub: a Factory nunca verá um bloqueador "fechado com dependências abertas".

**I3. Sem `state_reason` e sem summary.** O schema `Issue` v17 tem `state`, `closed_at`, `labels`, `pull_request`, `assets` etc., mas não tem `state_reason` nem `issue_dependencies_summary`. Também não há "closed as not planned". Fonte: swagger v17.0.0 (`definitions.Issue`).

**I4. Labels.** CRUD completo. `IssueLabelsOption.labels` aceita "a list of integers representing label IDs or a list of strings representing label names". O Forgejo tem labels exclusivas (escopo `a/b`), e o `fj` teve bug com elas (#567, fechado). Fonte: swagger v17.0.0.

**I5. Sub-issues: não existem.** Não há rota de sub-issue no swagger v17.0.0. A Factory hoje não usa sub-issues, então isso não bloqueia nada.

**I6. Fechamento por palavra-chave.** As palavras-chave são "close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved", e o admin pode customizar a lista. Se a referência está na descrição do PR, a issue muda de estado "only if the merger of the pull request has permissions to do so". A página **não diz** se só vale para merge na branch padrão (o GitHub diz que só vale nela). Fonte: [Linked references](https://forgejo.org/docs/latest/user/linked-references/).

**I7. PR em draft = WIP.** O padrão é `WorkInProgressPrefixes: ["WIP:", "[WIP]"]` (`modules/setting/repository.go`). `CreatePullRequestOption` não tem `draft`, e `PullRequest.draft` só aparece na leitura. A doc de PRs não trata de WIP. Fontes: swagger v17.0.0; código.

### 4. Imagens no PR

**M1. API REST de anexos (documentada no swagger).**
- `POST /repos/{o}/{r}/issues/{index}/assets` e `POST /repos/{o}/{r}/issues/comments/{id}/assets`: multipart `attachment`, mais `name` e `updated_at` opcionais. Também há `GET`, `PATCH` e `DELETE`.
- PR é issue, então vale para PR também.
- A resposta `Attachment` tem `browser_download_url`, que é `{AppURL}attachments/{uuid}` (`models/repo/attachment.go`).
- Permissão: para issue, poster, admin ou `CanWriteIssuesOrPulls`. Para comentário, autor do comentário ou quem tem escrita **(código)**. O token automático tem escrita (T1), então pode subir anexos **(código)**.
- Padrões da instância: `ALLOWED_TYPES` inclui `.png`, `.jpg`, `.webp`, `.gif`, `.svg`, `.mp4`, `.webm`; `MAX_SIZE = 2048` (MB); `MAX_FILES = 5` (`modules/setting/attachment.go`).

Fontes: swagger v17.0.0; `routers/api/v1/repo/issue_attachment.go`, `issue_comment_attachment.go`.

**M2. Renderização em repo privado (código).**
- `ServeAttachment` resolve o repo ligado ao anexo e checa `GetUserRepoPermission` do visitante.
- Se o anexo não estiver ligado a nada, só o próprio uploader enxerga.
- Com token de escopo, exige `read:issue`.

Logo, `![x](https://forja/attachments/{uuid})` no corpo renderiza para quem tem acesso ao repo, já que é a mesma origem e o cookie de sessão vai junto. Para os outros, dá 404. O Camo existe, mas é opcional (`[camo] ENABLED`).
**Lacuna:** não houve teste empírico, e não há doc de usuário sobre anexos via API.
Fonte: `routers/web/repo/attachment.go` @ v17.0.0.

**M3. URL raw de arquivo num branch.** As rotas web são `/{o}/{r}/raw/branch/{branch}/{path}`, `/raw/tag/…`, `/raw/commit/{sha}/{path}` e `/raw/blob/{sha}`. Todas exigem leitura de código (`reqRepoCodeReader`), então em repo privado só renderizam para quem tem acesso. `/media/…` resolve LFS. Na API, a rota é `GET /repos/{o}/{r}/raw/{filepath}?ref=`. O branch órfão da decisão 04 porta trocando `../blob/{sha}/{path}?raw=true` por `/{o}/{r}/raw/commit/{sha}/{path}`. Fonte: `routers/web/web.go` @ v17.0.0 (grupo `/raw`); swagger.

### 5. Identidade

**ID1. Não há GitHub App nem conta "bot".**
- O código tem o tipo bot, mas não há como marcar uma conta assim pela UI ou pela API. Pedidos abertos: [#8136](https://codeberg.org/forgejo/forgejo/issues/8136) (desde 2025-06-10) e [#9707](https://codeberg.org/forgejo/forgejo/issues/9707) (desde 2025-10-16).
- O caminho documentado é um usuário comum (eventualmente `--restricted`) com token: `forgejo admin user create … --access-token` ([Command-line](https://forgejo.org/docs/latest/admin/command-line/)).

**ID2. Access tokens com escopo e tokens restritos a repositórios.**
- Escopos `read:`/`write:` para `activitypub`, `admin`, `issue`, `misc`, `notification`, `organization`, `package`, `repository` e `user`.
- `issue` cobre `issues/*`, `labels/*` e `milestones/*`. `repository` cobre `/repos/*`, exceto issues.
- Tokens "Specific repositories" aceitam só `read/write:repository` e `read/write:issue`, e não fazem operações administrativas.
- A API aceita `repositories: [{owner, name}]` em `CreateAccessTokenOption`.
- A doc não fala de expiração de token.
- Presente desde as docs v15.0.

Fonte: [Access token scope](https://forgejo.org/docs/latest/user/token-scope/); swagger.

**ID3. Authorized Integrations (≥ v16.0): o análogo do GitHub App e do WIF.**
- A requisição é autenticada por um JWT externo, e elas "do not use any static long-lived credentials". A doc as prefere a access tokens.
- Tipo **Forgejo Actions (Local)**: um workflow do mesmo servidor ganha acesso. Restrições possíveis por repo de origem, arquivo de workflow, ref e evento.
- Tipo **Generic JWT**: para GitHub Actions, GitLab, AWS e outros.
- No workflow: `enable-openid-connect: true`, depois `curl -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=…"`, depois `Authorization: Bearer <JWT>` na API e no git.
- O JWT vale 1 h por padrão (`[actions].ID_TOKEN_EXPIRATION_TIME`).
- "The request will be authenticated as the user who owns the Authorized Integration". As permissões são as mesmas dos access tokens.
- Como o doer é um usuário real, as mudanças **disparam** workflows **(código: `Notify` só filtra `IsActions()`)**. A doc é omissa nesse ponto.
- OIDC fica desligado em PR de fork.
- A página existe nas docs v16.0 e v17.0 e não existe na v15.0. `services/auth/authorized_integration.go` existe na tag v16.0.0 e não na v15.0.0.

Fontes: [Authorized Integrations](https://forgejo.org/docs/latest/user/api/authorized-integrations/); [Security OpenID Connect](https://forgejo.org/docs/latest/user/actions/security-openid-connect/).

**ID4. Aprovação de PR.** Pedem aprovação os PRs de autores só com leitura vindos de fork ou AGit. "Collaborators with write access" não precisam. Um usuário de máquina colaborador com escrita num branch do próprio repo não fica preso à aprovação. Fonte: [Security of Pull Requests](https://forgejo.org/docs/latest/user/actions/security-pull-request/).

### 6. fj CLI (forgejo-cli)

Repo: `codeberg.org/forgejo-contrib/forgejo-cli` (antes `Cyborus/forgejo-cli`). Versão analisada: **v0.7.0** (tag e crates.io, 2026-10-16). Fonte: código em `src/*.rs` @ v0.7.0, README e issues.

**F1. Anexos: não existem.**
- Não há comando nem flag para subir imagem em issue, PR ou comentário. Busca por `attach|asset|upload` em `src/` @ v0.7.0: o único uso é `fj issue view`, que *conta* os anexos de um comentário.
- Pedido aberto: [#709 "Feat: Support attaching images to Issue & PR"](https://codeberg.org/forgejo-contrib/forgejo-cli/issues/709) (2026-09-27, `Kind/Feature`, sem resposta). O pedido descreve exatamente o caso de agentes de IA anexando prints.
- Não há equivalente ao `gh pr comment --attach`. O caminho é a API REST (M1) ou o branch órfão (M3).

**F2. Cobertura das operações que a Factory precisa:**

| Operação | Comando `fj` v0.7.0 | Observação |
|---|---|---|
| Ver issue | `fj issue view <N>` (`body`, `comments`, `comment <idx>`, `assignees`) | Saída para humanos (`--style fancy|minimal`), **sem JSON** |
| Buscar issues por label | `fj issue search --labels ready-for-agent --state open` | Sem JSON |
| Comentar | `fj issue comment <N> [body] [--body-file]`; `fj pr comment [<N>] [body] [--body-file]` | — |
| Editar comentário | `fj issue edit <N> comment <idx> [new_body]` (também em `pr edit`) | Pelo **índice** do comentário na issue, não pelo id |
| Labels | `fj issue edit <N> labels --add X --rm Y` (também em `pr edit`) | — |
| Dependências | `fj issue depend list|add|remove <N> [alvos]`; `fj issue block …`; `fj pr depend …` | `list` imprime lista humana, sem estado em formato de máquina |
| Criar PR | `fj pr create [title] --base B --head H --body/--body-file [--autofill] [--agit]` | Sem `--draft`; o `fj` só *mostra* draft se o título começa com `WIP:` |
| Disparar workflow | `fj actions dispatch <workflow> <ref> -I chave=valor` | — |
| Merge | `fj pr merge` | A Factory não usa (Merge Gate) |

**F3. Autenticação.**
- `fj [-H host] auth add-token [token]` (alias `add-key`) grava `LoginInfo::Application { token }` em `keys.json`, no diretório de dados do usuário (`keys.rs`).
- Também há login OAuth interativo.
- **Não há variável de ambiente para o token.** A única variável lida é `FJ_FALLBACK_HOST`, para o host.
- Em CI, funciona sem interação passando o token como argumento: `fj -H https://forja auth add-token "$TOKEN"`. Isso grava o token em disco no runner e o expõe na linha de comando do processo.
- O host vem de `-H` ou do remote git do checkout.

**F4. Instalação no runner.**
- Binários pré-compilados para Linux GNU `x86_64` e `aarch64` (e Windows x86_64) nas releases: `forgejo-cli-x86_64-linux.tar.gz`. Também via `cargo install forgejo-cli`.
- Risco: [#664](https://codeberg.org/forgejo-contrib/forgejo-cli/issues/664) (aberta) relata que o binário exige `GLIBC_2.38`/`2.39` e não roda no Pop!_OS 22.04.
- Inferência, não verificada aqui: a imagem padrão Debian bookworm do runner (A1) e Ubuntu 22.04 têm glibc mais antiga, então o binário oficial pode falhar nelas. Nesse caso, compilar com `cargo` ou usar imagem mais nova.

**F5. Comparação com o `tea` v0.16.0 (Gitea).**
- O `tea` aceita login por variável de ambiente (`GITEA_TOKEN` + `GITEA_INSTANCE_URL`, `modules/context/context_login.go`).
- Tem `tea api <endpoint>`, um cliente REST autenticado no estilo `gh api`.
- Tem `tea actions … workflows` e `assets` só para **releases** (`cmd/attachments.go`: "Manage release assets").
- Mira a API do Gitea. O Forgejo divergiu dela (o próprio Forgejo se identifica como `+gitea-1.22.0`), e as docs não garantem compatibilidade com o Forgejo.

**Conclusão sobre CLIs:** nenhum CLI do Forgejo substitui o `gh` nas operações da Factory, porque falta saída JSON (`fj`), anexo de issue (os dois) e garantia de compatibilidade (`tea`). O adaptador deve falar REST.

### 7. Gitea (onde difere)

- Docs atuais do Gitea (menu com `28.1.0` e `1.27.3`, edição em `version-28`): `permissions:` **são suportadas** e "control the `GITEA_TOKEN` permissions". `uses:` sem host baixa de `https://github.com` por padrão (o Forgejo usa `data.forgejo.org`). Existem os prefixos `self:`, `builtin:` e `$/`.
- A página não diz se o `GITEA_TOKEN` dispara workflows.
- Não pesquisei Authorized Integrations nem anexos no Gitea. As dependências de issue são herança comum.

Fonte: [Gitea: Compared to GitHub Actions](https://docs.gitea.com/usage/actions/comparison).

## Riscos em aberto

- **R1 (doc omissa, conclusão pelo código): `workflow_dispatch` com o token automático (T3).** Testar numa instância v16 ou v17. Se falhar, o agendador usa a credencial de máquina.
- **R2 (doc omissa): mudanças via Authorized Integration ou PAT disparam workflows?** O código diz que sim (só `forgejo-actions` é filtrado), mas não há doc. Isso é crítico, porque o PR da Factory precisa rodar CI e preview.
- **R3 (contradição): artifacts.** A doc exige "v3 or patched v4", mas o mirror publica `upload-artifact` v7. O preview e os prints não dependem de artifacts (decisão 04), mas o relatório do Playwright sim.
- **R4: `state_reason` ausente.** O filtro `state_reason == 'completed'` da pesquisa 03, copiado para o Forgejo, descarta **todo** fechamento. A regra deve ficar no adaptador. Distinguir "fechada à mão" de "fechada por PR mergeado" no Forgejo exige consultar `/issues/{index}/timeline`. Não pesquisei o formato do evento de fechamento por PR.
- **R5: concorrência best-effort e sem `queue: max`.** O lock por branch (`POST /branches` → 409) passa a ser a garantia principal, não um reforço.
- **R6: palavras-chave de fechamento fora da branch padrão.** A doc do Forgejo não restringe à branch padrão (a do GitHub restringe). Se a Factory abrir PR contra outra base, issues podem fechar no merge intermediário. Não verificado no código.
- **R7: v17.0.0 com alerta.** A release v17.0.0 diz: "We currently advise against upgrading to Forgejo 17.0.0. An issue … prevents pushing, merging, or other code operations in some cases". Mirar a v16.0.x ou a LTS v15.0.x. Mas Authorized Integrations exigem ≥ v16.
- **R8: hospedagem.** O Codeberg está fora (A8, A9). Não pesquisei outros hosts Forgejo comerciais nem os termos deles sobre código gerado por IA.
- **R9: renderização de anexos e raw em repo privado.** Conclusão só pelo código (M2, M3). Falta teste, inclusive de clientes de e-mail, que não têm sessão.
- **R10: `fj` em CI.** Não tem token por variável de ambiente, não tem JSON, pode ter incompatibilidade de glibc (F3, F4) e não tem anexos (#709). Não usar como base do adaptador.
- **R11: lock-in já decidido.** A pesquisa 03 e a decisão do motor citam `claude-code-action` com o token da Claude App, `allowed_bots`, `gh` e `queue: max`. Tudo isso é exclusivo do GitHub. Se o motor for `claude -p` (ticket 02) e as chamadas de forja estiverem no adaptador, a migração fica em: trocar `ForgeAdapter`, ajustar `runs-on`/`uses:` com URL completa e configurar a identidade.
