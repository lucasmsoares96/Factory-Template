# Pesquisa 19 — Segurança do CI do PR com código da Factory

Ticket: [19-pr-ci-security](../issues/19-pr-ci-security.md) · Pesquisado em 2026-10-18
Complementa: [05-pr-preview-environments](05-pr-preview-environments.md) (fluxo de preview) e [14-forgejo-portability](14-forgejo-portability.md) (token automático, eventos). Não repete o que está lá.

Versões consultadas:
- **GitHub Docs** (`docs.github.com`, lidas via `/api/article/body` em 2026-10-18). Changelogs de 2025-11-07, 2026-06-18, 2026-06-26 e 2026-09-10. `actions/checkout` v7.0.1 (2026-07-20).
- **Forgejo** v16.0.6 (tag de 2026-10-12): código-fonte em `codeberg.org/forgejo/forgejo` e docs v16.0. Também conferi a v17.0.0 (2026-10-15) e o **Forgejo Runner v13.2.0** (2026-09-18).
- **Cloudflare**: docs com a data "Last updated" citada em cada item. Código de `cloudflare/workers-sdk` no commit `0d826c6` (2026-10-18), wrangler **4.151.1**.
- **Neon**: docs `.md`, sem data por página, lidas em 2026-10-18. `create-branch-action` no `main` (v6.3.1).
- **Resend**: docs `.md`, sem data por página, lidas em 2026-10-18.
- **Drizzle**: pacote npm `drizzle-orm@1.0.0-rc.4` (tag `rc`, publicada em 2026-06-27; `latest` = 0.45.4). Docs `orm.drizzle.team`, sem data.

Convenção: **Fonte diz** é afirmação da fonte primária (doc ou código). **Inferência** é leitura minha.

---

## Resposta

### O desenho planejado tem uma falha de base

No `pull_request`, o **YAML do workflow vem do próprio PR**. Isso vale nas duas forjas:
- **GitHub:** o `pull_request` "runs the workflow file from the merge commit of the pull request" ([Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)).
- **Forgejo:** "When a trusted user submits a pull request, workflows found in the pull request content are used" ([Security of Pull Requests, v16](https://forgejo.org/docs/v16.0/user/actions/security-pull-request/)).

Portanto, um "job B com secrets" no mesmo workflow `pull_request` é **definido pelo agente**. Basta o branch trocar o YAML para o job B rodar código do PR, ou ler `${{ toJSON(secrets) }}`. Separar em jobs só protege se o YAML do job B vier da `main`. Há três formas de garantir isso:

1. **Gatilho privilegiado**, cujo YAML vem da branch base:
   - `pull_request_target` existe nas duas forjas;
   - `workflow_run` existe só no GitHub e **não existe no Forgejo**, nem na v16 nem na v17.
2. **Impedir o machine user de alterar workflows.** No GitHub, isso é um PAT sem o escopo `workflow` (ou sem a permissão fine-grained "Workflows"). No Forgejo, *protected file patterns*, que têm ressalvas.
3. **Credenciais que o job do PR não consegue obter:**
   - GitHub: *environment* restrito à `main`;
   - Forgejo: OIDC + broker, pois o Forgejo não tem environments.

### Desenho portável recomendado (inferência a partir dos achados)

- **Um workflow `pr-preview.yml` em `pull_request_target`.** O YAML vem da branch base nas duas forjas. Ele tem dois jobs na mesma execução, porque o Forgejo não acessa artifacts de outra execução:
  - **Job A (build/teste):** faz checkout do head do PR com `persist-credentials: false`. Não referencia secrets e **não usa cache**. Faz upload de `worker.js`, de `dist/client/` e de `drizzle/`.
  - **Job B (deploy):** faz checkout da `main` e baixa os artifacts para `$RUNNER_TEMP`, fora do workspace. Roda **apenas código da `main`**:
    - `wrangler preview --config <config da main> <bundle>`, com `no_bundle: true`;
    - um script da `main` que chama `migrate(db, { migrationsFolder })` do Drizzle.
- **No GitHub**, `permissions: {}` no job A e secrets num *environment* `preview-deploy` restrito a `main`. No `pull_request_target`, o `GITHUB_REF` é a branch default, então o environment libera o job B. Num `pull_request`, o ref é `refs/pull/N/merge` e o environment bloqueia.
- **No Forgejo, o job A fica mais exposto do que no GitHub**, por três motivos de código:
  1. **todos** os secrets do repo e da org vão para o runner em todo job;
  2. o token automático com escrita fica **no env de todo step** (`FORGEJO_TOKEN`/`GITHUB_TOKEN`);
  3. no `pull_request_target`, a escrita no cache **não é isolada**.

  Mitigações:
  - não guardar tokens Cloudflare/Neon nos secrets do Forgejo. O job B os obtém via **OIDC** (`enable-openid-connect` só nele) num broker próprio que valida `event_name`, `ref` e `workflow_ref`;
  - não usar cache nos workflows privilegiados;
  - proteger a `main`.
- **O preview em si roda código do PR.** O Worker do preview recebe a `DATABASE_URL` do branch Neon e os secrets de preview, então qualquer secret de preview e qualquer dado do branch Neon devem ser tratados como **expostos**. Consequências:
  - o branch Neon do PR **não deve conter dados reais**: usar schema-only, ou um `preview-base` semeado;
  - a role entregue ao preview não pode compartilhar senha com a produção. No Free, um branch filho herda as senhas do pai.
- **Os tokens possíveis são:**
  - **Cloudflare:** account-owned, papel **Editor só no Worker `app`**. Não existe escopo "só previews": o mesmo token faz `wrangler deploy` em produção.
  - **Neon:** **project-scoped**. Não apaga o projeto, mas vê as connection strings e altera ou apaga os branches, inclusive o de produção, exceto se ele for *protected*, que é recurso pago.
  - **Resend:** o E2E lê a caixa `*.resend.app` com uma chave que, pela definição das permissões, precisa ser **full access**. Isso não deve ir para o job do Playwright, que também é código do PR.

### Esboço (não testado)

```yaml
# .github/workflows/pr-preview.yml  (YAML sempre lido da branch base)
on:
  pull_request_target:
    types: [opened, synchronize, reopened]
permissions: {}                      # GitHub; o Forgejo ignora (só emite um aviso)
jobs:
  build:                              # código do PR, sem secrets
    runs-on: ubuntu-24.04
    permissions: { contents: read }
    cache-mode: none                  # GitHub; no Forgejo: simplesmente não usar actions/cache
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - run: pnpm install --frozen-lockfile && pnpm build && pnpm test   # PR code
      - uses: actions/upload-artifact@v4   # Forgejo: v3 ou v4 com patch
        with: { name: preview-bundle, path: out/ }   # out/worker/index.js, out/client/, out/drizzle/
  deploy:                             # só código da main
    needs: build
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    environment: preview-deploy       # GitHub: secrets só aqui, environment restrito a main
    # Forgejo: enable-openid-connect: true  (só neste job) + broker
    steps:
      - uses: actions/checkout@v7      # sem ref → branch default/base
      - run: pnpm install --frozen-lockfile    # deps da main
      - uses: actions/download-artifact@v4
        with: { name: preview-bundle, path: ${{ runner.temp }}/pr }
      - run: node scripts/preview-deploy.mjs "$RUNNER_TEMP/pr"   # script da main: valida, migrate(), wrangler preview --config ...
```

---

## 1. GitHub Actions

### 1.1 O runner recebe secrets que o job não referencia?

- **Fonte diz (doc):** "GitHub Actions can only read a secret if you explicitly include the secret in a workflow." Também: "To make a secret available to an action, you must set the secret as an input or environment variable in your workflow file." ([Secrets](https://docs.github.com/en/actions/concepts/security/secrets))
- **Fonte diz (doc):** "Organization and repository secrets are read when a workflow run is queued, and environment secrets are read when a job referencing the environment starts." ([Secrets reference](https://docs.github.com/en/actions/reference/security/secrets))
- **Fonte diz (doc):** "the runner can only redact secrets used within the current job" ([Secrets](https://docs.github.com/en/actions/concepts/security/secrets)). A secure-use reference fala em "access to **referenced** secrets" ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)).
- **Não documentado oficialmente:** que a mensagem do job leve *apenas* os secrets referenciados **naquele job**. O que há é evidência empírica de log de runner numa discussão comunitária, não confirmada por funcionário do GitHub: só vão os secrets referenciados, e `${{ toJSON(secrets) }}` envia todos ([actions/runner#2445](https://github.com/actions/runner/discussions/2445), 2023-02-17). O código do serviço é fechado.
- **Fonte diz (doc):** os runners hospedados, exceto os de 1 CPU, são "a new virtual machine (VM)" por job ([GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)). Por isso o job A não enxerga a memória do job B.
- **Inferência:** a granularidade por job importa **só** quando o YAML é confiável (`pull_request_target`/`workflow_run`). No `pull_request`, o PR pode simplesmente referenciar o secret.

### 1.2 `pull_request` vindo de branch do mesmo repo

- **Fonte diz:** "With the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is triggered from a forked repository." ([Events › pull_request](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)). Branches do mesmo repo **recebem** secrets. As restrições (token só de leitura, sem secrets, aprovação) são descritas como específicas de fork ([Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)).
- **Fonte diz:** o workflow vem do merge commit, com `GITHUB_REF` = `refs/pull/N/merge` ([Events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)).
- **Fonte diz:** quem cria ou atualiza o PR com `GITHUB_TOKEN` gera uma run "that require approval". Com PAT do machine user, não há aprovação (mesma página).
- **Mitigação nativa: o PAT sem escopo `workflow`.** "Grants the ability to add and update GitHub Actions workflow files. Workflow files can be committed without this scope if the same file (with both the same path and contents) exists on another branch in the same repository." ([Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)). No fine-grained PAT, isso corresponde à permissão de repositório "Workflows" ([Permissions for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)).
  - **Inferência:** o escopo cobre `.github/workflows/`. Actions locais (`.github/actions/*`) e scripts chamados pelo YAML **não** estão cobertos. O job B não deve executar nada do checkout do PR.
- **Mitigação nativa: push ruleset "Restrict file paths".** "Prevent commits that include changes in specified file paths from being pushed". Só existe para repositórios **privados ou internos** ([Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
- **Mitigação nativa: environment com branches restritos.** "The deployment branch or tag rule is matched against the `GITHUB_REF`". Seria preciso adicionar `refs/pull/*/merge` para liberar o `pull_request` ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).
  - Desde 2025-12-08: "For `pull_request_target`, environment rules evaluate against the default branch." ([Changelog 2025-11-07](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/))
  - Em repositório privado, *deployment branches* exige GitHub Pro ou Team (mesma página de environments).

### 1.3 `workflow_run`: orientação oficial

- **Fonte diz:** "The workflow started by the `workflow_run` event is able to access secrets and write tokens, even if the previous workflow was not." Só dispara se o arquivo existir na branch default; `GITHUB_REF` = branch default ([Events › workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)).
- **Fonte diz (artifact poisoning):**
  - "Workflows triggered on `workflow_run` should treat artifacts uploaded from other workflows with caution." ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use))
  - "A `workflow_run` workflow should treat artifacts uploaded by other workflows as untrusted data, since their contents can come from a fork." ([Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target))
  - O Security Lab: com binários construídos a partir do PR, "it would be a security vulnerability to run them in the privileged `workflow_run` workflow context" ([Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/), 2021-08-03, exemplo atualizado em 2026-06-17).
- **Fonte diz (ler o número do PR com segurança):** o exemplo oficial baixa o artifact para `${{ runner.temp }}/artifacts`, com o comentário "do not extract in the workspace dir that may contain executable scripts". Depois faz `Number(...)` com `Number.isInteger`, ou lança erro ([Events › workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)). O Security Lab sugere uma alternativa: `github.rest.pulls.list` filtrando por `github.event.workflow_run.head_sha` e pela branch base ([Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)).
- **Inferência:** no nosso caso, o artifact não é só dado. É um bundle que o job B **sobe** para a Cloudflare (sem executá-lo no runner) e SQL que o job B **aplica** no Neon. Os dois rodam fora do runner, mas com o poder das credenciais. Isso está detalhado nas seções 3 e 4.

### 1.4 `pull_request_target`: pwn request e cache

- **Fonte diz:** o workflow e o `actions/checkout` sem `ref` vêm "from the **base repository's default branch**". O job recebe o `GITHUB_TOKEN` da base e os secrets. Dar checkout no head e rodar `make test` "is known as a 'pwn request'". A página diz que isso vale para dependências e configs ("`npm install` … configuration files and dependencies the code brings with it"). E também que "**Any event that runs with secrets** can introduce a pwn request" ([Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)).
- **Fonte diz:** desde 2025-12-08, "The `pull_request_target` event now always uses the default branch for workflow source and reference" ([Changelog](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/)).
- **Fonte diz (checkout v7):** o `actions/checkout` v7.0.0 bloqueia checkout de PR de **fork** em `pull_request_target`/`workflow_run`, salvo com `allow-unsafe-pr-checkout: true`. "This protection only covers fork pull request refs." Branch do mesmo repo **não** é bloqueado ([CHANGELOG](https://github.com/actions/checkout/blob/main/CHANGELOG.md); [Changelog 2026-06-18](https://github.blog/changelog/2026-06-18-safer-pull_request_target-defaults-for-github-actions-checkout/)).
- **Fonte diz (política padrão):** em repositório **público** sem política, o `pull_request_target` fica bloqueado. A política está em modo *evaluate* e será aplicada em **2026-11-02**. Repositório privado não é afetado ([Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)).
- **Escopo de cache do `pull_request_target`:**
  - **Fonte diz:** "These workflows are privileged, which means they share the same cache of the main branch" ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)).
  - **Fonte diz:** desde 2026-06-26, "workflows triggered by `pull_request_target` have read-only access to the cache in the default branch's scope… can restore existing cache entries but cannot create or overwrite them" ([Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target); [Changelog 2026-06-26](https://github.blog/changelog/2026-06-26-read-only-actions-cache-for-untrusted-triggers/)).
  - Só `push`, `workflow_dispatch`, `repository_dispatch`, `delete`, `registry_package`, `page_build` e `schedule` escrevem no escopo da default. O `workflow_run` e o `issue_comment` também ficam *read-only*. Um `cache-mode: write` explícito reabre o risco ([Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-access-for-low-trust-workflow-triggers); `cache-mode` GA em [2026-09-10](https://github.blog/changelog/2026-09-10-control-github-actions-cache-access-with-cache-mode/)).
  - **Resposta:** sim, um job de `pull_request_target` que roda código do PR **compartilha o escopo de cache da branch default**. Por padrão, ele **só lê** e não consegue envenenar o cache. Ele consegue, porém, **ler** o que a `main` salvou.
- **Fonte diz:** o `pull_request` não é afetado. O cache dele fica no escopo `refs/pull/.../merge` e "cannot be restored by the base branch or other pull requests" (mesma página).
- **Fonte diz (`permissions`):** a doc recomenda o padrão read-only e "The permissions can then be increased, as required, for individual jobs" ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)). **Inferência:** no `pull_request` com YAML do PR, o próprio PR escolhe o `permissions:` do job dele.

## 2. Forgejo v16 Actions

### 2.1 Secrets em `pull_request` de branch do mesmo repo: **sim, e todos**

- **Fonte diz (código v16.0.6, igual na v17.0.0):** `getSecretsOfJob` retorna mapa vazio só quando `job.Run.IsForkPullRequest && TriggerEvent != pull_request_target`. Nos demais casos, retorna `secret_model.FetchActionSecrets(ctx, OwnerID, RepoID)`, ou seja, **todos** os secrets do dono e do repo, sem olhar o YAML. `getSecretsOfTask` acrescenta `GITHUB_TOKEN`/`GITEA_TOKEN`/`FORGEJO_TOKEN` ([`services/actions/secret.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/secret.go); [`models/secret/secret.go` L183-207](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/models/secret/secret.go)).
- **Fonte diz (doc v16):** "They are stored encrypted in the Forgejo database, and sent out to workflows when they are needed." A doc não detalha mais que isso ([Security, v16](https://forgejo.org/docs/v16.0/user/actions/security/)).
- **Resposta:** o servidor envia **todos** os secrets ao runner em **todo** job não-fork, referenciados ou não. Não há environment nem secret por job.
- **Fonte diz (código do runner v13.2.0):** `withGithubEnv` faz `set("TOKEN", github.Token)` para os prefixos `FORGEJO` e `GITHUB`. Ou seja, **`FORGEJO_TOKEN` e `GITHUB_TOKEN` ficam no env de todo step**, ao contrário do GitHub ([`act/runner/run_context.go` L1731 @ v13.2.0](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/runner/run_context.go); o mesmo vale na v12.13.2).
- **Fonte diz (código v16.0.6):** o token automático tem `AccessModeWrite` em todas as unidades do repo, exceto em PR de fork ([`models/perm/access/repo_permission.go` L136-160](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/models/perm/access/repo_permission.go)).
  - **Contradição:** a doc v16 diz que no `pull_request` "The token generated for these runs does *not* have write permissions" ([Security, v16](https://forgejo.org/docs/v16.0/user/actions/security/)). O código só tira a escrita em fork.
- **Fonte diz (doc v16):** PR de branch do mesmo repo não precisa de aprovação. A aprovação vale para PR "from a fork" ou AGit ([Security of Pull Requests, v16](https://forgejo.org/docs/v16.0/user/actions/security-pull-request/)). No código, `userIsImplicitlyTrustedWithPullRequest` retorna `true` quando `!pr.IsForkPullRequest()` ([`services/actions/trust.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/trust.go)).

### 2.2 `pull_request_target`

- **Fonte diz (doc v16):** "Workflows with this event will run in the context of the `base` of the Pull Request… the changes proposed in the PR are *not* available… the restrictions on the token are lifted." ([Security, v16](https://forgejo.org/docs/v16.0/user/actions/security/))
- **Fonte diz (código v16.0.6):**
  - os workflows `pull_request_target` são lidos do commit da **branch base do PR** (`git.BranchPrefix + PullRequest.BaseBranch`), e não necessariamente da default como no GitHub ([`services/actions/notifier_helper.go` L257-282](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/notifier_helper.go));
  - `ref` e `sha` do contexto = base ([`services/actions/context.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/context.go));
  - os secrets são entregues inclusive para fork ([`secret.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/secret.go));
  - o token tem escrita para PR do mesmo repo. Para fork, `IsForkPullRequest` continua `true` e o token fica só de leitura ([`repo_permission.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/models/perm/access/repo_permission.go), [`run.go` L457](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/models/actions/run.go)). **Contradição:** a doc diz "restrictions on the token are lifted" sem ressalva para fork.
- **Cache (código do runner v13.2.0):** `getWriteIsolationKey` só isola a escrita quando `eventName == "pull_request"` (chave = `refs/pull/...`). Os outros eventos, **incluindo `pull_request_target`**, "are allowed to write the cache without an isolation key". O cache é separado por repositório, não por branch ([`internal/app/run/runner.go` L194-227](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go); [`act/artifactcache/caches.go`](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/artifactcache/caches.go)). A doc não fala de escopo de cache ([Advanced features, v16](https://forgejo.org/docs/v16.0/user/actions/advanced-features/)).
  - **Inferência:** código do PR rodando num job `pull_request_target` no Forgejo **pode envenenar o cache** que um workflow de `push` da `main` restaurar. Ele tem a URL e o token de runtime no env e não precisa de `actions/cache` no YAML. Isso é o oposto do GitHub.
- **Artifacts:** "It is not currently possible to access artifacts from other workflow runs within forgejo" ([Advanced features, v16](https://forgejo.org/docs/v16.0/user/actions/advanced-features/)). Entre jobs da mesma execução funciona, com upload/download-artifact v3 ou "patched v4".

### 2.3 `workflow_run`: **confirmado que não existe**

- **Fonte diz (código):** a lista de eventos em `modules/actions/github.go` não tem `workflow_run`, nem em v16.0.6 nem em v17.0.0 ([v16.0.6](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/modules/actions/github.go)). As docs v17 também não listam o evento ([Reference](https://forgejo.org/docs/latest/user/actions/reference/); ver pesquisa 14, item A2).

### 2.4 Restringir o token por job: **não existe**

- **Fonte diz (código v16.0.6):** se um job ou workflow declara `permissions`, `calculateWarnings` gera o aviso "…has a `permissions` field, which is not supported in Forgejo and will be ignored. Use Authorized Integrations to grant capabilities to this job instead." ([`services/actions/notifier.go` L860-872](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/notifier.go); texto em `options/locale_next/locale_en-US.json`). As "Authorized Integrations" **ampliam** capacidades, não reduzem o token automático.
- **OIDC é por job, e serve de alternativa a secrets.** **Fonte diz (código):** o ID token só sai se o job tiver `enable-openid-connect`. Para PR de fork fora de `pull_request_target`, ele é desligado ([`services/actions/task.go` L172-200](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/task.go)). Os claims são:
  - `event_name`, `ref`, `ref_protected`, `base_ref`, `head_ref`, `sha`, `workflow`, `workflow_ref`, `repository`, `actor`;
  - `sub` = `repo:<owner>-<id>/<repo>-<id>:pull_request` em `pull_request`, ou `…:ref:<ref>` nos outros eventos.

  Fontes: [`services/actions/auth.go` L33-52 e L164-173](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/services/actions/auth.go); [`routers/api/actions/id_token.go`](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/routers/api/actions/id_token.go).

  **Inferência:** um broker próprio (por exemplo, um Worker) que só troque o ID token por credenciais Cloudflare/Neon quando `event_name == "pull_request_target"` e `ref == "refs/heads/main"` funciona como "secret por job" no Forgejo. Como o YAML do `pull_request_target` vem da base, só o job B pede o token. Não testado.
- **Alternativa: impedir o machine user de mexer em workflows (código).** A regra de branch protegida tem `ProtectedFilePatterns`, e o hook pre-receive recusa o push ("branch %s is protected from changing file %s") quando a regra casa com o branch ([`routers/private/hook_pre_receive.go` L340-390](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/routers/private/hook_pre_receive.go)). Ressalvas, por inferência a partir do código:
  1. só vale para branches que casam com uma regra de proteção (ex.: `factory/*`). Essa regra também bloqueia force-push e deleção;
  2. na **criação** do branch, `GetAffectedFiles` compara com a árvore vazia ("diff against the empty tree"). Então **todo** arquivo conta como alterado, e o primeiro push de um branch novo com `.forgejo/workflows/*` seria recusado ([`modules/git/diff.go` L405-415](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.6/modules/git/diff.go)). É preciso testar se criar o branch via API contorna isso.

## 3. Cloudflare

### 3.1 Permissões do token

- **Fonte diz:** desde 2026-09-15 há papéis granulares (Metadata Read-Only, Content Read-Only, Editor, Admin) **por Worker**. "For an agent or CI/CD workflow… create an account-owned API token. Set the scope to **Specified Workers**" ([Changelog 2026-09-15](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/)). O wrangler exige *account-owned* token para usar a granularidade: "If the token is scoped to a specific Worker, Wrangler can only perform actions allowed for that Worker." ([Roles and permissions](https://developers.cloudflare.com/workers/authorization/), 2026-09-15)
- **Fonte diz:** o Editor "Can read, update, deploy, and rename existing Workers, including script content, settings, schedules, versions, deployments… Cannot create or delete Workers". O `wrangler deploy`, o `versions upload` e o `secret put` exigem "`Editor` for that Worker". "You cannot grant per-Worker access to a Worker that does not exist yet" ([Workers roles](https://developers.cloudflare.com/workers/authorization/workers/), 2026-09-15). Para bindings: "You do not need separate permissions on the bound resources to deploy the Worker" (mesma página).
- **Legado:** "Workers Scripts Edit" equivale a `Editor` no escopo de produto, ou seja, todos os Workers da conta (mesma página). O exemplo de Previews só pede "permission to edit Workers Scripts and the resources used by the Preview" ([Previews › Examples](https://developers.cloudflare.com/workers/previews/examples/), 2026-10-01).
- **Não documentado:**
  - qual papel é exigido por `wrangler preview`, `preview delete` e `preview secret`. As tabelas de autorização não mencionam Previews;
  - se Editor basta para **criar e apagar** um Preview, que é um sub-recurso (`POST|DELETE /accounts/:id/workers/workers/:worker/previews…`) ([`deploy-helpers/src/preview/api.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/preview/api.ts)).

  Testar Editor por Worker antes de adotar. Há relatos na comunidade de erros com tokens por Worker (2026-09/10), não verificados.
- **Escopo "só previews": não existe.** Nenhum grupo ou papel separa Preview de produção na [lista de permissões](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) (2026-10-12) nem nos papéis de Workers. **Inferência:** o token do job B, mesmo restrito a um Worker, também faz `wrangler deploy` de produção desse Worker. As restrições adicionais possíveis são IP e TTL ([Restrict tokens](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/), 2026-04-20).

### 3.2 Deploy de bundle pré-compilado com `wrangler preview`

- **Fonte diz (código 4.151.1):** o `wrangler preview` aceita `[script]`, `--name`, `--tag`, `--message`, `--json`, `--ignore-base-config`, `--worker-name`, `--var` e `--secrets-file`. **Não há** `--no-bundle`, `--outdir`, `--assets` nem `--dry-run` ("`preview` has no `--dry-run`, so every invocation creates a Preview deployment"). O código passa `noBundle: previewConfig.no_bundle ?? false` e `assets: undefined`, então o diretório de assets vem do config ([`wrangler/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/preview/preview.ts)). A doc de comandos lista as mesmas opções, exceto `--var` e `--secrets-file` ([Wrangler commands › preview](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview), 2026-10-09).
- **Fonte diz:** com `no_bundle`, "Wrangler will not process your code" ([Bundling](https://developers.cloudflare.com/workers/wrangler/bundling/), 2026-04-23). O `find_additional_modules` vira `true` por padrão com `no_bundle` ([Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), 2026-10-17).
- **Caminho viável (inferência):**
  - a `main` mantém um config de deploy de preview (ex.: `wrangler.preview-deploy.jsonc`) com `name`, `compatibility_*`, `no_bundle: true`, `main` e `assets.directory` apontando para o diretório onde o job B extrai os artifacts, e o bloco `previews`;
  - o job B roda `wrangler preview --config wrangler.preview-deploy.jsonc --name pr-N`;
  - o job A gera o bundle com `wrangler deploy --dry-run --outdir out/worker`. "Compile a project without actually deploying", com `--outdir` "Path to directory where Wrangler will write the bundled Worker files" ([Wrangler commands › deploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy));
  - ou o job A usa o build do plugin Vite.
- **Armadilha do redirect:** o `preview` usa `useConfigRedirectIfAvailable: true`, ou seja, segue `.wrangler/deploy/config.json`, que é o arquivo que o plugin Vite gera apontando para um `wrangler.json` gerado (código acima; [Configuration › Generated configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)). **Divergência:** a doc não lista o `preview` entre os comandos que seguem o redirect. **Fonte diz (código):** com `--config` explícito, o redirect é ignorado (`if (config !== undefined) return { …, redirected: false }`) ([`workers-utils/src/config/config-helpers.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/workers-utils/src/config/config-helpers.ts)).
  - **Inferência:** o job B deve passar `--config` da `main` e nunca usar o `wrangler.json` gerado pelo build do PR, porque ele carrega bindings e vars escolhidos pelo PR. O código também recusa rodar se encontrar `.cloudflare/output` ("Cloudflare Build Output") no projeto ([`cf-build-output-guard.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/deployment-bundle/cf-build-output-guard.ts)).
- **Alternativa nova, em beta: CLI `cf`.** "Pass `--prebuilt` to deploy an existing `.cloudflare/output/v0/` directory without building. One CI job can build, and another can deploy the restored directory." Para o `cf previews deploy`: "With `--prebuilt`, Build Output must come from a preview build". "`cf` is in beta" ([Develop, build, and deploy](https://developers.cloudflare.com/cf/projects/), 2026-10-17; [Use cf in CI](https://developers.cloudflare.com/cf/ci/), 2026-09-29).
  - **Inferência:** o Build Output leva a configuração gerada a partir do `cloudflare.config.ts` **do PR**, com bindings incluídos. Usá-lo no job B devolve ao PR o controle dos bindings do preview. Exige migrar de `wrangler.jsonc` para `cloudflare.config.ts`. **Não recomendado agora.**

### 3.3 Bindings dos Previews e `base-config`

- **Fonte diz:** "Previews do not inherit production settings." Os bindings de storage (KV, D1, R2, Hyperdrive, Vectorize, Secrets Store…) precisam do mesmo nome em `previews`, "pointed at a Preview-safe resource". "`npx wrangler preview` uses the configuration file from your current branch as the source of truth." "Point Preview bindings at staging or test resources instead of production resources." ([Previews › Configuration](https://developers.cloudflare.com/workers/previews/configuration/), 2026-09-22)
- **Fonte diz:** "Service bindings from a Preview call the bound Worker's production deployment". DO e Containers ganham um namespace por Preview. KV, D1 e R2 só ficam isolados se apontarem para outro recurso ([Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/), 2026-09-22).
  - **Inferência:** quem controla o config do deploy pode apontar um binding de preview para o **recurso de produção**. O token Editor não precisa de permissão no recurso (3.1). Por isso o config usado no job B tem de ser o da `main`.
- **Base config:**
  - **Fonte diz (doc):** os secrets "set… once in the Previews Base configuration. Each new Preview receives those secrets when it is created… Later changes to Base secrets apply only to new Previews". O `--ignore-base-config`: "Only use settings from your Wrangler file, ignoring the Preview base config configured in the Cloudflare dashboard" ([Configuration](https://developers.cloudflare.com/workers/previews/configuration/); [Commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview)).
  - **Fonte diz (código):** a base config fica **no recurso do Worker** (`previews_base_config`), com `observability`, `logpush`, `limits`, `placement`, `cache`, `tail_consumers` e `env` (bindings e secrets). Ela é aplicada pelo servidor na criação do Preview, salvo `?ignore_base_config=true` ([`deploy-helpers/src/preview/api.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/preview/api.ts) L159-171, L212-230).
  - **Não documentado:** a precedência exata entre a base config e o bloco `previews` local num mesmo binding.
- **Inferência:** o Worker do preview **é código do PR** e roda com `vars`, secrets e bindings do Preview. Secrets de base config e a `DATABASE_URL` do branch são acessíveis ao agente via `fetch()` para fora. Só podem existir lá valores de baixo valor.

## 4. Neon

### 4.1 Tipos de API key

- **Fonte diz:** são três tipos ([Manage API keys](https://neon.com/docs/manage/api-keys)):

  | Tipo | Escopo |
  | --- | --- |
  | Personal | "All organization projects where the user is a member" |
  | Organization | "All projects within the organization"; "admin-level access" |
  | Project-scoped | "Single specified project"; só Admins da org criam |
- **Fonte diz (project-scoped):** tem "**Editor** access on their project, meaning they can read and modify project resources but **cannot** delete the project or manage who can access it". O CLI avisa: "it cannot create projects, mint API keys, or read any other project. **It can still change and delete everything inside that project.**" (mesma página)
- **Fonte diz:** o Editor por projeto pode "Get connection strings and run SQL in the SQL Editor" e "Create, edit, or delete branches, endpoints, databases, and Postgres roles". Já "Delete the project" exige Admin ([User permissions](https://neon.com/docs/manage/user-permissions)).
- **Resposta:** uma key project-scoped **não** se limita a branches. Ela lê as connection strings da produção e pode apagar ou resetar o branch de produção, salvo se ele for *protected*. Os [planos](https://neon.com/docs/introduction/plans) não restringem a key por plano. Organizações existem em todos os planos.
- **Fonte diz (protected branches):** não podem ser apagados nem resetados, e "Projects with protected branches cannot be deleted". "New passwords are automatically generated for Postgres roles on branches created from protected branches." Só nos planos **pagos** (Launch: 2; Scale: 5) ([Protected branches](https://neon.com/docs/guides/protected-branches)). "By default, Postgres roles on the child branch will have the same passwords as on the parent branch" (mesma página).
  - **Inferência:** no Free, o branch do PR herda a **mesma senha** da role da produção. A `DATABASE_URL` entregue ao preview, que é código do PR, revela essa senha. Só o hostname do endpoint difere. Mitigações:
    - criar uma role só no `preview-base` (as roles "are branch-scoped", ver [Roles](https://neon.com/docs/manage/roles)) e passar `role:` dela ao `create-branch-action`;
    - ou usar branch protegido (pago).

### 4.2 Branches schema-only

- **Fonte diz:** o recurso está em **Beta**. Funciona no Console e na API (`"init_source": "schema-only"`), e a API está "in beta". A mesma página se contradiz sobre o CLI: diz "Support for the Neon CLI will come in a future release" e logo depois mostra `neon branch create --schema-only` ([Schema-only branches](https://neon.com/docs/guides/branching-schema-only)).
- **Fonte diz:** um branch schema-only é **root branch**, sem pai e sem reset. Cota de root branches por projeto, contando o `main`: **Free 3**, Launch 5, Scale 25. No Free, todos os branches dividem 1 GB (mesma página). **Disponível no Free**, mas com no máximo 2 schema-only simultâneos.
- **Fonte diz:** o `create-branch-action` tem o input `branch_type`: "The type of branch to create, 'default' or 'schema-only'" ([`action.yml`](https://github.com/neondatabase/create-branch-action/blob/main/action.yml), v6.3.1).
- **Não documentado:** se o schema-only copia roles e senhas, e se copia o conteúdo de `drizzle.__drizzle_migrations`. Pela descrição ("copy only the database structure"), a tabela viria **vazia**, o que é inferência já registrada na pesquisa 05.

### 4.3 Privilégios da role dona e extensões com rede

- **Fonte diz:** as roles criadas por Console, API ou CLI, incluindo a do projeto, são membros de `neon_superuser`, que tem:
  - `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `REPLICATION`;
  - `pg_read_all_data`, `pg_create_subscription`, `pg_monitor`, `pg_signal_backend`.

  Não é superuser de verdade: "you can't connect using the Postgres `superuser` account". "You can think of roles with `neon_superuser` privileges as administrator roles." ([Roles](https://neon.com/docs/manage/roles))
- **Fonte diz (extensões):**
  - **`dblink` 1.2 e `postgres_fdw` 1.1/1.2 estão disponíveis** em PG14–18. As extensões suportadas se instalam com `CREATE EXTENSION`;
  - **`pg_net` e `http` (pgsql-http) não constam** da lista;
  - `pg_cron` existe; `plv8` está bloqueada.

  Fonte: [Postgres extensions](https://neon.com/docs/extensions/pg-extensions). O `dblink` "lets a Neon session connect to and query remote Postgres databases", com `dblink_connect('host=my_remote_host …')` ([dblink](https://neon.com/docs/extensions/dblink)).
- **Não documentado:** restrição de **saída** de rede das computes. A doc de IP Allow trata só de entrada (Scale).
- **Inferência, respondendo "a migration pode exfiltrar?":** sim. O SQL das migrations do PR roda com `neon_superuser` no branch e pode:
  1. `CREATE EXTENSION dblink` e enviar linhas para um Postgres externo do atacante, ou conectar a outro branch ou projeto **se tiver host e credenciais**. No Free, a senha é a mesma do pai (4.1);
  2. criar roles, `ALTER` e `DROP` à vontade, e usar `pg_cron` para persistir enquanto a compute estiver ativa.

  O código do Worker do PR já tem a mesma capacidade via `DATABASE_URL`. **Conclusão:** o branch do PR não pode ter dados reais, e as credenciais do branch não podem abrir outro branch.

## 5. Resend

- **Fonte diz:** `permission: full_access | sending_access`.
  - `full_access`: "Can create, delete, get, and update any resource."
  - `sending_access`: "Can only send emails. For Inboxes, it can call only Reply to Thread Email, Forward Thread Email, Create Draft and Send Draft. A key restricted to a domain can use only the inboxes on that domain."

  O `domain_id` restringe o envio a um domínio "only used when the `permission` is set to `sending_access`" ([Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key)). A permissão e o domínio só podem ser editados no Dashboard ([Manage API keys](https://resend.com/docs/dashboard/api-keys/introduction)).
- **Fonte diz:** o recebimento funciona no domínio verificado ou em "your account's Resend-managed `<id>.resend.app` subdomain" ([Receiving](https://resend.com/docs/dashboard/receiving/introduction)). "List Received Emails — Retrieve a list of received emails for the authenticated user" ([List Received Emails](https://resend.com/docs/api-reference/emails/list-received-emails)). A página não diz qual permissão o endpoint exige.
- **Inferência:** pela definição ("can only send emails"), ler e-mails recebidos exige **`full_access`**, que dá controle total da conta: criar e apagar keys e domínios, ler tudo o que foi enviado. Isso não deve ir para o job do Playwright, que é código do PR. Alternativas, todas não documentadas como padrão:
  - conta ou time Resend separado só para previews;
  - leitura feita por código da `main`, por exemplo no job B ou num endpoint de webhook [`email.received`](https://resend.com/docs/webhooks/emails/received), entregando ao E2E só o link de verificação.

## 6. Drizzle ORM v1 RC: aplicar migrations sem drizzle-kit e sem `drizzle.config.ts`

- **Fonte diz (doc):** é a "Option 4", migrations aplicadas em runtime: `import { migrate } from 'drizzle-orm/node-postgres/migrator'`. O fluxo é "read migration.sql files in migrations folder → fetch migration history from database → pick previously unapplied migrations → apply" ([Migrations](https://orm.drizzle.team/docs/migrations)). O exemplo da doc chama `migrate(db)` sem config, mas na rc.4 o tipo exige config (ver abaixo).
- **Fonte diz (código `drizzle-orm@1.0.0-rc.4`):**
  - **Assinatura:** `migrate(db: NodePgDatabase, config: MigrationConfig)`, com `MigrationConfig = { migrationsFolder: string; migrationsTable?: string; migrationsSchema?: string }` (`node-postgres/migrator.d.ts`, `migrator.d.ts`). Não lê `drizzle.config.ts` nem depende de `drizzle-kit`.
  - **Layout lido** (`migrator.js`, `readMigrationFiles`):
    - para cada subdiretório de `migrationsFolder`, lê **só** `<subdir>/migration.sql`. O `snapshot.json` é ignorado;
    - ordena por nome. Os 14 primeiros caracteres do nome (`YYYYMMDDHHMMSS`) viram `created_at`;
    - divide o arquivo em `--> statement-breakpoint` e calcula o hash `sha256` do arquivo;
    - se existir `meta/_journal.json` (formato 0.x), lança "You must upgrade drizzle-kit and run "drizzle-kit up"".
  - **Tabela de controle:**
    - `CREATE SCHEMA IF NOT EXISTS drizzle`;
    - `drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint, name text, applied_at timestamptz DEFAULT now())`;
    - para tabelas 0.x, adiciona `name` e `applied_at` (`up-migrations/pg.js`);
    - é configurável por `migrationsTable` e `migrationsSchema` (`pg-core/async/session.js` L136-172).
  - **Seleção:** `getMigrationsToRun` aplica as migrations locais cujo **`name`** (nome da pasta) não está na tabela. **O hash não é verificado**, então uma migration já aplicada e depois editada não roda de novo nem dá erro. Todas rodam numa única `db.transaction`, statement a statement, via `sql.raw` (`migrator.utils.js`, `session.js`).
- **Fonte diz (doc v1):** "removing journal.json; grouping SQL files and snapshots into separate migration folders" ([Upgrading to Drizzle v1](https://orm.drizzle.team/docs/upgrade-v1)). Na v1, a estrutura é `drizzle/<timestamp>_<nome>/{migration.sql, snapshot.json}` ([Migrations](https://orm.drizzle.team/docs/migrations)).
- **Inferência para o job B:**
  - um script da `main` (`node scripts/migrate-preview.mjs <dir>`) faz `migrate(drizzle(pool), { migrationsFolder: "$RUNNER_TEMP/pr/drizzle" })`, usando o `drizzle-orm` da `main`. Antes, valida que o artifact só tem diretórios `^\d{14}_[a-z0-9_]+$` contendo `migration.sql` (e `snapshot.json`);
  - isso tira o `drizzle.config.ts` e o `drizzle-kit` do PR do caminho. **O SQL continua sendo código do PR** (seção 4.3): a transação não o limita, e um `COMMIT;` no meio do arquivo também passa.
  - Com `reset-branch-action` antes de migrar (pesquisa 05), a edição de migration antiga deixa de ser problema.

---

## Pontos incertos ou não documentados

1. **GitHub:** a entrega ao runner **apenas** dos secrets referenciados no job é empírica (discussão comunitária), não doc oficial. O desenho recomendado não depende disso: usa environment.
2. **Forgejo:** a doc v16 diz que o token do `pull_request` não tem escrita e que o `pull_request_target` "lifts restrictions". O código diz escrita em todo PR não-fork e leitura em fork, inclusive no `pull_request_target`. Valem o código e um teste em instância real.
3. **Forgejo:** o broker OIDC e o *protected file patterns* são propostas não testadas. O segundo provavelmente recusa o **primeiro push** de branch novo, porque compara com a árvore vazia.
4. **Forgejo:** a escrita de cache sem isolamento no `pull_request_target` vem do código do runner v13.2.0. Um admin pode ter desligado o cache do runner.
5. **Cloudflare:**
   - não está documentado qual papel `wrangler preview`, `preview delete` e `preview secret` exigem, nem se Editor por Worker basta para criar e apagar Previews. Há relatos de bugs com tokens por Worker;
   - não há escopo "só previews";
   - o redirect `.wrangler/deploy/config.json` no `preview` está no código, mas não na doc;
   - `--var` e `--secrets-file` estão no código, mas não na doc.
6. **Cloudflare:** a precedência entre a base config do servidor e o bloco `previews` local não está documentada.
7. **Neon:**
   - schema-only e a API dele estão em beta;
   - não se sabe se roles, senhas e o conteúdo de `__drizzle_migrations` são copiados;
   - a restrição de saída de rede da compute não está documentada.
8. **Resend:** a permissão exigida pelo List/Retrieve Received Emails não está escrita. "Full access" é inferência pela definição de `sending_access`.
9. **Drizzle:** a v1 ainda é RC (rc.4; a rc.5 só existe em tags de preview). O `migrate()` não verifica hash, e a doc mostra `migrate(db)` sem config, divergindo do tipo da rc.4.
