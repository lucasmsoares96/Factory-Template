# Bootstrap na nuvem: Cloudflare, Neon e Resend

Ticket: [26-template-bootstrap](../issues/26-template-bootstrap.md)
Pesquisado em: 2026-10-18. Esta nota **reverifica e aprofunda** a parte de nuvem de [26-template-bootstrap.md](26-template-bootstrap.md) (§3 a §5). Onde as duas divergem, vale esta.

Versões e datas consultadas:
- **wrangler 4.151.1** (npm, 2026-10-16). Código lido em `cloudflare/workers-sdk@c4b18e1` (main, 2026-10-18T15:26Z). `packages/wrangler/CHANGELOG.md` lido no `main` do mesmo dia.
- **Docs da Cloudflare** (datas "Last updated" de cada página):
  - [Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/): 2026-10-17
  - [Commands › Workers](https://developers.cloudflare.com/workers/wrangler/commands/workers/): 2026-10-18
  - [Previews](https://developers.cloudflare.com/workers/previews/): 2026-09-24
  - [Previews › Resources](https://developers.cloudflare.com/workers/previews/resources/): 2026-09-22
  - [Previews › Configuration](https://developers.cloudflare.com/workers/previews/configuration/): 2026-09-22
  - [Previews › Examples](https://developers.cloudflare.com/workers/previews/examples/): 2026-10-01
  - [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/): 2026-09-22
  - [Authorization](https://developers.cloudflare.com/workers/authorization/), [Authorization › Workers](https://developers.cloudflare.com/workers/authorization/workers/) e [Authorization › Durable Objects](https://developers.cloudflare.com/workers/authorization/durable-objects/): 2026-09-15
  - [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/): 2026-10-18
  - [API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/): 2026-04-20
  - [Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/): 2026-09-28
  - [Template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/): 2025-01-14
  - [Permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/): 2026-10-12
  - [Account-owned tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/): 2026-09-28
  - [Verify email](https://developers.cloudflare.com/fundamentals/user-profiles/verify-email-address/): 2026-04-20
  - [Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/): 2026-06-25
  - [Vite programmatic config](https://developers.cloudflare.com/workers/vite-plugin/reference/programmatic-configuration/): 2026-04-23
- **OpenAPI da Cloudflare:** [`cloudflare/api-schemas`](https://github.com/cloudflare/api-schemas) `main@e91e65b` (2026-10-17). Dele vem o campo `x-api-token-group`, que lista as permissões aceitas por endpoint.
- **Neon:** docs `.md` lidos em 2026-10-18. As datas são do último commit da fonte em [`neondatabase/website`](https://github.com/neondatabase/website):
  - plans: 2026-10-14
  - api-keys, CLI (projects, branches, api-keys, login): 2026-10-09
  - organizations e GitHub integration: 2026-09-18
  - user-permissions: 2026-08-07

  Também foram lidos a OpenAPI [`v2.json`](https://neon.com/api_spec/release/v2.json) (2026-10-18) e o CLI `neonctl` **8.8.0**.
- **Resend:** docs `.md` lidos em 2026-10-18 (as páginas não trazem data) e a página [pricing](https://resend.com/pricing) (sem data).

Legenda: **Fonte diz** = citação ou paráfrase direta. **Inferência** = conclusão minha. **Ambíguo/Desconhecido** = sem fonte primária clara, precisa de teste.

---

## Veredictos

1. **Resend sem domínio próprio não serve para produção.** Com `onboarding@resend.dev`, o Resend só entrega para o e-mail do dono da conta. Não existe domínio de envio gratuito compartilhado. O Free dá 100 e-mails por dia, 3.000 por mês e 3 domínios. **Com sign-up e convites, o domínio próprio é obrigatório na prática** para a produção. Para preview e dev, dá para viver sem ele.
2. **Auto-provisionamento é GA** desde o wrangler 4.113.0 (2026-07-21). Ele vem ligado por padrão desde o 4.45.0. KV, R2 e D1 declarados sem `id` são criados no `wrangler deploy`, com o nome `<worker>-<binding>`. **No CI nada é gravado no config**: os deploys seguintes herdam o recurso pelo nome do binding no Worker publicado. **O `wrangler preview` não provisiona nada**, então o KV do bloco `previews` precisa de `id` explícito.
3. **Não há interpolação de env var no config do wrangler.** Há três formas de trocar o nome:
   - as flags `wrangler deploy --name`, `wrangler preview --worker-name` (o `--name` do preview é o **nome do Preview**, `pr-N`) e `--worker-name` nos subcomandos `preview secret`/`base-config`;
   - `--config` apontando para um arquivo gerado;
   - a opção `config` do `@cloudflare/vite-plugin`.
4. **Conta nova pode não ter workers.dev subdomain.**
   - O wrangler trata isso. No terminal interativo, ele pergunta se deve registrar. No CI, falha.
   - O registro é `PUT /accounts/{id}/workers/subdomain`, com Workers Scripts Write. O OAuth do `wrangler login` também cobre.
   - Previews funcionam no Free: 100 Previews por Worker.
5. **O token de CI usa o template "Edit Cloudflare Workers"**, que cobre deploy, KV, R2, assets, DO e subdomain. Há porém **ambiguidade na permissão de `POST …/previews`**: a OpenAPI não lista grupo para esse endpoint, e a issue aberta [#15797](https://github.com/cloudflare/workers-sdk/issues/15797) mostra que o novo papel "Workers Editor" falha. Criar token por API exige um token "criador" feito no dashboard. O `wrangler login` basta para o bootstrap local, mas não cria tokens. `CLOUDFLARE_ACCOUNT_ID` é necessário no CI.
6. **Neon Free:** 100 projetos e 10 branches por projeto.
   - Toda conta tem uma org automática, da qual o dono é Admin. Então **key de projeto existe no Free pessoal** e pode ser criada via `neon api-keys create --project-id` depois de `neon login` (OAuth).
   - A key de projeto cria e apaga branches e lê connection strings, mas também pode apagar o `base`, porque protected branches são só de planos pagos.
   - Nomes de projeto não são únicos: o idempotente é procurar com `GET /projects?search=`.
   - A integração GitHub do Neon gera uma key **pessoal** (acesso a tudo). **Não serve** para o isolamento pedido.
7. **Passos manuais inevitáveis:**
   - Cloudflare: signup, verificar o e-mail e criar o token no dashboard.
   - Neon: signup.
   - Resend: signup, a primeira API key no dashboard, e comprar o domínio e pôr o DNS.

---

## 1. Resend Free sem domínio verificado

- **Fonte diz:** "The `resend.dev` domain is only available for testing purposes and can only send emails to the email address associated with your Resend account." O erro é 403: "You can only send testing emails to your own email address (…). To send emails to other recipients, please verify a domain…" — [403 Error Using resend.dev Domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
- **Fonte diz:** "Resend sends emails using a domain you own (i.e., not a shared or public domain). You must add and verify at least one domain to send emails with Resend." — [Verified Domains](https://resend.com/docs/dashboard/domains/introduction). E também: "If you don't own a domain, please purchase one from a domain registrar…" — [Add and verify a domain](https://resend.com/docs/add-a-domain).
- **Domínio grátis:** nem a página de pricing nem os docs oferecem domínio de envio gerenciado ou compartilhado. A pricing só fala em "shared IPs", não em domínios — [Pricing](https://resend.com/pricing). **Conclusão:** não existe.
- **Endereços de teste:** `delivered@`, `bounced@` e `complained@resend.dev`, que aceitam `+label`, simulam eventos e "count against your account's sending quota" — [Send Test Emails](https://resend.com/docs/dashboard/emails/send-test-emails).
  - **Ambíguo:** a página não diz se esses endereços aceitam envio a partir de `onboarding@resend.dev` sem domínio. Se aceitarem, previews e E2E rodam sem domínio. Precisa de teste.
- **Limites do Free:**
  - 100 e-mails por dia e 3.000 por mês. O dia é UTC, e e-mails recebidos e cada destinatário em To, CC ou BCC também contam.
  - Até 3 domínios verificados.
  - 10 req/s **por time**.

  Fontes: [Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits) e [Pricing](https://resend.com/pricing) ("Free: 100 emails a day, 3 domains, 3 inboxes … 30-day data retention").
- **Verificação do domínio:** por DNS (DKIM e SPF via TXT, mais MX ou CNAME). "often verify within 15 minutes … can occasionally take up to 72 hours". Com a Cloudflare como DNS, o CNAME **não** pode ficar com proxy (nuvem laranja). Fonte: [Add and verify a domain](https://resend.com/docs/add-a-domain). Domínios podem ser criados por API, CLI ou MCP. Os registros DNS continuam por conta do humano, ou de um token de DNS da zona, que não foi pesquisado aqui.
- **Keys:**
  - `POST /api-keys` aceita `permission: full_access | sending_access` e `domain_id`, este só com `sending_access` — [Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key).
  - Depois de criada a key, "permission and domain can only be edited in the Dashboard" — [API keys](https://resend.com/docs/dashboard/api-keys/introduction).
  - O `resend login` do CLI **só guarda uma API key colada**. Não há OAuth — [CLI › Authentication](https://resend.com/docs/cli).
  - **Inferência:** a primeira key `full_access` sai do dashboard. Com ela, o bootstrap cria as keys `sending_access` de produção e de preview.

**Conclusão para o Skeleton:** sign-up com verificação e convites para terceiros **exigem um domínio verificado** em produção. Em preview, a saída é mandar só para o e-mail do dono ou para `delivered+…@resend.dev` (falta testar), ou nem enviar e capturar o e-mail. O "domínio opcional" só é verdade para um produto que não manda e-mail para terceiros.

---

## 2. Auto-provisionamento do wrangler

- **Fonte diz:** "This currently works for the following resources: KV, R2, D1, Flagship, AI Search, Agent Memory, Dispatch Namespaces and Queues. To use this feature, add bindings to your configuration file *without* adding resource IDs, or in the case of R2, a bucket name. Resources will be created with the name of your worker as the prefix." — [Configuration › Automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning).
- **Status e versão** ([CHANGELOG do wrangler](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/CHANGELOG.md)):
  - **4.45.0** (2025-10-23), PR [#11030](https://github.com/cloudflare/workers-sdk/pull/11030): "Enable automatic resource provisioning by default … still an experimental feature … disable … `--no-x-provision`. It currently works for R2, D1, and KV".
  - **4.113.0** (2026-07-21), PRs [#13352](https://github.com/cloudflare/workers-sdk/pull/13352) ("GA automatic resource provisioning") e [#14744](https://github.com/cloudflare/workers-sdk/pull/14744) ("now that automatic provisioning is generally available").
  - **4.129.0:** se a checagem do recurso devolver 403, o wrangler "skips automatic provisioning for that resource type and continues the deploy".
  - No código atual, a flag oculta `experimental-provision` continua com `default: true` — [`wrangler/src/index.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/wrangler/src/index.ts).
- **Onde o id fica** ([`provision-bindings.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/deploy-helpers/src/deploy/helpers/provision-bindings.ts)):
  - **Herança:** o `KVHandler.canInherit` procura, nas settings do Worker já publicado, um binding do mesmo tipo e **mesmo nome de binding**. Se acha, reusa o namespace. **O KV não é procurado pelo título** (`get name()` devolve `undefined`). Já o D1 e outros têm `name` e podem "connect to an existing named resource" (PR #13352).
  - **Write-back:** "If the user is performing an interactive deploy, write the provisioned IDs back to the config file. This is not necessary, as future deploys can use inherited resources". Isso fica sob `!isNonInteractiveOrCI()`. No CI, a mensagem é "future deploys will continue to work even without IDs."
  - **Ambíguo:** a página de Configuration diz, sem ressalva, "their IDs will be written back to your configuration file". O código mostra que isso só acontece fora do CI.
  - **Com config redirecionado (Vite):** desde o 4.150.0, grava "to both the redirected and original config files" ([#15517](https://github.com/cloudflare/workers-sdk/pull/15517)), mas também só no modo interativo.
  - **Nome criado:** `autoProvisionedResourceName(scriptName, binding)`, ou seja, `<worker>-<binding>`, com o nome do binding em minúsculas e `_` trocado por `-`. Com `--name`, o prefixo muda junto.
- **Para o CI efêmero:** o primeiro deploy cria `<app>-oauth-kv`. Os seguintes herdam pelo binding `OAUTH_KV` do Worker publicado. Assim o **KV de produção dispensa `id` no repo**.
  - **Risco (inferência):** se o Worker for apagado, o próximo deploy tenta criar um namespace com o mesmo título. O comportamento da API com título duplicado não foi verificado.
- **Previews:**
  - **Fonte diz:** `kv_namespaces` "Binds to a KV namespace by `id`". Só DO e Containers são "Automatically provisions … for each Preview" — [Previews › Resources](https://developers.cloudflare.com/workers/previews/resources/).
  - **Código:** o caminho do preview ([`deploy-helpers/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/deploy-helpers/src/preview/preview.ts)) não chama `provisionBindings`. A única coisa que ele provisiona é o **Worker pai** (`provisionParentWorker`, com `fallbackValue: true` no CI).
  - O `extractConfigBindings` monta `{ type: "kv_namespace", namespace_id: kv.id }` **sem** omitir o binding sem id ([`preview/shared.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/deploy-helpers/src/preview/shared.ts), linhas 466–470 e 720–722). **Desconhecido:** o erro exato da API nesse caso.
  - O `wrangler deploy` não envia o bloco `previews`. `previews_base_config` só aparece no código de preview ([`preview/api.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/deploy-helpers/src/preview/api.ts)).
  - **Conclusão:** o bootstrap cria o KV de preview (`wrangler kv namespace create <app>-preview-oauth-kv`) e o `id` precisa chegar ao bloco `previews` (ver §3 para como fazer isso sem editar arquivo do upstream).

---

## 3. Nome do Worker sem editar arquivo do template

- **`deploy`:** `--name` "Name of the Worker" — [`deploy-args.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/wrangler/src/deployment-bundle/deploy-args.ts) e [Commands › deploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy).
- **`preview`:**
  - `--name` é o **nome do Preview** ("Defaults to the current git branch").
  - `--worker-name` é o "Name of the Worker to target (defaults to the name in your local config file)".
  - O mesmo `--worker-name` existe em `preview delete`, `preview secret *` e `preview base-config secret *`.
  - Fontes: [Commands › preview](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview) e [`wrangler/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/wrangler/src/preview/preview.ts).
- **Interpolação de env var:**
  - **Não encontrei.** O loader só procura `wrangler.json`, `wrangler.jsonc` e `wrangler.toml` ([`config-helpers.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/workers-utils/src/config/config-helpers.ts)).
  - A página de Configuration só cita env vars para `account_id` (`CLOUDFLARE_ACCOUNT_ID`) e `CLOUDFLARE_ENV` (Vite).
  - **Inferência** (ausência de evidência, não negação explícita): não existe.
- **`--config` com arquivo gerado:** é flag global. Os caminhos do config são relativos ao próprio arquivo ("relative to your Wrangler config file", por exemplo `assets.directory`) — [Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/). **Inferência:** um gerador que escreve `wrangler.generated.jsonc` (gitignored) **no mesmo diretório**, a partir do `wrangler.jsonc` do template mais um arquivo do produto (nome e ids), funciona com `deploy` e `preview`.
- **Config redirecionado (`.wrangler/deploy/config.json`):**
  - A doc lista só `deploy`, `dev` e `versions *`.
  - Mas o `wrangler preview` também chama `useConfigRedirectIfAvailable: true` ([`wrangler/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/wrangler/src/preview/preview.ts), linha 77).
  - **Ambíguo:** doc e código divergem para o preview.
- **`@cloudflare/vite-plugin`:**
  - A opção `config` ("Customize or override Worker configuration programmatically… object or a function") é aplicada depois do arquivo e entra no config gerado no build — [Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/).
  - Ressalvas da [Programmatic configuration](https://developers.cloudflare.com/workers/vite-plugin/reference/programmatic-configuration/):
    - "primarily designed for use by frameworks and plugin developers";
    - "will not be included when running `wrangler types` or resource based Wrangler CLI commands such as `wrangler kv`".
  - Sem arquivo de config, "The `name` comes from `package.json`".
  - **Inferência:** o `vite.config.ts` do template pode ler `APP_NAME` e os ids de um arquivo do produto (por exemplo `product.json`, que o upstream nunca toca) e injetar `name` e `previews.kv_namespaces`. **Desconhecido:** se `config` aceita a chave `previews`. Precisa de teste.
- **`WRANGLER_CI_OVERRIDE_NAME`** existe, mas é "(internal use)" do Workers Builds. Não usar (já registrado na pesquisa 26 anterior).
- **Base config do dashboard:**
  - O `wrangler preview` mescla, no servidor, a "Preview base config configured in the Cloudflare dashboard" (flag `--ignore-base-config`).
  - A doc pede para copiar a config gerada no dashboard para o arquivo ([Previews › Configuration](https://developers.cloudflare.com/workers/previews/configuration/#dashboard-configuration)).
  - **Desconhecido:** se um binding KV posto só na base config (via `PATCH /workers/workers/{name}` com `previews_base_config`) chega ao Preview sem estar no arquivo. Seria outro jeito de tirar o `id` do repo, mas precisa de teste.

**Recomendação (inferência):**
- Uma variável `APP_NAME`, guardada num arquivo do produto ou numa GitHub variable.
- Os scripts do template passam `--name "$APP_NAME"` e `--worker-name "$APP_NAME"`.
- O KV de produção fica sem id (auto-provisionado).
- O id do KV de preview vem do mesmo arquivo do produto, injetado por config gerado ou pela opção `config` do Vite.
- O `name` no `wrangler.jsonc` do template fica como placeholder (por exemplo `skeleton`), usado só no dev local.

---

## 4. workers.dev subdomain e Previews no Free

- **Fonte diz:** "Cloudflare Workers accounts come with a `workers.dev` subdomain that is configurable in the Cloudflare dashboard." — [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
- **Código:**
  - `GET /accounts/{id}/workers/subdomain`. O erro `10007` significa "not found": o wrangler avisa "You need to register a workers.dev subdomain…" e pergunta "Would you like to register a workers.dev subdomain now?" com `fallbackValue: false`. Então **no CI ele falha**, e no terminal ele registra.
  - O auto-registro sem pergunta só acontece quando o wrangler detecta um agente de IA (`autoRegisterWorkersDevSubdomain = detectedAgent.isAgent`).
  - Fontes: [`triggers/subdomain.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/deploy-helpers/src/triggers/subdomain.ts) e [`wrangler/src/deploy/index.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/wrangler/src/deploy/index.ts), linha 216.
- **Ambíguo:** a doc diz que a conta "come with" um subdomain, mas o código trata a ausência. **Inferência:** conta nova pode não ter um até alguém abrir Workers no dashboard ou registrar. O bootstrap deve fazer `GET` e, se vier 404/10007, `PUT`.
- **API:** `PUT /accounts/{account_id}/workers/subdomain` ("Create a Workers Subdomain") aceita **Workers Scripts Write** (OpenAPI, `x-api-token-group`). O OAuth do wrangler tem `workers_scripts:write`: "…scripts, durable objects, subdomains, triggers…" ([`workers-auth/src/core/scopes.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/workers-auth/src/core/scopes.ts)). Logo, um `wrangler deploy` interativo após `wrangler login` resolve.
- **Previews no Free:**
  - Limites: Free com 100 Previews por Worker e 100 deployments por Preview. O mais antigo é apagado automaticamente.
  - URL: `<preview-name>-<worker-name>.<subdomain>.workers.dev`, com `X-Robots-Tag: noindex`.
  - Exige wrangler ≥ 4.135.0.
  - Fonte: [Previews](https://developers.cloudflare.com/workers/previews/).
- `preview_urls`: "If no setting exists, its initial value depends on `workers_dev`", que é `true` sem routes — [Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/). **Inferência:** as Preview URLs dependem do subdomain registrado.

---

## 5. Token da Cloudflare para o CI

- **Doc do CI:** "Account API tokens" → Create Token → template **Edit Cloudflare Workers**. "Wrangler requires a Cloudflare API token and account ID". Os secrets são `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` — [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) e [Previews › Examples](https://developers.cloudflare.com/workers/previews/examples/) ("The API token needs permission to edit Workers Scripts and the resources used by the Preview").
- **Template "Edit Cloudflare Workers"** — [API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/):
  - Workers Routes Write (zone);
  - Workers Scripts Write;
  - Workers KV Storage Write;
  - Workers Tail Read;
  - Workers R2 Storage Write;
  - Account Settings Read;
  - User Details Read;
  - User Memberships Read.
- **Permissões por endpoint** (OpenAPI `api-schemas@e91e65b`):

  | Operação | Endpoint | Grupos aceitos |
  |---|---|---|
  | Upload do script (deploy) | `PUT /workers/scripts/{name}` | Workers Scripts Write, Workers Admin/Editor, Individual Workers Admin/Editor |
  | Assets | `POST /workers/scripts/{name}/assets-upload-session` | Workers Scripts Write |
  | Criar KV (auto-provisionamento) | `POST /storage/kv/namespaces` | Workers KV Storage Write |
  | workers.dev subdomain | `PUT /workers/subdomain` | Workers Scripts Write |
  | Base config (`preview base-config secret put`) | `PATCH /workers/workers/{name}` com `previews_base_config` ([`preview/api.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/deploy-helpers/src/preview/api.ts)) | Workers Scripts Write, Workers Admin/Editor, Individual Workers Admin/Editor |
  | Apagar preview | `DELETE /workers/workers/{id}/previews/{id}` | Workers Scripts Write |
  | **Criar preview** | `POST /workers/workers/{id}/previews` e `POST …/previews/{id}/deployments` | **nenhum grupo listado** |

  **Inferência:** o base config exige que o Worker já exista, então o bootstrap faz o primeiro deploy antes de pôr secrets de preview.
- **Ambiguidade dos previews:**
  - Na issue aberta [workers-sdk#15797](https://github.com/cloudflare/workers-sdk/issues/15797) (wrangler 4.136.1, sem resposta humana até 2026-10-18), um token account-owned com **Workers Editor** + Individual Workers Editor/Admin recebe `10000` em `POST …/previews`. O mesmo projeto funciona com o OAuth do `wrangler login`.
  - **Inferência:** o legado **Workers Scripts Write** (o do template) é o caminho mais provável. Precisa de teste com uma conta nova.
- **Novo modelo de papéis:**
  - "Workers Scripts Edit" legado = `Editor` no escopo do produto Workers.
  - `Editor` "Cannot create or delete Workers"; criar Worker exige `Admin` no produto.
  - Criar namespace KV exige `Admin` com escopo que inclua KV.
  - Fontes: [Authorization › Workers](https://developers.cloudflare.com/workers/authorization/workers/) e [Authorization](https://developers.cloudflare.com/workers/authorization/).
  - Os legados "continue to work", sem data de depreciação.
  - **Inferência:** se o primeiro deploy (que cria o Worker e o KV) for feito pelo humano com `wrangler login`, o token do CI depois só precisa atualizar. Ainda assim, o template legado completo é o mais seguro.
- **Durable Objects:** "Durable Objects do not have separate roles or permissions. Access … is determined by your access to the Worker" — [Authorization › Durable Objects](https://developers.cloudflare.com/workers/authorization/durable-objects/). Migrations de DO vão no upload do script.
- **Bindings no deploy:** "You do not need separate permissions on the bound resources to deploy the Worker." — [Authorization](https://developers.cloudflare.com/workers/authorization/). A permissão de KV só é necessária para **criar** o namespace (auto-provisionamento).
- **Criar o token por API:**
  - "Before you can use the API, you need to generate an initial token via the Cloudflare dashboard… To create account-owned API tokens, create a token with **Account** > **Account API Tokens** > **Edit**. To create user-owned API tokens, use the **Create additional tokens** template." — [Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/).
  - Na OpenAPI: `POST /user/tokens` pede "API Tokens Write" e `POST /accounts/{id}/tokens` pede "Account API Tokens Write".
  - Os escopos OAuth do `wrangler login` **não incluem** tokens ([`scopes.ts`](https://github.com/cloudflare/workers-sdk/blob/c4b18e13bfb55f51b7c2247401a053a240fb0cc6/packages/workers-auth/src/core/scopes.ts)).
  - **Conclusão:** sempre há um passo no dashboard. O mais simples é uma **template URL** de account token: `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=[…]&name=…`, com chaves como `workers_scripts`, `workers_kv_storage`, `workers_r2` e `account_settings`. Mas "Users must still complete the token creation process in the dashboard" — [Template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/).
- **`wrangler login` no bootstrap local:**
  - Basta para `kv namespace create`, `deploy`, `preview`, `base-config secret` e para registrar o subdomain. Os escopos incluem `workers_kv:write`, `workers_scripts:write` e `account:read`.
  - Não cria API tokens.
  - "The `wrangler login` OAuth flow does not currently support granular authorization" — [Authorization](https://developers.cloudflare.com/workers/authorization/).
- **Account ID:** "can also be specified through the `CLOUDFLARE_ACCOUNT_ID` environment variable" — [Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/). No CI é recomendado ou necessário (docs acima). O bootstrap pode ler o valor com `wrangler whoami`.
- **Account-owned tokens** suportam Workers e KV — [Account-owned tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/).

---

## 6. Neon Free

- **Limites:** "Free: 100 projects", "Free: 10 branches/project", "Extra branches are not available on the Free plan", "100 CU-hours/project, 1 GB … per project (up to 20 GB total)" — [Plans](https://neon.com/docs/introduction/plans).
  - **Inferência:** no `<app>-preview`, o root e o `base` ocupam 2 dos 10 branches, então cabem no máximo **8 PRs com preview ao mesmo tempo**.
- **Org:** "In Neon, all projects live within organizations. When you sign up, you automatically get a free organization for your first project." — [Organizations](https://neon.com/docs/manage/organizations). O signup cria a org, e o dono é Admin dela. Não há passo manual extra.
- **Keys** — [Manage API keys](https://neon.com/docs/manage/api-keys) e [CLI api-keys](https://neon.com/docs/cli/api-keys):
  - Três tipos: pessoal, de org e de projeto. "Only organization **Admins** can create organization or project-scoped keys." Como o dono do Free é Admin da org automática, **funciona no Free pessoal** (inferência apoiada na tabela).
  - **Pela CLI:** `neon api-keys create --name … --project-id <id>`. A CLI acha a org a partir do projeto. Saída: "Limited to <id>: it cannot create projects, mint API keys, or read any other project. It can still change and delete everything inside that project." `-o json | jq -r .key` captura a key.
  - **Pela API:** `POST /organizations/{org_id}/api_keys` com `project_id` ("If set, the API key can access only this project") — OpenAPI [`v2.json`](https://neon.com/api_spec/release/v2.json).
  - A key de projeto tem papel **Editor** no projeto: "Get connection strings…", "Create, edit, or delete branches, endpoints, databases, and Postgres roles", "Change project settings". Não tem "Delete the project" nem "Manage who can access" — [User permissions](https://neon.com/docs/manage/user-permissions).
  - **Risco:** a key de preview pode apagar ou resetar o `base`. Protected branches, que impediriam isso, são "available on Neon paid plans" — [Protected branches](https://neon.com/docs/guides/protected-branches).
  - "Neon API keys don't expire" (pesquisa 26 anterior). Elas valem até serem revogadas ("Valid until revoked").
- **CLI sem colar key:** `neon login` faz OAuth no browser e salva em `~/.config/neon/credentials.json` (ou no keyring com `--keyring`). A precedência é `--api-key` > `NEON_API_KEY` > arquivo > browser — [CLI login](https://neon.com/docs/cli/login). A CLI com OAuth cria projetos e keys sem que o humano gere uma key pessoal antes. Pela API pura, "You'll need an existing personal key (create one from the Neon Console)".
- **Projetos:**
  - `neon projects create --name <n> [--region-id …] [--org-id …] [-o json]`. O padrão é `aws-us-east-2` — [CLI projects](https://neon.com/docs/cli/projects).
  - A OpenAPI não declara unicidade de nome ("If not specified, the name will be identical to the generated project ID").
  - **Idempotência (inferência):** `neon projects list -o json` (ou `GET /projects?search=<name>&org_id=…`, "Search by project `name` or `id`… partial") e filtrar por nome exato antes de criar.
- **Branches:** `neon branches create --project-id … --name base|preview/pr-N --parent <base>`. "The `--name` value must be unique within the project". Um create repetido falha, e então é preciso consultar com `branches get` ou `list` — [CLI branches](https://neon.com/docs/cli/branches). A connection string sai de `neon connection-string <branch> --project-id … [--pooled]` — [CLI connection-string](https://neon.com/docs/cli/connection-string).
- **Integração GitHub do Neon** — [Neon GitHub integration](https://neon.com/docs/guides/neon-github-integration):
  - "Generates a Neon API key for your Neon account", cria o secret `NEON_API_KEY` e a variável `NEON_PROJECT_ID` no repo.
  - "The `NEON_API_KEY` allows you to run any Neon API method… create, update, and delete various objects in Neon such as projects".
  - **Conclusão:** a key é pessoal, vê produção e é secret de repo, então **não serve** para "key do CI só alcança o projeto de preview". Melhor o bootstrap criar a key de projeto e gravá-la com `gh secret set`.

---

## 7. Cliques manuais antes de as APIs funcionarem

| Serviço | Passo manual | Fonte |
|---|---|---|
| Cloudflare | Signup e verificação do e-mail. A doc só cita como bloqueados "certain tasks" (adicionar membro, trocar e-mail, notificações), e o deploy não está na lista. **Ambíguo:** o changelog do Workers sobre `--temporary`/Drop diz "If you are creating a new account, you will need to verify your email address before continuing". | [Verify email](https://developers.cloudflare.com/fundamentals/user-profiles/verify-email-address/), [Workers changelog](https://developers.cloudflare.com/changelog/product/workers/2/) |
| Cloudflare | `wrangler login` no browser, para o bootstrap local | [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) |
| Cloudflare | workers.dev subdomain. Não exige clique: é `PUT` por API ou o prompt do `wrangler deploy` interativo. | §4 |
| Cloudflare | Criar o API token do CI no dashboard (template URL). Não há como evitar. | §5 |
| Neon | Signup no browser (a org é automática) e `neon login` | §6 |
| Resend | Signup e a primeira API key no dashboard. O `resend login` pede a key colada. | §1 |
| Resend | Ter um domínio (comprar) e criar os registros DNS. Pode levar de 15 min a 72 h. | §1 |

---

## Pontos em aberto (precisam de teste)

1. Se `delivered+x@resend.dev` aceita envio de `onboarding@resend.dev` sem domínio verificado (§1).
2. O erro do `wrangler preview` com KV sem `id` em `previews.kv_namespaces` (§2).
3. O reprovisionamento do KV quando o título `<worker>-oauth-kv` já existe e o Worker foi apagado (§2).
4. Se a opção `config` do Vite plugin aceita `previews` e se o `wrangler preview` honra o redirect na prática (§3).
5. Se um binding KV posto só na base config do Preview, via API, chega ao Preview (§3).
6. A permissão exata para `POST …/previews`: o template legado "Edit Cloudflare Workers" contra os papéis novos (#15797) (§5).
7. Se uma conta Cloudflare recém-criada já vem com o workers.dev subdomain registrado (§4).
