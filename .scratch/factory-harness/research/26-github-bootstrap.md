# 26 — Bootstrap do template: fatos do GitHub (template, machine user, Actions, GHCR, `gh`) e auth do Claude

Ticket: [26-template-bootstrap](../issues/26-template-bootstrap.md)
Pesquisado em: 2026-10-18. Complementa e reverifica [26-template-bootstrap.md](26-template-bootstrap.md) (§1, §2, §6, §7 e §8 de lá), e acrescenta GHCR, settings do Actions, escopos por ação e idempotência dos comandos `gh`.

Fontes e versões:

- **GitHub Docs**: lidos pela fonte (`github/docs`, branch `main`) em 2026-10-18, com o link da página publicada em `docs.github.com`. A data entre parênteses em cada seção é a do último commit do arquivo-fonte.
- **OpenAPI do GitHub**: `github/rest-api-description`, `api.github.com.json`, versão **1.1.4**, lido em 2026-10-18.
- **Dados de fine-grained PAT** do `github/docs`: `fine-grained-pat.json` (2026-10-06) e `fine-grained-pat-permissions.json` (2026-10-09). São a fonte das páginas [Endpoints available for fine-grained PATs](https://docs.github.com/en/rest/authentication/endpoints-available-for-fine-grained-personal-access-tokens) e [Permissions required for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
- **`gh`**: a última release é a **v2.102.0** (2026-09-30), e o código lido foi o da tag `v2.102.0`. O `gh` local é o 2.93.0. O manual é o de `cli.github.com/manual`, lido em 2026-10-18.
- **Claude Code**: a última release é a **v2.1.303** (2026-10-18). `anthropics/claude-code-action`: tag mais recente **v1.0.253**. Os docs de `code.claude.com/docs/en/*.md` foram lidos em 2026-10-18 (servidor: `last-modified` de 2026-10-19 00:47 GMT, sem data de revisão na página).
- **Termos de Serviço do GitHub**: "Effective date: April 27, 2026" (fonte de 2026-07-24).

Legenda: **Fonte diz** é citação ou paráfrase direta. **Inferência** é conclusão minha. **Ambíguo** quer dizer que os docs não fecham a questão ou se contradizem; precisa de teste.

---

## Vereditos

| # | Pergunta | Veredito |
| --- | --- | --- |
| 1 | "Use this template" | **Histórico não relacionado** (um único commit). Pode gerar repo **privado** a partir de template público. Para manter histórico: `git clone` + `gh repo create --private --source . --push`. Fork não serve: não pode ser privado. |
| 2 | Token do machine user | **PAT classic com `repo`, sem `workflow`.** O fine-grained não alcança repo de outra conta pessoal em que o usuário é colaborador. O convite se aceita por API com o classic (`PATCH /user/repository_invitations/{id}`); o fine-grained não pode. O classic pode não expirar. O ToS permite **uma** conta machine gratuita por pessoa. |
| 3 | Privado Free | **Nada** disto: branch protection, rulesets, environments, secrets de environment, protection rules, deployment branches. No **público**, tudo existe. Push rulesets só no Team. |
| 4 | Settings do Actions | Num repo novo de conta pessoal, o Actions vem **habilitado**, o `GITHUB_TOKEN` vem **restrito** (só `contents: read` e `packages: read`) e "create and approve PRs" vem **desligado**. Tudo isso se ajusta por REST (`/repos/{o}/{r}/actions/permissions*`). |
| 5 | GHCR | O push com `GITHUB_TOKEN` a partir de um workflow **liga o pacote ao repo** automaticamente. Com isso, o pacote herda o **acesso** do repo, e os workflows do repo leem com `packages: read`, sem "Manage Actions access". A **visibilidade herdada é ambígua**: os docs se contradizem. O storage e a banda do GHCR são **grátis** hoje. |
| 6 | `gh` idempotente | São upsert: `gh label create --force`, `gh secret set`, `gh variable set`, `gh api -X PUT` em environments e branch protection. Rulesets: `GET` e depois `POST` ou `PUT /rulesets/{id}`. `--attach` só existe a partir do **gh v2.99.0**. |
| 7 | Auth do Claude no CI | `claude setup-token` gera um token de **1 ano**, para planos Pro, Max, Team e Enterprise, e é documentado para CI. O `ANTHROPIC_API_KEY` tem precedência. Os termos dizem que OAuth é para "ordinary use" e que os limites de Pro e Max assumem "ordinary, individual usage". Isso é **ambíguo** para uma Factory que roda sem parar. |

---

## 1. "Use this template" × `git clone` + push

### Histórico

- **Fonte diz:** "a repository created from a template starts with a single commit." e "Branches created from a template have unrelated histories, which means you cannot create pull requests or merge between the branches." — [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template) (2026-08-14).
- A página de criar template repete: "Branches created from a template have unrelated histories, so you cannot create pull requests or merge between the branches." — [Creating a template repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository) (2026-03-12).
- **Veredito:** com o botão, `git merge upstream/main` exige `--allow-unrelated-histories`. Isso confirma o [ticket 28](../issues/28-upstream-skeleton-sync.md).

### Privado a partir de template público

- **Fonte diz:**
  - "Anyone with read access to a template repository can create a repository from that template."
  - O passo "Choose a repository visibility" faz parte do fluxo.

  — [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).
- **Fonte diz:** o endpoint `POST /repos/{template_owner}/{template_repo}/generate` aceita `private` ("Either `true` to create a new private repository") e `include_all_branches`. O token classic precisa de "`repo` scope to create a private repository" — [Create a repository using a template](https://docs.github.com/en/rest/repos/repos#create-a-repository-using-a-template) (OpenAPI 1.1.4).
- **Veredito:** sim, dá para criar repo privado a partir do template público.

### Outros efeitos de marcar o repo como template

- **Fonte diz:**
  - "Your template repository cannot include files stored using Git LFS."
  - Quem tem acesso pode gerar repos "with the same directory structure and files as your default branch", com a opção de levar todos os branches.
  - No github.com, o botão também oferece "Open in a codespace".

  — [Creating a template repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository) e [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).
- A API expõe `is_template` ("check that the `is_template` key is `true`", na mesma página do REST). O `gh repo edit --template` liga a flag (flags de `pkg/cmd/repo/edit/edit.go` na tag v2.102.0).
- **Inferência:** não há outro efeito documentado. A flag é configuração do repo, não do git. Uma cópia feita por `clone` + push **não herda** `is_template`.

### Fork não é alternativa

- **Fonte diz:** "Public repository forks are public, and private repository forks are private. [...] You cannot change the visibility of a fork by itself." — [Forks](https://docs.github.com/en/pull-requests/reference/forks) (2026-09-29).

### `git clone` + push

- O manual de [`gh repo create`](https://cli.github.com/manual/gh_repo_create) descreve `--source` e `--push`, e com eles o histórico se preserva.
- A ressalva do `origin` (renomear para `upstream` antes) foi verificada no código em [26-template-bootstrap.md §7](26-template-bootstrap.md).
- **Veredito:** o caminho do bootstrap é `git clone` → `git remote rename origin upstream` → `gh repo create <app> --private --source . --push`.

---

## 2. Token do machine user (`FACTORY_TOKEN`)

### Fine-grained × classic para colaborador em repo de outra conta pessoal

- **Fonte diz:**
  - "Each token is limited to access resources owned by a single user or organization."
  - "Under **Resource owner** [...] The token will only be able to access resources owned by the selected resource owner."
  - Entre os "major gaps": "Using fine-grained personal access token to contribute to repositories where the user is an outside or repository collaborator."

  — [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) (2026-07-30).
- **Fonte diz:** o anúncio de GA (2025-03-18) já listava "contributing to repositories where you're an outside collaborator" como lacuna — [Fine-grained PATs are now generally available](https://github.blog/changelog/2025-03-18-fine-grained-pats-are-now-generally-available/).
- Não achei changelog até 2026-10-18 que feche essa lacuna. O mais recente sobre permissões, de 2026-10-13, trata de `repository_creation` e `installation_repositories` — [GitHub App improvements for least privilege](https://github.blog/changelog/2026-10-13-github-app-improvements-for-least-privilege-and-management/).
- **Veredito:** tem que ser **PAT classic**.

### Escopos e permissões por ação

O escopo classic **`repo`** basta para tudo o que a Factory faz.

- **Fonte diz:** `repo` "Grants full access to public and private repositories including read and write access to code, commit statuses, repository invitations, collaborators, deployment statuses, and repository webhooks." — [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) (2026-08-13).

O que o machine user pode fazer depende do **papel** dele, não do escopo. Num repo pessoal, colaborador sempre tem **write**.

- **Fonte diz:** "In a private repository, repository owners can only grant write access to collaborators."
- **Fonte diz:** o colaborador pode, entre outras coisas:
  - "Create, edit, and delete comments on commits, pull requests, and issues";
  - "Manage labels for issues and pull requests";
  - "Create, merge, and close pull requests";
  - "Submit a review on a pull request that affects the mergeability of the pull request";
  - "Publish, view, or install packages".

  — [Permission levels for a personal account repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository) (2026-08-14).
- **Fonte diz:** no `PUT /repos/{o}/{r}/collaborators/{username}`, o `permission` é "Only valid on organization-owned repositories" — [Collaborators](https://docs.github.com/en/rest/collaborators/collaborators).

| Ação da Factory | Classic | Fine-grained (só se o repo estivesse numa org) |
| --- | --- | --- |
| push de branch | `repo` | Contents: write |
| abrir PR / marcar ready | `repo` | Pull requests: write |
| comentar em PR e issue | `repo` | Issues **ou** Pull requests: write |
| review `COMMENT` | `repo` | Pull requests: write (`POST /pulls/{n}/reviews`) |
| criar ou aplicar labels | `repo` | Issues **ou** Pull requests: write |
| ler dependências de issue | `repo` | Issues: read (`GET .../dependencies/blocked_by`) |
| `gh pr comment --attach` | aceito | aceito (no `gh`) |
| aceitar convite | `repo` ou `repo:invite` | **não suportado** |
| alterar `.github/workflows/` | exige `workflow` | Workflows: write |

Fontes da coluna fine-grained: [Permissions required for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens). Os dados são de 2026-10-09 e foram conferidos endpoint a endpoint.

- **Review que bloqueia:** o "Submit a review [...] that affects the mergeability" mostra que um `APPROVE` do machine user **contaria** para o merge. **Inferência:** mandar `--comment`, e nunca `--approve`, é convenção do prompt; a forja não impõe isso.
- **`--attach`:**
  - o código de `internal/attachments/client.go` (v2.102.0) aceita os tipos `OAuth`, `PersonalAccess` (classic), `FineGrainedPAT` e `UserToServer`;
  - ele exige papel `ADMIN`, `MAINTAIN` ou `WRITE` ("READ and TRIAGE get a 404");
  - o pacote **não existe** até a v2.98.0 e aparece na **v2.99.0** (2026-09-01). O `gh` local (2.93.0) não tem `--attach`;
  - o endpoint de upload não é documentado no REST, e o próprio código diz "the endpoint decides".

  **Inferência:** o CI precisa de `gh` ≥ 2.99.0.
- **Sem `workflow`:**
  - **Fonte diz:** "Workflow files can be committed without this scope if the same file (with both the same path and contents) exists on another branch in the same repository." — [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
  - **Inferência:** a Factory consegue fazer merge de `main` no branch dela mesmo quando `main` mudou os workflows. O que ela não consegue é criar ou alterar um workflow novo.
- **`gh auth login --with-token`:** o manual pede "minimum required scopes [...] repo, read:org, and gist" e recomenda `GH_TOKEN` para uso headless — [gh auth login](https://cli.github.com/manual/gh_auth_login). **Inferência:** no CI, usar `GH_TOKEN=$FACTORY_TOKEN`, e não `auth login`; aí bastam `repo`. Isso não foi testado.

### Risco do classic

- **Fonte diz:** "Your personal access token (classic) can access every repository that you can access." — [Managing your PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
- **Inferência:** o ToS limita a uma conta machine gratuita (abaixo). Quem tiver vários produtos tende a reaproveitar o mesmo machine user, e aí o `FACTORY_TOKEN` de um repo escreve em todos os outros em que ele é colaborador. O bootstrap deve avisar isso ou sugerir um token por repo, ainda que o alcance seja o mesmo.

### Expiração

- **Fine-grained:**
  - **Fonte diz:** "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy set by your organization or enterprise owner".
  - **Fonte diz:** `expires_in` aceita "Integer between 1 and 366, or `none`", e o default é 30 dias.
  - Há um limite de 50 fine-grained PATs.

  — [Managing your PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
- **Classic:**
  - **Fonte diz:** "To give your token an expiration, select **Expiration**, then choose a default option or click **Custom**" — mesma página.
  - **Fonte diz:** "Personal access tokens (classic) do not have an expiration requirement" (na política de org) — [Setting a PAT policy for your organization](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization) (2026-07-08).
  - **Ambíguo:** a página de criação não lista literalmente a opção "No expiration" nem diz qual é o teto do "Custom". A conclusão de que o classic pode não expirar vem da frase da política de org.
- **Os dois:** "GitHub will automatically revoke an OAuth token or personal access token when the token hasn't been used in one year." — [Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation).

### ToS: contas machine

- **Fonte diz:**
  - "A machine account is an Account set up by an individual human who accepts the Terms on behalf of the Account, provides a valid email address, and is responsible for its actions. A machine account is used exclusively for performing automated tasks. [...] You may maintain no more than one free machine account in addition to your free Personal Account."
  - "Accounts registered by 'bots' or other automated methods are not permitted."

  — [GitHub Terms of Service, B.3](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (effective 2026-04-27).
- **Veredito:**
  - uma conta machine gratuita por pessoa;
  - criada por um humano, com e-mail válido;
  - o bootstrap **não pode** criá-la por automação.

### Convite e aceite por API

- **Convidar:** `PUT /repos/{o}/{r}/collaborators/{user}` devolve `201` quando cria o convite e `204` quando "an existing collaborator is added as a collaborator". O limite é "50 invitations to a repository per 24 hour period". — [Collaborators](https://docs.github.com/en/rest/collaborators/collaborators). O endpoint é idempotente.
- **Aceitar:** `PATCH /user/repository_invitations/{invitation_id}` devolve 204. O id vem de `GET /user/repository_invitations` — [Repository invitations](https://docs.github.com/en/rest/collaborators/invitations).
- **Classic:** `repo:invite` "Grants accept/decline abilities for invitations to collaborate on a repository", e `repo` também cobre — [Scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
- **Fine-grained:** os dados oficiais listam `GET /user/repository_invitations` e `DELETE /user/repository_invitations/{id}`, mas **não** o `PATCH` — [Endpoints available for fine-grained PATs](https://docs.github.com/en/rest/authentication/endpoints-available-for-fine-grained-personal-access-tokens). O OpenAPI marca o `PATCH` com `enabledForGitHubApps: false`.
- **Veredito:** dá para aceitar com o próprio `FACTORY_TOKEN` classic (`repo`).

---

## 3. GitHub Free: privado × público (texto atual)

- **Environments** ([reusable](https://github.com/github/docs/blob/main/data/reusables/gated-features/environments.md), 2026-04-23, exibido em [Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)):
  > "Environments, environment secrets, and deployment protection rules are available in public repositories for all current GitHub plans. [...] For access to environments, environment secrets, and deployment branches in private or internal repositories, you must use GitHub Pro, GitHub Team, or GitHub Enterprise. If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, other deployment protection rules, such as a wait timer or required reviewers, are only available for public repositories."
- **Fonte diz:** "Users with GitHub Free plans can only configure environments for public repositories. If you convert a repository from public to private, any configured protection rules or environment secrets will be ignored, and you will not be able to configure any environments." — [Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) (2026-07-16).
- **Fonte diz** ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), 2026-07-16):
  - "If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, required reviewers are only available for public repositories." O mesmo vale para wait timers, bypass de admin e custom rules.
  - "Deployment branches and tags are available for all public repositories. For users on GitHub Pro or GitHub Team plans, deployment branches and tags are also available for private repositories."
  - "If you are using GitHub Free, environment secrets are only available in public repositories."
  - "Environment variables are available for all public repositories. For users on GitHub Pro or GitHub Team plans, environment variables are also available for private repositories."
- **Protected branches** ([reusable](https://github.com/github/docs/blob/main/data/reusables/gated-features/protected-branches.md), em [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)):
  > "Protected branches are available in public repositories with GitHub Free and GitHub Free for organizations. Protected branches are also available in public and private repositories with GitHub Pro, GitHub Team, GitHub Enterprise Cloud, and GitHub Enterprise Server."
- **Rulesets** ([reusable](https://github.com/github/docs/blob/main/data/reusables/gated-features/repo-rules.md), 2026-06-09, em [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)):
  > "Rulesets are available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, and GitHub Enterprise Cloud. [...] Push rulesets are available for the GitHub Team plan in internal and private repositories, and forks of repositories that have push rulesets enabled."

| Recurso | Privado Free (conta pessoal) | Público Free |
| --- | --- | --- |
| Branch protection | não | sim |
| Rulesets (branch e tag) | não | sim |
| Push rulesets (bloquear paths como `.github/workflows/**`) | não | **não** (só Team, privado ou interno) |
| Environments | não | sim |
| Secrets de environment | não | sim |
| Variáveis de environment | não | sim |
| Required reviewers, wait timer, bypass de admin, custom rules | não | sim |
| Deployment branches e tags | não | sim |
| Secrets e variáveis de **repo** | sim (nenhuma restrição de plano nas páginas) | sim |

**Inferência:** num Free, nem o público consegue bloquear por regra da forja que a Factory edite workflows. Essa barreira é só a ausência do escopo `workflow` (§2).

---

## 4. Settings do Actions num repo novo

Fonte principal: [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository) (2026-09-15).

- **Actions habilitado:**
  - **Fonte diz:** "By default, GitHub Actions is enabled on all repositories and organizations." ([reusable `disabling-github-actions`](https://github.com/github/docs/blob/main/data/reusables/actions/disabling-github-actions.md)).
  - **Inferência:** isso vale para um repo criado por push.
  - **Exceção documentada:** "When a public repository is forked, scheduled workflows are disabled by default. In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." — [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows). Isso importa para o scheduler da Factory no repo **público**.
- **`GITHUB_TOKEN` padrão:**
  - **Fonte diz:** "By default, when you create a new repository in your personal account, `GITHUB_TOKEN` only has read access for the `contents` and `packages` scopes."
  - **Fonte diz:** "If you specify the access for any of these permissions, all of those that are not specified are set to `none`." — [reusable de permissões](https://github.com/github/docs/blob/main/data/reusables/actions/github-token-available-permissions.md), em [Workflow syntax › permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).
  - **Inferência:** o push para o GHCR precisa de `permissions: packages: write` explícito no job. Um job que declara `permissions:` precisa repetir `packages: read` para puxar a imagem.
- **"Allow GitHub Actions to create and approve pull requests":**
  - **Fonte diz:** "By default, when you create a new repository in your personal account, workflows are not allowed to create or approve pull requests."
  - **Inferência:** a Factory abre PRs com `FACTORY_TOKEN`, então essa opção pode ficar **desligada**. É a postura mais segura.
- **PRs criados com `GITHUB_TOKEN`:**
  - **Fonte diz:** "events triggered by the `GITHUB_TOKEN` will not create a new workflow run". As exceções são `workflow_dispatch` e `repository_dispatch`, e `pull_request` opened, synchronize ou reopened criados pelo `GITHUB_TOKEN`, que geram runs "in an approval-required state". — [reusable](https://github.com/github/docs/blob/main/data/reusables/actions/actions-do-not-trigger-workflows.md) (2026-05-22), em [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token).
  - **Inferência:** esse é o motivo de a Factory usar um PAT para empurrar e abrir PRs, e assim o CI do PR roda sem aprovação.
- **PRs de fork:**
  - **Repo público:** "By default, all first-time contributors require approval to run workflows" ([reusable](https://github.com/github/docs/blob/main/data/reusables/actions/workflow-run-approve-public-fork.md)). As opções são `first_time_contributors_new_to_github`, `first_time_contributors` e `all_external_contributors`.
  - **Repo privado:** existem as políticas "Run workflows from fork pull requests", "Send write tokens…", "Send secrets…" e "Require approval…".
  - **Ambíguo:** os docs não dizem qual é o default no privado. A seção se chama "Enabling workflows for forks of private repositories", o que sugere que vem desligado.
  - **Inferência:** o machine user empurra branches **no próprio repo**, não em fork, então essas políticas não o afetam.

### Endpoints REST

Fonte: OpenAPI 1.1.4 e [Actions permissions](https://docs.github.com/en/rest/actions/permissions). Todos aceitam classic com `repo`, conforme a descrição de cada endpoint.

| Setting | Endpoint | Corpo |
| --- | --- | --- |
| Actions on/off e ações permitidas | `PUT /repos/{o}/{r}/actions/permissions` | `{"enabled":true,"allowed_actions":"all\|local_only\|selected","sha_pinning_required":bool}` |
| Ações e workflows selecionados | `PUT /repos/{o}/{r}/actions/permissions/selected-actions` | — |
| `GITHUB_TOKEN` padrão e criar/aprovar PR | `PUT /repos/{o}/{r}/actions/permissions/workflow` | `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}` |
| Aprovação de PR de fork (público) | `PUT /repos/{o}/{r}/actions/permissions/fork-pr-contributor-approval` | `{"approval_policy":"all_external_contributors"}` |
| PR de fork em repo privado | `PUT /repos/{o}/{r}/actions/permissions/fork-pr-workflows-private-repos` | `{"run_workflows_from_fork_pull_requests":false,...}` |
| Acesso de workflows de fora (privado) | `PUT /repos/{o}/{r}/actions/permissions/access` | — |
| Retenção de artifacts e logs | `PUT /repos/{o}/{r}/actions/permissions/artifact-and-log-retention` | — |

Com `gh`, todos esses passam por `gh api -X PUT ... --input -`. Não há subcomando dedicado.

**Ambíguo:** a descrição do campo `can_approve_pull_request_reviews` fala só em "approve". Na UI, o mesmo toggle cobre "create and approve".

---

## 5. GHCR (`ghcr.io/<owner>/<repo>/<image>`)

- **Ligação automática:**
  - **Fonte diz:** "The easiest way to connect a repository to a container package is to publish the package from a workflow using `${{secrets.GITHUB_TOKEN}}`, as the repository that contains the workflow is linked automatically."
  - **Fonte diz:** "Note that the `GITHUB_TOKEN` will not have permission to push the package if you have previously pushed a package to the same namespace, but have not connected the package to the repository."
  - Os docs recomendam a label `org.opencontainers.image.source`.

  — [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) (2026-07-09).
- **Herança de acesso:**
  - **Fonte diz:** "By default, if you publish a package that is linked to a repository, the package automatically inherits the access permissions (but not the visibility) of the linked repository. [...] When a package automatically inherits access permissions, GitHub Actions workflows in the linked repository also automatically get access to the package."
  - **Fonte diz:** "A package only inherits the access permissions of a linked repository automatically if you link the repository to the package before you publish the package, such as by adding the `org.opencontainers.image.source` Docker label".

  — [Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility) (2026-09-11). A feature `packages-inherit-permissions` está ativa em `fpt`.
- **Visibilidade: contradição entre páginas.**
  - A página de access control diz que a herança é do acesso "(but not the visibility)", e que "When you first publish a package that is scoped to your personal account, the default visibility is private".
  - Já [Publishing and installing a package with GitHub Actions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions) (2026-07-24) diz: "by default if a workflow creates a package using the `GITHUB_TOKEN`, then: The package inherits the visibility and permissions model of the repository where the workflow is run."
  - **Para o privado Free**, as duas leituras dão **privado**. **Para o template público**, a imagem pode nascer pública ou privada. Precisa de teste.
- **Leitura pelos jobs do mesmo repo:**
  - pelas duas páginas, com o pacote ligado e com herança, os workflows do repo ganham acesso, então **não** é preciso "Manage Actions access";
  - o "Manage Actions access" só é necessário para pacotes não ligados ou para dar acesso a **outros** repos ("you must give explicit access to the repository where the workflow is stored");
  - o job precisa de `credentials` explícitas:

    ```yaml
    container:
      image: ghcr.io/owner/image
      credentials:
        username: ${{ github.actor }}
        password: ${{ secrets.github_token }}
    ```

    — [Workflow syntax › `jobs.<job_id>.container.credentials`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idcontainercredentials) (2026-10-01).
  - **Inferência:** além das `credentials`, o job precisa de `packages: read`.
- **Recomendação** (inferência a partir das duas citações): pôr `LABEL org.opencontainers.image.source=https://github.com/<owner>/<repo>` no Dockerfile. Assim a herança fica garantida mesmo pela leitura mais restritiva. Isso vale **antes do primeiro push**.
- **Custo:**
  - **Fonte diz:** "Container image storage and bandwidth for the Container registry is currently free. If you use Container registry, you'll be informed at least one month in advance of any change to this policy."
  - **Fonte diz:** "When a workflow uses GitHub Actions to download a package, the data transfer does not count against the usage for the hosting repository [...] when you log in to GitHub Packages using a `GITHUB_TOKEN`."
  - Para os outros registries, a cota do Free é de 500 MB de storage e 1 GB de transferência por mês, e o storage é compartilhado com os artifacts do Actions.

  — [GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages) (2026-07-09).
- **Fine-grained e Packages:** "Using fine-grained personal access token to access Packages" está entre os gaps ([Managing your PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)). Não afeta o design: o GHCR usa só o `GITHUB_TOKEN`.

---

## 6. `gh` para um bootstrap idempotente (v2.102.0)

| Passo | Comando | Idempotência (código da tag v2.102.0) |
| --- | --- | --- |
| Labels | `gh label create NAME --color C --description D --force` | Sem `--force`, falha se já existe. Com `--force`, faz `PATCH` ao receber 422 `already_exists` (`pkg/cmd/label/create.go`). [manual](https://cli.github.com/manual/gh_label_create) |
| Secrets do repo | `gh secret set NAME --body "$V"` (ou `-f .env`) | `PUT`, então é upsert (`pkg/cmd/secret/set/http.go`). [manual](https://cli.github.com/manual/gh_secret_set) |
| Checar secrets | `gh secret list --json name,updatedAt` | Leitura. Não revela o valor. [manual](https://cli.github.com/manual/gh_secret_list) |
| Variáveis | `gh variable set NAME --body "$V"` | `POST`; ao receber 409, faz `PATCH` (`pkg/cmd/variable/set/http.go`). [manual](https://cli.github.com/manual/gh_variable_set) |
| Secrets e variáveis de environment | `gh secret set --env E`, `gh variable set --env E` | Upsert, mas só funciona onde há environment (§3). |
| Environment | `gh api -X PUT repos/{o}/{r}/environments/{env} --input -` | "Create or update an environment". [REST](https://docs.github.com/en/rest/deployments/environments) |
| Branch protection | `gh api -X PUT repos/{o}/{r}/branches/{b}/protection --input -` | `PUT` substitui. [REST](https://docs.github.com/en/rest/branches/branch-protection) |
| Rulesets | `gh api repos/{o}/{r}/rulesets`, depois `POST` (novo) ou `PUT .../rulesets/{id}` (existente) | O `POST` cria duplicado, então o script precisa casar pelo `name`. O `gh ruleset` só tem `list`, `view` e `check`. [REST](https://docs.github.com/en/rest/repos/rules) |
| Settings do repo | `gh repo edit --delete-branch-on-merge --enable-auto-merge=false --enable-wiki=false ...` ou `gh api -X PATCH repos/{o}/{r}` | `PATCH` idempotente. A troca de visibilidade exige `--accept-visibility-change-consequences`. [manual](https://cli.github.com/manual/gh_repo_edit) |
| Settings do Actions | `gh api -X PUT repos/{o}/{r}/actions/permissions/workflow ...` | `PUT` (§4). |
| Convidar o machine user | `gh api -X PUT repos/{o}/{r}/collaborators/{user}` | 201 na primeira vez, 204 depois (§2). |

Flags de `gh repo edit` na v2.102.0: `--description`, `--homepage`, `--default-branch`, `--visibility`, `--template`, `--enable-issues`, `--enable-projects`, `--enable-wiki`, `--enable-discussions`, `--enable-merge-commit`, `--enable-squash-merge`, `--enable-rebase-merge`, `--enable-auto-merge`, `--delete-branch-on-merge`, `--allow-forking`, `--allow-update-branch`, `--squash-merge-commit-message`, `--add-topic`, `--remove-topic` e as de security.

**Inferência:** o script deve ler `visibility` (`gh repo view --json visibility`) e **pular** environments, rulesets e branch protection quando o repo for privado. A resposta exata da API nesses casos (403 ou 422) não está documentada.

---

## 7. Claude Code no CI

- **`setup-token`:**
  - **Fonte diz:** "generate a one-year OAuth token with `claude setup-token` [...] It does not save the token anywhere; copy it and set it as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable".
  - **Fonte diz:** "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. It can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors. MCP servers you configure locally still work."
  - **Fonte diz:** "Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`."

  — [Authentication › Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).
- **Precedência:**
  - a ordem é `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` > profiles > `/login`;
  - "In non-interactive mode (`-p`), the key is always used when present";
  - o `CLAUDE_CODE_OAUTH_TOKEN` é descrito como "Use this for CI pipelines and scripts where browser login isn't available".

  — [Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence).
- **GitHub Actions:**
  - **Fonte diz:** "`CLAUDE_CODE_OAUTH_TOKEN`: an OAuth token that authenticates with your Claude subscription, available on Pro, Max, Team, and Enterprise plans."
  - **Fonte diz:** "For a secret shared across repositories, authenticate with an API key [...] since an OAuth token is tied to the subscription of the person who ran `claude setup-token`."
  - **Fonte diz:** "If you authenticate with an OAuth token, runs use your Claude subscription instead of API billing."
  - Há uma terceira via **sem secret longo**: *workload identity federation* (OIDC → service account do Console, inputs `anthropic_federation_rule_id` e outros, com `id-token: write`). O consumo vai para a cobrança de API.

  — [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions).
- **Termos (ambíguo):**
  - **Fonte diz:** "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
  - **Fonte diz:** "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
  - **Fonte diz:** quem constrói produtos "should use API key authentication". É proibido "route requests through Free, Pro, or Max plan credentials on behalf of their users".
  - **Fonte diz:** cada usuário final deve autenticar "with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential".

  — [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
  - **Leitura:** quem copia o template e usa o **próprio** token no **próprio** repo é o caso que os docs de GitHub Actions suportam. O template não intermedeia credencial nem revende uso.
  - **Ambíguo:** os docs não dizem se uma Factory que roda continuamente cabe em "ordinary, individual usage". O que está escrito é que os limites anunciados assumem esse uso, não que outro uso é proibido.
  - **Recomendação:** o bootstrap aceita os dois secrets e recomenda `ANTHROPIC_API_KEY` (ou federation) para uso pesado ou compartilhado.
- **Para o bootstrap:**
  - avisar que o `ANTHROPIC_API_KEY` vence se os dois existirem;
  - anotar a data de criação do OAuth token, que vale 1 ano. Os docs não mostram um comando que exiba a data de expiração.

---

## Pontos ambíguos ou em aberto (testar)

1. **Visibilidade do pacote GHCR** criado por workflow num repo **público**: herda do repo ou nasce privado? As duas páginas de Packages se contradizem (§5).
2. **Herança de acesso sem a label** `org.opencontainers.image.source`: a ligação automática pelo `GITHUB_TOKEN` conta como "link before publish"? Na dúvida, pôr a label (§5).
3. **Classic PAT:** o texto atual da página não confirma literalmente a opção "No expiration" nem o teto do "Custom" (§2).
4. **Default de "Run workflows from fork pull requests"** em repo privado: não está documentado (§4).
5. **Resposta da API** ao criar environment, ruleset ou branch protection num privado Free (§3, §6).
6. **"Ordinary, individual usage"** para uma Factory com `CLAUDE_CODE_OAUTH_TOKEN` (§7).
7. **Endpoint de upload do `--attach`:** não é documentado no REST. O que vale é o comportamento do `gh` ≥ 2.99.0 (§2).
