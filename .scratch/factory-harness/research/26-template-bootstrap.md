# Bootstrap do template público: fatos de plataforma

Ticket: [26-template-bootstrap](../issues/26-template-bootstrap.md)
Pesquisado em: 2026-10-18

Versões e datas consultadas:
- GitHub Docs: fonte em `github/docs` (branch `main`) lida em 2026-10-18. Commits mais recentes dos arquivos usados: environments reusable em 2026-04-23, rulesets reusable em 2026-06-09, página de deployments/environments em 2026-07-16, PATs em 2026-07-30, Termos de Serviço em 2026-07-24 ("Effective date: April 27, 2026") e dados de permissões de fine-grained PAT em 2026-10-06.
- OpenAPI do GitHub (`github/rest-api-description`, `api.github.com.json`, versão 1.1.4), lido em 2026-10-18.
- `gh`: última release **v2.102.0** (2026-09-30). O código lido foi `cli/cli@trunk`. O `gh` local é o 2.93.0.
- `wrangler` **4.151.1** (npm, 2026-10-16). O código lido foi `cloudflare/workers-sdk@c4b18e1` (2026-10-18). A página de configuração dos docs é de 2026-10-17 e a de recursos de Previews, de 2026-09-22.
- Neon: docs com `updatedOn` 2026-10-09 (API keys, CLI) e 2026-10-13 (planos). CLI `neonctl` **8.8.0** (npm, 2026-10-16), que instala os binários `neon` e `neonctl`.
- Resend: docs `.md` lidos em 2026-10-18. As páginas não trazem data.
- Claude Code: docs `code.claude.com` lidos em 2026-10-18, sem data de revisão.

Legenda: **Fonte diz** = citação ou paráfrase direta. **Inferência** = conclusão minha. **Desconhecido** = não achei fonte primária, precisa de teste.

---

## Resumo para o bootstrap

1. **Uma cópia privada numa conta pessoal Free não tem environments, secrets de environment, proteção de branch nem rulesets.** Na cópia pública, tudo isso existe. Portanto, no privado, o isolamento de secrets tem que vir só dos jobs separados (ticket 19), e o Merge Gate vale por convenção, não por regra da forja.
2. **O fine-grained PAT do machine user não alcança um repo de outra conta pessoal em que ele é só colaborador.** Sobram três saídas:
   - **PAT classic** com `repo` e sem `workflow`;
   - pôr o repo numa **org Free**, onde o fine-grained PAT funciona, mas a org Free tem as mesmas limitações do privado;
   - **GitHub App**.

   Nenhum PAT pode ser criado por API. Só existe um link de criação pré-preenchido, e isso vale para o fine-grained.
3. **Aceitar o convite de colaborador por API exige token classic ou OAuth** (`repo` ou `repo:invite`). O `gh auth login` do machine user serve. O fine-grained PAT não aceita convite.
4. **O wrangler 4.x provisiona KV, R2 e D1 sem `id` no `wrangler deploy`.** Isso vem ligado por padrão. No CI, ele não grava o id no config, e os deploys seguintes **herdam pelo nome do binding no Worker já publicado**. O `wrangler preview` **não provisiona nada**: o KV do bloco `previews` precisa de `id`. Por isso o bootstrap tem que criar esse KV e gravar o id.
5. **Não há interpolação de variáveis de ambiente no config do wrangler.** O nome do Worker pode ser trocado por flag (`deploy --name`, `preview --worker-name`).
6. **O token da Cloudflare pode ser criado por API, mas só com um token "criador" feito no dashboard.** O workers.dev subdomain precisa existir antes do deploy no CI. Ele pode ser registrado por API, e o próprio token de deploy tem a permissão para isso.
7. **O Neon Free permite 100 projetos e 10 branches por projeto.** Projetos e as três espécies de API key podem ser criados pela CLI, depois de um `neon login` no browser. A key de projeto não cria nem apaga projetos, mas "change and delete everything inside that project".
8. **Sem domínio próprio, o Resend só entrega para o e-mail da conta.** O limite é de 100 e-mails por dia e 3.000 por mês. Domínios e API keys podem ser criados por API, e a key pode ser `sending_access` restrita a um domínio.
9. **O `claude setup-token` gera um token de 1 ano.** Ele exige plano Pro, Max, Team ou Enterprise e só faz requisições de modelo. Se as duas variáveis estiverem presentes, o `ANTHROPIC_API_KEY` vence.
10. **"Use this template" cria um repo com 1 commit e histórico não relacionado.** Já `git clone` seguido de `gh repo create --private --source . --push` preserva o histórico. Mas é preciso renomear o `origin` antes, senão o `gh` cria o repo e falha ao adicionar o remote.

---

## 1. GitHub Free: repo privado de conta pessoal

### (a) Environments, secrets e variáveis de environment

- **Fonte diz:** "Environments, environment secrets, and deployment protection rules are available in public repositories for all current GitHub plans. [...] For access to environments, environment secrets, and deployment branches in private or internal repositories, you must use GitHub Pro, GitHub Team, or GitHub Enterprise." — [reusable `gated-features/environments`](https://github.com/github/docs/blob/main/data/reusables/gated-features/environments.md), exibido em [Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- **Fonte diz:** "Users with GitHub Free plans can only configure environments for public repositories. If you convert a repository from public to private, any configured protection rules or environment secrets will be ignored, and you will not be able to configure any environments." — [Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- **Fonte diz:**
  - "If you are using GitHub Free, environment secrets are only available in public repositories."
  - "Environment variables are available for all public repositories. For users on GitHub Pro or GitHub Team plans, environment variables are also available for private repositories."

  — [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- **Repo secrets e variáveis** (não as de environment) não têm essa restrição de plano nas páginas de secrets e variáveis ([Using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)). **Inferência:** funcionam no privado Free.

### (b) Regras de proteção do environment e políticas de branch de deploy

- **Fonte diz:** required reviewers, wait timer, bypass de admin e custom rules "are only available for public repositories" nos planos Free, Pro e Team. "Deployment branches and tags are available for all public repositories. For users on GitHub Pro or GitHub Team plans, deployment branches and tags are also available for private repositories." — [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- **Conclusão:** num repo privado Free não existe **nenhuma** delas. No público, todas existem.

### (c) Proteção de branch e rulesets

- **Fonte diz:** "Protected branches are available in public repositories with GitHub Free and GitHub Free for organizations. Protected branches are also available in public and private repositories with GitHub Pro, GitHub Team, GitHub Enterprise Cloud, and GitHub Enterprise Server." — [reusable `gated-features/protected-branches`](https://github.com/github/docs/blob/main/data/reusables/gated-features/protected-branches.md), em [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- **Fonte diz:** "Rulesets are available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, and GitHub Enterprise Cloud." — [reusable `gated-features/repo-rules`](https://github.com/github/docs/blob/main/data/reusables/gated-features/repo-rules.md), em [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).
- **Conclusão:** num repo privado Free não há "required PR" nem "required status checks". No público, há os dois.

### Workflow com `environment: production` em repo privado Free

- **Fonte diz:** "Running a workflow that references an environment that does not exist will create an environment with the referenced name. [...] Otherwise, the newly created environment will not have any protection rules or secrets configured." — [Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- **Desconhecido:** nenhuma página diz o que acontece no **privado Free**, onde "you will not be able to configure any environments". O job pode rodar sem o environment (sem secrets de environment) ou pode falhar. **Precisa de teste.**
- **Recomendação:** o YAML do template não deve depender de `environment:` para receber secrets. Os secrets devem ficar no nível do repo.

### Minutos do Actions (contexto de custo)

- **Fonte diz:**
  - repo público: "usage is free";
  - privado no GitHub Free: **2.000 min/mês** e 500 MB de artifacts;
  - "If your account does not have a valid payment method on file, usage is blocked once you use up your quota."

  — [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) e [reusable de cotas](https://github.com/github/docs/blob/main/data/reusables/billing/actions-included-quotas.md).
- **Inferência:** sem cartão cadastrado, o privado nunca gera cobrança. A Factory só para quando os minutos acabam.

---

## 2. Machine user e token

### Termos de Serviço

- **Fonte diz:** "A machine account is an Account set up by an individual human who accepts the Terms on behalf of the Account, provides a valid email address, and is responsible for its actions. [...] You may maintain no more than one free machine account in addition to your free Personal Account." — [GitHub Terms of Service, B.3](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (vigente desde 2026-04-27).
- **Conclusão:** cada pessoa pode ter **uma** conta machine gratuita. Quem copiar o template e já tiver um machine user para outro projeto deve reaproveitá-lo.

### Fine-grained PAT num repo de outra conta pessoal (colaborador com write)

- **Fonte diz:** "Under **Resource owner**, select a resource owner. The token will only be able to access resources owned by the selected resource owner."
- **Fonte diz:** entre as lacunas maiores: "Using fine-grained personal access token to contribute to repositories where the user is an outside or repository collaborator."
- Fonte das duas: [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
- **Conclusão: não funciona.** O fine-grained PAT do machine user só alcança repos do próprio machine user ou de orgs de que ele é membro.

**Opções:**

1. **PAT classic com `repo`, sem `workflow`.**
   - **Fonte diz:** "Your personal access token (classic) can access every repository that you can access."
   - **Fonte diz:** o escopo `workflow` "Grants the ability to add and update GitHub Actions workflow files". Sem ele, o push de mudança em `.github/workflows/` é recusado, a menos que o mesmo arquivo exista em outro branch. — [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
   - **Inferência:** o alcance real é o conjunto de repos a que o machine user tem acesso. Se ele só for convidado para este repo, o efeito é parecido com o do fine-grained. Isso **mantém a decisão do ticket 16** ("token sem a permissão de workflows").
2. **Repo numa org Free, com o machine user como membro.** O fine-grained PAT passa a funcionar, com a org como resource owner. Pontos de atenção:
   - **Fonte diz:** por padrão, a org exige aprovação de admin para fine-grained PATs ("Require administrator approval [...] This is the default value"), e a vida máxima padrão do fine-grained é de 366 dias. — [PAT policy for your organization](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization).
   - **Fonte diz:** a org Free tem as **mesmas** limitações do privado: rulesets e proteção de branch só valem em repos públicos (§1c).
3. **GitHub App.** A App é gratuita, mas o ticket 12 já a descartou: ela não existe no Forgejo, e o `gh --attach` recusa token de App.

### Criar ou verificar o PAT por API ou `gh`

- **Criar:** não há endpoint. No OpenAPI só existem `/orgs/{org}/personal-access-tokens*` e `/orgs/{org}/personal-access-token-requests*`, que servem para a org revisar tokens, não para criá-los ([api.github.com.json](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json)). O que existe é **um link pré-preenchido** para o fine-grained: `https://github.com/settings/personal-access-tokens/new?name=…&target_name=…&expires_in=…&contents=write…`. O humano ainda clica em "Generate". — [Pre-filling fine-grained PAT details](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters).
- **Desconhecido:** não achei um link pré-preenchido equivalente para o **classic** nos docs.
- **Verificar:**
  - `GET /user` (`gh api user`) devolve o login do dono do token;
  - no classic, o header `X-OAuth-Scopes` lista os escopos ([Scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps));
  - no fine-grained, o header `X-Accepted-GitHub-Permissions` diz o que faltou num 403 ([Troubleshooting the REST API](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)).

  **Inferência:** um `GET /repos/{owner}/{repo}` com o token prova o acesso, e o campo `permissions.push` prova o write.

### Expiração

- **Fine-grained:**
  - **Fonte diz:** "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy set by your organization or enterprise owner."
  - **Fonte diz:** o parâmetro `expires_in` aceita "Integer between 1 and 366, or `none`".
  - Limite de 50 fine-grained PATs por usuário.

  — [Managing your PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
- **Classic:**
  - **Fonte diz:** "To give your token an expiration, select **Expiration**, then choose a default option or click **Custom**". A expiração é opcional, e "PATs (classic) do not have an expiration requirement" nas orgs.
  - **Fonte diz:** "GitHub automatically removes personal access tokens that haven't been used in a year."

  — mesma página e [PAT policy](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization).
- **Desconhecido:** o teto da data "Custom" do classic.

---

## 3. Cloudflare e wrangler (4.151.1)

### Auto-provisionamento no `wrangler deploy`

- **Fonte diz:** "Wrangler can automatically provision resources for you when you deploy your Worker [...] This currently works for the following resources: KV, R2, D1, Flagship, AI Search, Agent Memory, Dispatch Namespaces and Queues. To use this feature, add bindings to your configuration file _without_ adding resource IDs, or in the case of R2, a bucket name. Resources will be created with the name of your worker as the prefix." — [Configuration › Automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning).
- **Status:** os docs **não** usam a palavra beta. No código, a flag `--experimental-provision` (alias `--x-provision`) está oculta, descrita como "Experimental: Enable automatic resource provisioning" e com **`default: true`**. O mesmo vale para `--experimental-auto-create` — [`packages/wrangler/src/index.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/index.ts) e [`deploy-args.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/deployment-bundle/deploy-args.ts). **Inferência:** a função vem ligada por padrão, mas ainda carrega o rótulo "experimental" no código.
- **Como ele lembra o id** ([`provision-bindings.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/deploy/helpers/provision-bindings.ts)):
  - **Herança pelo Worker publicado:** antes de criar, o wrangler lê `GET /accounts/{id}/workers/scripts/{name}/settings`. Se o Worker já publicado tem um binding do mesmo tipo e **mesmo nome de binding**, ele herda o recurso e não cria outro (`canInherit`).
  - **Gravação no config:** só em execução interativa. O comentário do código diz: "If the user is performing an interactive deploy, write the provisioned IDs back to the config file. This is not necessary, as future deploys can use inherited resources". **No CI (`isNonInteractiveOrCI()`), nada é gravado.** A mensagem é "future deploys will continue to work even without IDs."
  - **Nome criado:** `<nome-do-worker>-<binding em minúsculas, com _ trocado por ->`. Exemplo: `app-oauth-kv` (`autoProvisionedResourceName`).
  - **Não procura por nome no KV:** o `KVHandler` não tem `name`, então não reaproveita um namespace existente com o mesmo título. **Desconhecido:** se o Worker for apagado e o deploy tentar recriar `app-oauth-kv`, a API pode recusar por título duplicado. Precisa de teste.
- **Docs, para o caso de deploy pelo dashboard:** "resources will be created, but their IDs will only be accessible via the dashboard."

### Previews (`wrangler preview`)

- **Fonte diz:** `kv_namespaces` "Binds to a KV namespace by `id`. Two Previews sharing the same `id` share namespace data." Só Durable Objects e Containers são "Automatically provisions … for each Preview". — [Previews › Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/).
- **Código:** o caminho do preview ([`deploy-helpers/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/preview/preview.ts)) **não chama** `provisionBindings`. Só o `deploy` e o `versions upload` chamam. A única coisa que ele "provisiona" é o **Worker pai**, se não existir ("Worker … does not exist yet. Would you like to create it for this Preview?", que vira `true` no CI). O KV do bloco `previews` vira `{ type: "kv_namespace", namespace_id: kv.id }` ([`preview/shared.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/preview/shared.ts)).
- **Desconhecido:** o erro exato quando falta o `id`. A validação aceita `id` ausente.
- **Conclusão:** o bootstrap precisa criar o KV dos previews (`wrangler kv namespace create <nome>` ou a API) e gravar o `id` em `previews.kv_namespaces` no config commitado da cópia. Ids de KV não são segredo.

### Trocar o nome do Worker sem editar o config

- `wrangler deploy --name <nome>` ("Name of the Worker") — [`deploy-args.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/deployment-bundle/deploy-args.ts).
- `wrangler preview --worker-name <nome>` ("Name of the Worker to target (defaults to the name in your local config file)") — [`wrangler/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/preview/preview.ts).
- Existe `WRANGLER_CI_OVERRIDE_NAME`, mas está marcado "(internal use)" e é do Workers Builds ([`environment-variables/factory.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/workers-utils/src/environment-variables/factory.ts)). **Não usar.**
- **Atenção:** o `--name` também muda o prefixo dos recursos auto-provisionados.

### Interpolação de variáveis de ambiente no config

- **Não existe.** O wrangler só procura `wrangler.toml`, `wrangler.json` e `wrangler.jsonc` ([`config-helpers.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/workers-utils/src/config/config-helpers.ts)). A página de configuração só cita variáveis de ambiente para `account_id` (`CLOUDFLARE_ACCOUNT_ID`) e `CLOUDFLARE_ENV` ([Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
- O pacote `@cloudflare/config` 0.27.0 (config programático) diz: "This is not yet stable enough for external use" ([package.json](https://github.com/cloudflare/workers-sdk/blob/main/packages/config/package.json)).
- **Inferência:** o bootstrap deve **reescrever o `wrangler.jsonc` da cópia uma vez** (nome, ids) e commitar. A alternativa é passar `--name` em todo comando. Renomear o produto a partir de uma variável só vira trabalho do script de bootstrap, não do wrangler.

### Criar o token da API da Cloudflare por API

- **Fonte diz:** "Before you can use the API, you need to generate an initial token via the Cloudflare dashboard. [...] To create account-owned API tokens, create a token with **Account** > **Account API Tokens** > **Edit**. To create user-owned API tokens, use the **Create additional tokens** template." Os endpoints são `POST /accounts/{account_id}/tokens` e `POST /user/tokens`, e os grupos de permissão vêm de `GET …/tokens/permission_groups`. — [Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/).
- **Fonte diz:** há template URLs que pré-preenchem o formulário do dashboard, mas "Users must still complete the token creation process in the dashboard." — [API token template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/).
- **Inferência:** criar o token por API exige que o humano primeiro crie no dashboard um token "criador", tão sensível quanto o próprio token. É mais simples o humano abrir uma template URL já com as permissões certas e colar o token resultante.

### Permissões para Workers, Previews, KV e DO

- **Fonte diz:** o template **"Edit Cloudflare Workers"** inclui Workers Routes Write (zone), **Workers Scripts Write**, **Workers KV Storage Write**, Workers Tail Read, Workers R2 Storage Write, **Account Settings Read**, User Details Read e User Memberships Read. — [API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/).
- **Fonte diz:** para previews no CI, o token precisa de "permission to edit Workers Scripts and the resources used by the Preview" ([Previews › Examples](https://developers.cloudflare.com/workers/previews/examples/), já citado na pesquisa 05).
- **Fonte diz:** a issue aberta [workers-sdk#15797](https://github.com/cloudflare/workers-sdk/issues/15797) (2026-09-23, ainda aberta em 2026-10-18) mostra que um token com papéis por Worker (Workers Editor + Individual Workers Editor) recebe `10000` no `POST …/previews`. Isso já foi registrado na pesquisa 19.
- **Inferência:** o template "Edit Cloudflare Workers" (com Workers Scripts Write na conta) cobre deploy, previews, KV e R2.
- **Desconhecido:** não achei grupo de permissão separado para Durable Objects. Pelo que entendi, eles vão junto com o script (Workers Scripts Write), mas não há fonte explícita.

### workers.dev subdomain

- **Código:** sem subdomain, o deploy para workers.dev avisa "You need to register a workers.dev subdomain before publishing to workers.dev". Em seguida pergunta "Would you like to register a workers.dev subdomain now?" com `fallbackValue: false`, ou seja, **no CI ele falha**. O registro automático só acontece quando o wrangler detecta um agente de IA (`autoRegisterWorkersDevSubdomain = detectedAgent.isAgent`). — [`triggers/subdomain.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/triggers/subdomain.ts) e [`wrangler/src/deploy/index.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/deploy/index.ts).
- **Fonte diz:** `PUT /accounts/{account_id}/workers/subdomain` com o body `{"subdomain": "…"}` exige **Workers Scripts Write**. — [Create a Workers Subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/update/).
- **Conclusão:** o bootstrap faz `GET` e, se vier 404, faz `PUT` com o próprio token de deploy.
- **Inferência:** as Preview URLs `*.workers.dev` também dependem do subdomain.

---

## 4. Neon Free

- **Limites:** "Free: 100 projects", "Free: 10 branches/project", "100 CU-hours/project/month", "1 GB of Postgres storage per project, up to 20 GB total". — [Plans](https://neon.com/docs/introduction/plans) (updatedOn 2026-10-13).
- **Inferência:** o projeto `<app>-preview` com o branch `base` aguenta no máximo uns 8 previews simultâneos, porque o branch padrão e o `base` contam no limite de 10. Isso vale levar para o ticket 05/19.
- **Toda conta tem org:** "When you sign up, you automatically get a free organization for your first project." — [Organizations](https://neon.com/docs/manage/organizations).
- **Criar projeto:** `neon projects create --name … [--region-id …] [--org-id …]` (o padrão é `aws-us-east-2` e Postgres 18) — [CLI projects](https://neon.com/docs/cli/projects). Pela API, `POST /projects` ([API reference](https://neon.com/docs/reference/api)).
- **Login sem colar key:** `neon login` abre o OAuth no browser e salva em `~/.config/neon/credentials.json`. A precedência é `--api-key` > `NEON_API_KEY` > arquivo > browser. — [CLI login](https://neon.com/docs/cli/login).
- **API keys** — [Manage API keys](https://neon.com/docs/manage/api-keys), [CLI api-keys](https://neon.com/docs/cli/api-keys):
  - **Pessoal:** criada no Console, com `neon api-keys create --name …` ou com `POST /api_keys`. "You'll need an existing personal key (create one from the Neon Console) in order to create new keys using the API."
  - **Org:** criada por admins da org, com `POST /organizations/{org_id}/api_keys` ou `--org-id`.
  - **De projeto:** criada por admins da org, com o mesmo endpoint mais `project_id`, ou `neon api-keys create --project-id …`. A CLI avisa: "Limited to some-project-123: it cannot create projects, mint API keys, or read any other project. It can still change and delete everything inside that project." Os docs acrescentam: "cannot delete the project or manage who can access it".
  - **Inferência:** a key de projeto cria e apaga branches daquele projeto, o que cabe no preview. Em compensação, ela também pode apagar o branch `base` e os dados dele.
  - **Expiração:** "Neon API keys don't expire or rotate on a schedule".
- **Conclusão:** depois de um `neon login` no browser, o bootstrap consegue criar os dois projetos e as duas keys de projeto **sem o humano colar nenhuma key**.

---

## 5. Resend Free

- **Sem domínio verificado:** "The `resend.dev` domain is only available for testing purposes and can only send emails to the email address associated with your Resend account." O erro é 403: "You can only send testing emails to your own email address". — [403 Error Using resend.dev Domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
- **Endereços de teste:** `delivered@resend.dev`, `bounced@resend.dev` e `complained@resend.dev` (com `+label`) simulam eventos e contam na cota ([Send Test Emails](https://resend.com/docs/dashboard/emails/send-test-emails)).
- **Desconhecido:** se esses endereços aceitam envio vindo de `onboarding@resend.dev` sem domínio verificado. A página não diz.
- **Limites do Free:**
  - "daily email quota of 100 emails/day and 3,000 emails/month", com reset à meia-noite UTC;
  - recebidos também contam;
  - até 3 domínios verificados;
  - 10 req/s **por time**, não por key.

  — [Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
- **API:**
  - `POST /domains` cria o domínio ([Create Domain](https://resend.com/docs/api-reference/domains/create-domain)). A verificação depende de registros DNS.
  - `POST /api-keys` aceita `permission: full_access | sending_access` e `domain_id`, que serve para "Restrict an API key to send emails only from a specific domain. This is only used when the `permission` is set to `sending_access`." ([Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key)).
  - Depois de criada, a key só pode ser renomeada pela API: "permission and domain can only be edited in the Dashboard" ([API keys](https://resend.com/docs/dashboard/api-keys/introduction)).
- **Inferência:** a primeira key (`full_access`) sai do dashboard. Com ela, o bootstrap cria as keys `sending_access` de produção e de preview. Sem domínio, a key de preview não tem como ser restrita a um domínio.

---

## 6. Autenticação do Claude no CI

- **Fonte diz:** "generate a one-year OAuth token with `claude setup-token` [...] It does not save the token anywhere; copy it and set it as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable". "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. It can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors. MCP servers you configure locally still work." — [Authentication › Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).
- **Precedência:** `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` > profiles > `/login`. Em `-p`, "the key is always used when present". O `--bare` não lê o `CLAUDE_CODE_OAUTH_TOKEN`. — mesma página, [Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence).
- **Fonte diz:** "an OAuth token is tied to the subscription of the person who ran `claude setup-token`". Para secret compartilhado entre repos, os docs recomendam API key do Console. — [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions).
- **Política da assinatura:** o pause de 2026-06-15 mantém "`claude -p` [...] still draw from your subscription limits". Em 2026-10-07, os planos Max e Team ganharam créditos mensais de API, e "You can still use the Claude Agent SDK, `claude -p` [...] with your subscription limits." O artigo não fala de CI. — [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).
- **Para o bootstrap:**
  - aceitar **um dos dois** secrets;
  - avisar que o `ANTHROPIC_API_KEY` vence se os dois existirem;
  - lembrar a renovação anual do OAuth token. **Inferência:** a data de expiração não é exposta pela CLI segundo os docs, então o bootstrap deve anotar a data de criação.

---

## 7. "Use this template" × `git clone` + push

- **Fonte diz:** "a repository created from a template starts with a single commit." "Branches created from a template have unrelated histories, which means you cannot create pull requests or merge between the branches." — [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).
- **Fonte diz:** "By default, `git merge` command refuses to merge histories that do not share a common ancestor." — [git merge-options, `--allow-unrelated-histories`](https://github.com/git/git/blob/master/Documentation/merge-options.adoc).
- **Conclusão:** com o template, o `git merge upstream/main` exige `--allow-unrelated-histories`, e o primeiro merge conflita em todo arquivo que mudou dos dois lados. Com `clone` + push, o histórico é compartilhado e o merge é normal. Isso importa para o [ticket 28](../issues/28-upstream-skeleton-sync.md).
- **Um comando só?** `gh repo create <nome> --private --source . --push` cria o repo, adiciona o remote e faz `git push <remote> HEAD`. Detalhes ([manual](https://cli.github.com/manual/gh_repo_create) e [`create.go`](https://github.com/cli/cli/blob/trunk/pkg/cmd/repo/create/create.go)):
  - o remote padrão é `origin`. Num clone do template, `origin` já existe, e o `sourceInit` falha com "Unable to add remote "origin"" **depois de o repo já ter sido criado**;
  - o push é só do branch atual (`HEAD`), não de todos.
- **Sequência que funciona:**

  ```sh
  git clone https://github.com/<dono>/Factory-Template app && cd app
  git remote rename origin upstream
  gh repo create <app> --private --source . --push
  ```

- **Alternativa por API:** `POST /repos/{template_owner}/{template_repo}/generate` (`private`, `include_all_branches`) é o "Use this template" ([OpenAPI](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json)). Gera o histórico não relacionado.

---

## 8. Configurar o repo por `gh`/REST com o token do dono, e o aceite do convite

Fonte da tabela: [REST docs](https://docs.github.com/en/rest) e [dados de endpoints de fine-grained PAT](https://github.com/github/docs/blob/main/src/github-apps/data/fpt-2022-11-28/fine-grained-pat.json) (2026-10-06).

| Item | Comando ou endpoint | Privado Free | Público |
| --- | --- | --- | --- |
| Secrets do repo | `gh secret set NAME --body …` | sim | sim |
| Variáveis do repo | `gh variable set NAME --body …` | sim | sim |
| Labels | `gh label create`, ou `gh label clone` de outro repo | sim | sim |
| Environments | `gh api -X PUT repos/{o}/{r}/environments/{env}` (não há subcomando `gh`) | **não** (§1a) | sim |
| Secrets de environment | `gh secret set --env …` | **não** | sim |
| Rulesets | `gh api -X POST repos/{o}/{r}/rulesets` (o `gh ruleset` só tem `list`, `view` e `check`, também na v2.102.0) | **não** (§1c) | sim |
| Convite de colaborador | `gh api -X PUT repos/{o}/{r}/collaborators/{user}` | sim | sim |

- **Fonte diz:** o `permission` do convite é "Only valid on organization-owned repositories". "You are limited to sending 50 invitations to a repository per 24 hour period." — [Collaborators](https://docs.github.com/en/rest/collaborators/collaborators).
- **Inferência:** em repo pessoal, o colaborador sempre recebe write. Isso basta para o machine user.
- **Desconhecido:** a resposta exata da API ao criar environment ou ruleset num privado Free (403 ou 422). Precisa de teste. O script deve detectar a visibilidade e pular esses passos.

### Aceite do convite pelo machine user

- **Endpoint:** `PATCH /user/repository_invitations/{invitation_id}`. O id vem de `GET /user/repository_invitations` — [Invitations](https://docs.github.com/en/rest/collaborators/invitations).
- **Fonte diz:** nos dados oficiais de endpoints aceitos por fine-grained PAT, `/user/repository_invitations` aparece só com `GET` (listar) e `DELETE` (recusar). O **`PATCH` (aceitar) não aparece**. Com token de usuário de GitHub App, os três aparecem ([`user-to-server-rest.json`](https://github.com/github/docs/blob/main/src/github-apps/data/fpt-2022-11-28/user-to-server-rest.json)).
- **Fonte diz:** o escopo classic `repo:invite` "Grants accept/decline abilities for invitations", e o escopo `repo` também cobre convites ([Scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)).
- **Conclusão:** o machine user aceita o convite com o **PAT classic** (o mesmo `FACTORY_TOKEN` com `repo`) ou com o `gh auth login` dele.

  ```sh
  GH_TOKEN=$FACTORY_TOKEN gh api -X PATCH /user/repository_invitations/$(GH_TOKEN=$FACTORY_TOKEN gh api /user/repository_invitations --jq '.[] | select(.repository.full_name=="<dono>/<app>") | .id')
  ```

  O fine-grained não serve. De qualquer forma, ele não alcançaria o repo (§2).

---

## Pontos em aberto (precisam de teste)

1. O que um job com `environment: production` faz num repo **privado Free**: roda sem environment ou falha (§1).
2. A resposta da API ao criar environment ou ruleset no privado Free (§8).
3. O teto da data "Custom" do PAT classic, e se existe link pré-preenchido para criá-lo (§2).
4. O `wrangler preview` com KV sem `id` no bloco `previews`: o erro exato (§3).
5. O reprovisionamento de KV quando o Worker foi apagado e já existe um namespace com o título `<worker>-<binding>` (§3).
6. A permissão de token exata para Durable Objects. A inferência é que Workers Scripts Write basta (§3).
7. Se `delivered@resend.dev` aceita envio de `onboarding@resend.dev` sem domínio verificado (§5).
