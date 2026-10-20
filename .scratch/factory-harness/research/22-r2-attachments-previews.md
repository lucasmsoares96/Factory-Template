# Pesquisa 22: R2 para anexos de Tarefas no Free e no preview por PR

Ticket: [22-r2-attachments-previews](../issues/22-r2-attachments-previews.md) · Pesquisado em 2026-10-18 · Só fontes primárias:
- docs da Cloudflare em `developers.cloudflare.com` (versão Markdown `…/index.md`, consultada em 2026-10-18; a data "Last updated" de cada página vai junto da citação);
- código do `cloudflare/workers-sdk` no commit [`54f6da4`](https://github.com/cloudflare/workers-sdk/tree/54f6da46ff43e6fe1d85b529c454936a26f69937) (2026-10-18), pacotes `wrangler` e `deploy-helpers`;
- changelog do Cloudflare Images (RSS oficial);
- MDN, para a API de canvas do navegador;
- registry do npm (`npm view`, 2026-10-18).

Quando a conclusão vem de um experimento local, e não de documentação, isso aparece como **(teste)**. Nenhum recurso foi criado na conta Cloudflare do usuário. Os experimentos rodaram em `/tmp`, fora do repo.

Versões consultadas: `wrangler` **4.151.1** (2026-10-16, `latest`), que fixa `miniflare` **5.20261012.1-beta** e `workerd` 1.20261012.1. `vitest` 5.0.5. `sharp` 0.35.5 (dependência do miniflare). Node 26.3.0.

## Resposta

**1. O bloco `previews` aceita `r2_buckets`, mas o bucket é fixo no config. Isolar por PR com um bucket por PR exige gerar config por PR. O caminho suportado é um bucket de preview compartilhado com um prefixo `pr-N/` passado por `--var`.**
- **Fonte diz:** `previews.r2_buckets` "Binds to an R2 bucket by `bucket_name`. Two Previews sharing the same `bucket_name` share objects. — To isolate one Preview: Bind to a different R2 bucket." Diferente de Durable Objects e Containers, **não há provisionamento automático por Preview** ([Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/), 2026-09-22). O exemplo oficial de config usa um `r2-staging` compartilhado no bloco `previews` ([Configuration](https://developers.cloudflare.com/workers/previews/configuration/), 2026-09-22).
- **Fonte diz (código):** o `wrangler preview` monta os bindings só a partir do arquivo de config (`extractBindings(config.previews, …)` → `{ type: "r2_bucket", bucket_name }`), sem criar recursos ([`deploy-helpers/src/preview/shared.ts` L484-492, L721](https://github.com/cloudflare/workers-sdk/blob/54f6da46ff43e6fe1d85b529c454936a26f69937/packages/deploy-helpers/src/preview/shared.ts#L484-L492)). As flags do comando são `--name`, `--tag`, `--message`, `--json`, `--ignore-base-config`, `--worker-name`, `--var` e `--secrets-file`. **Não existe flag para trocar um binding** ([`wrangler/src/preview/preview.ts` L25-75](https://github.com/cloudflare/workers-sdk/blob/54f6da46ff43e6fe1d85b529c454936a26f69937/packages/wrangler/src/preview/preview.ts#L25-L75)).
- **Inferência:** um bucket por PR obrigaria o CI a gerar um config derivado por PR, com outro `bucket_name`. Isso esbarra na regra "sempre `--config` da `main`" da [decisão 19](../issues/19-pr-ci-security.md). Daria para manter o espírito (o CI deriva o arquivo do config da `main`), mas são mais peças móveis para pouco ganho.
- **Prefixo por var, o jeito suportado:** `wrangler preview --name pr-N --var R2_PREFIX:pr-N/`. O formato é `chave:valor` ([`collectKeyValues.ts`](https://github.com/cloudflare/workers-sdk/blob/54f6da46ff43e6fe1d85b529c454936a26f69937/packages/wrangler/src/utils/collectKeyValues.ts)), e "Vars from the CLI (--var) override same-named vars from the previews config" ([`deploy-helpers/src/preview/preview.ts` L858-861](https://github.com/cloudflare/workers-sdk/blob/54f6da46ff43e6fe1d85b529c454936a26f69937/packages/deploy-helpers/src/preview/preview.ts#L858-L861)). Se usar o `wrangler-action`, o input `vars:` vira `--var` também no `preview` ([pesquisa 05](05-pr-preview-environments.md), seção C).
  - **A barra final é obrigatória:** `pr-1/` não casa com `pr-10/`, mas `pr-1` casaria. Isso vale para o código e para a regra de lifecycle (pergunta 2).
  - **O isolamento por prefixo é cooperativo.** O código do PR pode ignorar o `R2_PREFIX` e ler ou escrever o prefixo de outro PR no mesmo bucket. Isso é aceitável porque o preview só tem dados de seed ([decisão 19](../issues/19-pr-ci-security.md)), e o bucket de produção é outro.
- **Criar e apagar bucket no CI, caso um dia valha a pena:**
  - o limite é **1.000.000 buckets por conta**, e as operações de gerência são limitadas a 50/s por bucket ([R2 Limits](https://developers.cloudflare.com/r2/platform/limits/), 2026-06-08);
  - a REST API tem o limite de 1.200 requests a cada 5 min ([R2 Limits](https://developers.cloudflare.com/r2/platform/limits/));
  - **o bucket precisa estar vazio para ser apagado:** "A bucket must be completely empty before it can be deleted. Attempting to delete a bucket that contains objects returns an error." O `wrangler r2 bucket delete` "fails if the bucket still contains objects" ([Delete buckets](https://developers.cloudflare.com/r2/buckets/delete-buckets/), 2026-04-30);
  - o wrangler **não tem** comando para listar ou esvaziar objetos. Existem só `r2 object get|put|delete`, de um objeto por vez ([Wrangler R2 commands](https://developers.cloudflare.com/workers/wrangler/commands/r2/), 2026-10-01). Esvaziar exige uma lifecycle rule (≈24 h) ou um script com a S3 API. Ou seja, o bucket por PR não pode ser apagado no mesmo job do `closed`.
  - **Conclusão:** bucket por PR é possível no Free, mas exige config gerado por PR e um sweep posterior para apagar. Não recomendo.

**2. Limpeza no `closed`: uma lifecycle rule por prefixo, adicionada pelo job de cleanup, com custo zero.**
- **Lifecycle (recomendado):** `wrangler r2 bucket lifecycle add <bucket-preview> pr-N pr-N/ --expire-date $(date -u +%F) --force`. Os argumentos posicionais são `<BUCKET> [NAME] [PREFIX]`, e as flags incluem `--expire-days`, `--expire-date` e `--force` ([Wrangler R2 commands](https://developers.cloudflare.com/workers/wrangler/commands/r2/#r2-bucket-lifecycle-add)). O código faz um GET da configuração atual, acrescenta a regra e faz um PUT ([`r2/lifecycle.ts` L162-355](https://github.com/cloudflare/workers-sdk/blob/54f6da46ff43e6fe1d85b529c454936a26f69937/packages/wrangler/src/r2/lifecycle.ts#L162-L355)).
  - Custo: 1 Classe B (`GetBucketLifecycleConfiguration`) + 1 Classe A (`PutBucketLifecycleConfiguration`) ([R2 Pricing](https://developers.cloudflare.com/r2/pricing/), 2026-10-01).
  - Prazo: "Objects will typically be removed from a bucket within 24 hours of the `x-amz-expiration` value". A remoção pela regra não é cobrada ("An object is no longer billable once it has been deleted") ([Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), 2026-04-21).
  - Permissão: "requires an API token with the `Workers R2 Storage Write` permission group" ([Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)). **Inferência:** acrescentar isso ao token da decisão 19 não aumenta o poder dele na prática, porque esse token já faz `wrangler deploy` de código arbitrário no Worker que tem o binding do bucket de produção.
  - **Higiene:** o limite é de **1.000 regras por bucket** ([Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)). Por isso, o mesmo job (ou o sweep noturno) remove as regras `pr-*` com data de 2 dias atrás ou mais (`wrangler r2 bucket lifecycle remove <bucket> --name pr-M`). O `lifecycle list` do wrangler não tem saída JSON ([`r2/lifecycle.ts` L29-73](https://github.com/cloudflare/workers-sdk/blob/54f6da46ff43e6fe1d85b529c454936a26f69937/packages/wrangler/src/r2/lifecycle.ts#L29-L73)). Para automatizar, use a REST API de lifecycle (GET e PUT em JSON).
- **Rede de segurança:** uma regra no bucket de preview inteiro, sem prefixo (`ttl`, `--expire-days 30`). Ela pega objetos escritos fora do prefixo por código de PR e qualquer cleanup que falhou. A doc confirma esse uso ("Add a lifecycle rule with no prefix filter and an expiration of 1 day") ([Delete buckets](https://developers.cloudflare.com/r2/buckets/delete-buckets/#object-lifecycle-rules)). O R2 já tem uma regra padrão que expira multipart uploads incompletos em 7 dias ([Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)).
- **Delete em lote, a alternativa imediata:**
  - pela S3 API, com `ListObjectsV2` + `DeleteObjects`, ou `aws s3 rm --recursive` / `rclone` ([Delete buckets › Other approaches](https://developers.cloudflare.com/r2/buckets/delete-buckets/#other-approaches));
  - exige um par Access Key/Secret do R2 (mais um secret no CI). O ganho é poder escopar esse token só ao bucket de preview;
  - `ListObjects` é Classe A, e `DeleteObject` é uma "Free operation" ([R2 Pricing](https://developers.cloudflare.com/r2/pricing/#free-operations)). A tabela não lista o `DeleteObjects` em lote; **inferência:** deve seguir o `DeleteObject`, e de todo modo cabe no free tier.
  - O `wrangler r2 object delete` apaga um objeto por vez e não aceita prefixo ([Wrangler R2 commands](https://developers.cloudflare.com/workers/wrangler/commands/r2/#r2-object-delete)), então não serve.
- **Pelo Worker:** o Workers API apaga até 1.000 chaves por chamada e lista até 1.000 por página ([Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), 2026-07-31). **(teste)** List + delete por prefixo apagou 1.503 objetos de `pr-42/` e deixou `pr-7/` intacto. Esse é o caminho da cascata em produção. Para o `closed`, **não** use uma rota do próprio preview: o preview roda código do PR e é apagado no mesmo job.

**3. O free tier cobre bem um time pequeno. O teto real é o armazenamento, e o R2 não tem hard cap. Upload pelo Worker cabe no Free e é o caminho mais simples.**
- **Free tier do R2, mensal e por conta** ([R2 Pricing](https://developers.cloudflare.com/r2/pricing/#free-tier), 2026-10-01):
  - 10 GB-mês de armazenamento;
  - 1 milhão de operações Classe A (`PutObject`, `ListObjects`, `CopyObject`, `PutBucketLifecycleConfiguration`, `PutBucketCors`…);
  - 10 milhões de operações Classe B (`GetObject`, `HeadObject`…);
  - egress grátis;
  - "The free tier only applies to Standard storage".
  - **Inferência:** a cota é da conta, então produção e preview dividem os 10 GB.
- **Cobrança acima do free tier:** $0.015/GB-mês, $4.50 por milhão de Classe A e $0.36 por milhão de Classe B, arredondados para cima ("one million and one operations… billed for two million") ([R2 Pricing](https://developers.cloudflare.com/r2/pricing/)). **Não há teto automático.** Os budget alerts "are informational only. They do not pause or cap usage" ([Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/), 2026-05-29).
- **Ativar o R2 pede checkout:** "You need a Cloudflare account with an R2 subscription… Complete the checkout flow" ([R2 Get started](https://developers.cloudflare.com/r2/get-started/), 2026-04-21). A doc não diz explicitamente que pede cartão. Os relatos da comunidade dizem que o checkout exige cartão ou PayPal mesmo para o free tier ([Cloudflare Community](https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179)). Isso **não foi verificado por mim** (secundário).
- **Conta de operações por anexo de imagem:** upload do original (A) + leitura para a miniatura, se for no servidor (B) + upload da miniatura (A) + uma leitura por visualização (B). Com 1 M de Classe A, cabem cerca de 300 mil uploads por mês. **Os 10 GB acabam primeiro:** são ~1.000 arquivos de 10 MB, ou ~10 mil de 1 MB.
- **10 MB pelo Worker no Free cabe com folga.** "Request body size limits depend on your Cloudflare account plan, not your Workers plan": Free = **100 MB**. Acima disso, 413 ([Workers Limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits), 2026-10-12). A memória é de 128 MB. "Waiting on network requests… does not count toward CPU time" (idem). R2 conta como subrequest a serviço interno, com limite de 1.000 por invocação no Free (idem, Subrequests). **Inferência:** repassar `request.body` direto para `bucket.put()` é I/O em stream, sem JS por chunk, então não pesa nos 10 ms de CPU. Confirmar com `cpuTime` nos Workers Logs no primeiro deploy, como na decisão 13.
- **(teste)** Com o harness:
  - PUT de 10 MiB → `env.ATTACHMENTS.put(key, request.body)`: ok, `size` = 10.485.760, ~0,36 s local;
  - 10 MiB + 1 byte: recusado com 413, por checagem de `Content-Length`;
  - um `ReadableStream` sem tamanho conhecido falha: `TypeError: Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)`. **Consequências:** exigir `Content-Length` (411 sem ele; `fetch(url, { body: file })` com `File`/`Blob` manda o header) e não fazer `tee()` do body para gravar em dois lugares.
- **Upload pelo Worker × URL pré-assinada:**

  | | Pelo Worker (binding) | URL pré-assinada (S3 API) |
  | --- | --- | --- |
  | Credencial | nenhuma: o binding já autentica | Access Key/Secret do R2 como secret do Worker ([Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), 2026-08-22) |
  | Tamanho máximo | o Worker checa `Content-Length` antes do `put` | **não dá para impor**: `POST` (form com policy) "is not currently supported". Só o `Content-Type` entra na assinatura. É preciso confirmar com `HEAD` depois e apagar se passou |
  | Tipo | o Worker lê o header e/ou os magic bytes | `ContentType` assinado: um tipo diferente dá 403 |
  | CORS | não precisa (mesma origem) | política no bucket, com uma origem por URL de preview. "Expired presigned URLs… R2 does not include CORS response headers", e o browser não lê o erro ([CORS](https://developers.cloudflare.com/r2/buckets/cors/), 2026-09-23) |
  | Fluxo | 1 request | 3 passos (pedir URL → PUT no R2 → confirmar no Worker) |
  | Custo no Free | 1 request de Worker por upload, contando na cota de 100k/dia | o corpo não passa pelo Worker |

  Com 10 MB, cabe pelo Worker, e a pré-assinada só traz complexidade e um secret a mais.

**4. Miniaturas: o Cloudflare Images tem cota gratuita (5.000 transformações únicas por mês, sem cobrança acima disso), mas a doc diverge sobre o binding no plano Free. Recomendo gerar a miniatura no navegador.**
- **Fonte diz:** "By default, all users are on the Images Free plan. The Free plan includes access to the transformations feature, which lets you optimize images stored outside of Images, like in R2." No Free: "up to 5,000 unique transformations each month". Acima disso, "New transformations will return a `9422` error… You will not be charged for exceeding the limits in the Free plan." O Images Transformed "is used when using the Images binding" ([Images Pricing](https://developers.cloudflare.com/images/pricing/), 2026-10-12). Desde 2026-07-01, o binding cobra por transformação **única** por mês, e `.info()` é grátis ([changelog](https://developers.cloudflare.com/changelog/post/2026-07-01-binding-unique-transformations/)).
- **Divergência:** o tutorial "Transform user-uploaded images before uploading to R2" manda "Add an Images Paid subscription to your account. This allows you to bind the Images API to your Worker" ([tutorial](https://developers.cloudflare.com/images/tutorials/optimize-user-uploaded-image/), 2026-06-10). A página de preço, mais nova, diz o contrário. Sem criar recursos na conta, não dá para confirmar qual vale.
- **Outros pontos do binding:**
  - entra no bloco `previews` como "API binding… No staging resource is required" ([Configuration](https://developers.cloudflare.com/workers/previews/configuration/));
  - aceita até 20 MB em `.input()` ([Limits](https://developers.cloudflare.com/images/get-started/limits/), 2026-06-16);
  - lê HEIC e não redimensiona SVG (idem).
  - Localmente, roda a versão "low-fidelity offline", que só suporta `width`, `height`, `rotate` e `format` e não gera cobrança ([Images binding](https://developers.cloudflare.com/images/optimization/binding/#interact-with-your-images-binding-locally), 2026-09-02). **(teste)** No `createTestHarness`, um PNG 2000×1000 → `.transform({ width: 320 }).output({ format: "image/webp" })` gerou um WebP 320×160 (o miniflare usa `sharp`).
  - A URL de transformação (`/cdn-cgi/image/`) exige ligar transformations numa **zona** ([Transformations overview](https://developers.cloudflare.com/images/optimization/transformations/overview/), 2026-10-15), e `*.workers.dev` não é zona da conta. Só o binding serviria.
- **No navegador:** `createImageBitmap(file)` + `OffscreenCanvas.convertToBlob({ type: 'image/webp' })`. "If the file format is not specified, or if the given format is not supported, then the data will be exported as `image/png`". O recurso é Baseline desde março de 2023 e roda em Web Worker ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob), 2025-06-23).
  - Como o navegador pode cair para PNG, o código checa `blob.type` e tenta `image/jpeg` em seguida.
  - Custa zero de cota, funciona igual em local, preview e produção, e o Playwright testa num Chromium real.
  - Contras: o cliente controla a miniatura, mas só afeta a própria Company, que já controla o original; formatos que o navegador não decodifica (HEIC no Chrome) ficam sem miniatura; são 2 PUTs (2 requests de Worker e 2 Classe A).
- **Só exibir o original reduzido:** não custa nada, mas baixa até 10 MB por cartão numa lista de Tarefas. Serve só de fallback na tela de detalhe.

**5. Testes: o R2 funciona no `createTestHarness()` sem configuração nenhuma, e o Playwright usa a mesma stack.**
- **Fonte diz:** o harness "Provides access to bindings and local storage from tests". `worker.getEnv()` devolve os bindings para semear dados, e `server.reset()` "recreates local storage" ([Test harness](https://developers.cloudflare.com/workers/testing/test-harness/), [Configure](https://developers.cloudflare.com/workers/testing/test-harness/configure/), [Prepare test state](https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/), 2026-07-27). O fixture oficial do Playwright sobe o harness com `scope: "worker"`, usa `server.listen()` como `baseURL` e chama `server.reset()` depois de cada teste ([Integrations](https://developers.cloudflare.com/workers/testing/test-harness/integrations/#playwright), 2026-07-27).
- **(teste)** Com wrangler 4.151.1:
  - o R2 local veio do `r2_buckets` do topo do config. O harness carrega o config de topo, não o bloco `previews` (o `R2_PREFIX` lido foi o do topo);
  - o override `vars: { R2_PREFIX: "pr-42/" }` funcionou;
  - `getEnv().ATTACHMENTS.head/get/put/list` funcionou no teste;
  - `server.reset()` zerou o bucket.
  - Os 5 testes passaram: upload de 10 MiB, 413, stream sem tamanho, miniatura e delete por prefixo.
- **Para o E2E:** `page.setInputFiles()` com um buffer de imagem passa pelo canvas real do Chromium e pelo Worker local, sem rede e sem conta Cloudflare.

## Recomendação para a spec (anexos de Tarefas)

1. **Binding:** `ATTACHMENTS` (R2). No topo do config, `bucket_name: "<app>-attachments"`, `R2_PREFIX: ""`. No bloco `previews`, `bucket_name: "<app>-attachments-preview"` e `R2_PREFIX: "preview/"`, que é o valor padrão se o `--var` faltar.
   ```jsonc
   "vars": { "R2_PREFIX": "" },
   "r2_buckets": [{ "binding": "ATTACHMENTS", "bucket_name": "<app>-attachments" }],
   "previews": {
     "vars": { "R2_PREFIX": "preview/" },
     "r2_buckets": [{ "binding": "ATTACHMENTS", "bucket_name": "<app>-attachments-preview" }]
   }
   ```
2. **Isolamento no preview:** um bucket de preview compartilhado, mais um prefixo por PR. O job `deploy` roda `wrangler preview --name pr-N --var R2_PREFIX:pr-N/`, com o número do PR lido do evento, como na decisão 19. O código **sempre** monta a chave como `${R2_PREFIX}${companyId}/${projectId}/${taskId}/${attachmentId}`. A produção nunca é tocada, porque é outro bucket.
3. **Limpeza:**
   - **Cascata em produção:** apagar a Tarefa remove as linhas no Postgres e depois `ATTACHMENTS.delete(keys)` (≤ 1.000 por chamada) com as chaves vindas do banco, dentro de `ctx.waitUntil`.
   - Apagar um Projeto ou uma Company faz list + delete pelo prefixo `${R2_PREFIX}${companyId}/${projectId}/`.
   - Uma falha deixa órfãos e não apaga dados vivos. Registrar a falha no log.
   - **`closed` do PR:** `wrangler r2 bucket lifecycle add <app>-attachments-preview pr-N pr-N/ --expire-date $(date -u +%F) --force`. A higiene das regras `pr-*` com mais de 2 dias fica no mesmo job ou no sweep.
   - **Rede de segurança:** a regra `ttl` (sem prefixo, `--expire-days 30`) no bucket de preview.
4. **Caminho de upload:** `PUT /api/tasks/:id/attachments` pelo Worker, com o corpo cru (não `multipart/form-data`).
   - Exige `Content-Length` (411 sem ele) e ≤ 10 MiB (413).
   - Chama `put(key, request.body, { httpMetadata: { contentType } })`. Qualquer tipo é aceito.
   - O nome, o tamanho, o tipo e a chave vão para o Postgres.
   - O download sai por `GET` no Worker, depois de checar Member e role. A resposta leva `Content-Disposition: attachment` para tipos que não são imagem raster (inclui SVG e HTML), `X-Content-Type-Options: nosniff` e `Cache-Control: private, max-age=31536000, immutable`, já que as chaves são imutáveis. **Inferência de segurança:** servir HTML ou SVG enviado por usuário na mesma origem da app abriria XSS.
   - Sem URL pré-assinada e sem CORS.
5. **Miniatura:**
   - Gerada no navegador para `image/png|jpeg|webp|gif`, antes do upload: 320 px de largura, WebP com fallback para JPEG, ≤ 100 KB. Vai num segundo `PUT …/attachments/:aid/thumbnail`, e o Worker checa o tipo e o tamanho.
   - Sem miniatura (HEIC, ou falha no canvas), o cartão mostra um ícone pelo tipo, e o detalhe mostra o original reduzido por CSS, com `loading="lazy"`.
   - **Não usar o Images binding no Skeleton** enquanto a doc divergir sobre o plano Free. Ele é um upgrade opcional depois que o bootstrap confirmar que funciona no Free: os docs de binding, preço e preview já cobrem.
6. **Cota da app, porque o R2 não tem teto:**
   - a app soma os bytes por conta no Postgres e recusa upload acima de ~8 GB no total (produção + preview), com uma mensagem clara;
   - o bucket de preview tem TTL de 30 dias;
   - **budget alert** de $1 no dashboard, sabendo que ele só avisa.
7. **Testes:**
   - integração: `createTestHarness` com o R2 local (semear e inspecionar por `getEnv()`, isolar com `server.reset()`). Casos: 10 MiB ok, 10 MiB + 1 → 413, sem `Content-Length` → 411, cascata apaga as chaves, prefixo respeitado com `vars: { R2_PREFIX: "pr-42/" }`;
   - E2E: Playwright com `setInputFiles` de uma imagem, verificando que a miniatura aparece e que o anexo some quando a Tarefa é apagada.

**O que o bootstrap precisa criar:**
- passo humano (via `wizard`): ativar a assinatura R2 da conta (checkout no dashboard, provavelmente com cartão) e criar o budget alert;
- `wrangler r2 bucket create <app>-attachments` e `wrangler r2 bucket create <app>-attachments-preview`;
- `wrangler r2 bucket lifecycle add <app>-attachments-preview ttl --expire-days 30 --force`;
- a permissão `Workers R2 Storage Write` no token da Cloudflare usado pelo job de cleanup;
- nenhum secret novo e nenhuma política CORS.

## Achados detalhados

### A. Previews e R2

- O bloco `previews` é obrigatório e não herda nada. Bindings de storage (KV, D1, **R2**, Hyperdrive…) precisam aparecer nele "pointed at a Preview-safe resource" ([Configuration](https://developers.cloudflare.com/workers/previews/configuration/), 2026-09-22). O diagrama da mesma página mostra o binding `UPLOADS = preview-r2-bucket` herdado pelos branches, e um branch que troca para `login-test-r2-bucket` editando o próprio config. Ou seja, o isolamento por branch previsto pela Cloudflare é **editar o config no branch**, e a decisão 19 proíbe isso.
- O `--name` padrão é o branch git atual ([Configuration › Secrets](https://developers.cloudflare.com/workers/previews/configuration/#secrets)).
- O `extractBindings(…, omitIdentifierlessBindings)` pula um R2 sem `bucket_name` só quando lê a config de produção para comparar com a do preview. Não existe auto-provisionamento de bucket no `preview` ([`shared.ts` L443-492, L721-725](https://github.com/cloudflare/workers-sdk/blob/54f6da46ff43e6fe1d85b529c454936a26f69937/packages/deploy-helpers/src/preview/shared.ts#L443-L492)).
- As regras de nome de bucket são: minúsculas, dígitos e hífen, 3 a 63 caracteres, sem hífen nas pontas ([Create buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/), 2026-04-30). `<app>-attachments-preview` cabe se `<app>` tiver até 44 caracteres.

### B. Experimento local (teste)

Worker com o binding `ATTACHMENTS` (R2) e `IMAGES`, `compatibility_date` 2026-10-18, testado com `createTestHarness` do wrangler 4.151.1 e Vitest 5.0.5:

| Caso | Resultado |
| --- | --- |
| PUT 10 MiB (`Uint8Array`) → `put(key, request.body)` | 200, `size` 10.485.760, ~357 ms |
| PUT 10 MiB + 1 | 413 (checagem de `Content-Length` no Worker) |
| `put()` com um `TransformStream` sem tamanho | `TypeError: Provided readable stream must have a known length…` |
| PNG 2000×1000 → Images binding local, largura 320, WebP | WebP 320×160 gravado no R2 local |
| 1.500 objetos em `pr-42/many/*` + list/delete por prefixo | 1.503 apagados (inclui os dos testes anteriores); `pr-7/keep.txt` intacto |
| `server.reset()` | o objeto some (`head` → `null`) |
| `R2_PREFIX` sem override | veio do topo do config (`prod/`), não do bloco `previews` |

### C. Por que não um bucket por PR

1. O `bucket_name` vem do arquivo, e o `wrangler preview` não tem flag para trocar um binding. Seria preciso um config gerado por PR (seção A).
2. Apagar exige o bucket vazio, e esvaziar leva ≈24 h por lifecycle ou exige um script com a S3 API e um secret a mais (pergunta 1).
3. O ganho, isolamento real entre PRs, protege só dados de seed.

## Riscos em aberto

- **Sem teto de gasto no R2:** passar de 10 GB, 1 M de Classe A ou 10 M de Classe B gera cobrança, e o budget alert só avisa. Mitigação: a cota da app (recomendação 6). A ativação do R2 provavelmente exige cartão, o que viola o espírito de "100% gratuito" mesmo com custo zero. O usuário precisa aceitar isso.
- **Produção e preview dividem a cota** de armazenamento e operações da conta. Um PR que suba muitos arquivos come o espaço da produção até a regra `ttl` ou o cleanup agir.
- **A lifecycle não é imediata:** a remoção leva "typically… within 24 hours", e pode demorar mais em buckets grandes. As regras `pr-*` acumulam até o limite de 1.000 se ninguém fizer a higiene.
- **Divergência no Images binding:** a doc de preço (2026-10-12) diz que funciona no Free, e o tutorial (2026-06-10) diz que exige Images Paid. Por isso a miniatura fica no navegador.
- **CPU no upload:** que o stream de 10 MB não pesa nos 10 ms é inferência. Medir o `cpuTime` no primeiro deploy.
- **Órfãos na cascata:** o R2 e o Postgres não têm transação conjunta. Uma falha no `delete` depois do commit deixa objetos órfãos, que só custam espaço.
- **Worker Previews ainda é "open beta"** no código, e há bugs abertos de previews que continuam servindo depois do `delete` (pesquisa 19). O bucket de preview só pode ter dados de seed.
