# R2 para anexos de Tarefas no Free e no preview por PR

Type: research
Status: resolved

## Question

Os anexos de Tarefas vão para o R2: até 10 MB, qualquer tipo, com miniatura para imagens, e apagar a Tarefa apaga os anexos ([Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md)). O preview usa o bloco `previews` do config da `main`, com KV e R2 próprios ([Segurança do CI do PR com código da Factory](19-pr-ci-security.md)), e tudo precisa ser gratuito ([Trocas na stack](13-stack-swaps.md)). Na documentação oficial mais recente (outubro de 2026):

1. **Isolamento por PR**: o bloco `previews` do Worker Previews (`wrangler preview`, ≥ 4.135) aceita um bucket R2 por preview, ou só um bucket compartilhado por todos os previews? Se só compartilhado, um prefixo por PR (`pr-N/`) vindo de uma var resolve, e qual é o jeito suportado de passar a var? Criar e apagar bucket pela API/wrangler no CI com o mesmo token: limite de buckets por conta, e se o bucket precisa estar vazio para ser apagado.
2. **Limpeza no `closed`**: como apagar todos os objetos de um prefixo ou de um bucket (lifecycle rule, delete em lote pela S3 API, `wrangler r2 object delete`), com custo zero no Free.
3. **Limites do Free**: armazenamento, operações classe A e B, egress; se upload pelo Worker (corpo de 10 MB) cabe no limite de request do Workers Free; upload pelo Worker × URL pré-assinada da S3 API (CORS, como o Worker valida tamanho e tipo).
4. **Miniaturas no Free**: Cloudflare Images (binding ou transformações) tem cota gratuita que serve? Senão, gerar a miniatura no navegador antes do upload, ou só exibir a imagem original reduzida.
5. **Testes**: R2 no `createTestHarness()` do wrangler e no Playwright contra a stack local ([Testes de integração e E2E para esta stack](08-integration-and-e2e-testing.md)).

Conclua com uma recomendação concreta para a spec (binding, isolamento no preview, limpeza, caminho de upload, miniatura) e o que o bootstrap precisa criar.

## Answer

- **Isolamento: um bucket de preview compartilhado + prefixo `pr-N/` por `--var`.**
  - `previews.r2_buckets` liga o bucket por `bucket_name`, e "two Previews sharing the same `bucket_name` share objects". Não há provisionamento automático por Preview, como existe para DO.
  - O `wrangler preview` (4.151.1) não tem flag para trocar binding. Um bucket por PR exigiria gerar config por PR, o que fura o "sempre `--config` da `main`" da decisão 19.
  - O jeito suportado é `wrangler preview --name pr-N --var R2_PREFIX:pr-N/`: o `--var` sobrescreve `previews.vars`. A barra final evita que `pr-1` case com `pr-10/`.
  - O isolamento é cooperativo (o código do PR pode ler outro prefixo). Serve, porque o preview só tem seed.
  - Bucket por PR seria possível (limite de 1 M de buckets por conta), mas o bucket precisa estar vazio para ser apagado e o wrangler não lista nem esvazia objetos.
- **Limpeza no `closed`:**
  - `wrangler r2 bucket lifecycle add <app>-attachments-preview pr-N pr-N/ --expire-date $(date -u +%F) --force`: 1 Classe B + 1 Classe A, e os objetos somem em ~24 h;
  - o limite é de 1.000 regras por bucket, então o mesmo job ou o sweep remove as regras `pr-*` antigas;
  - rede de segurança: regra `ttl` de 30 dias no bucket de preview inteiro;
  - S3 `DeleteObjects` funcionaria, mas pede um secret a mais. `wrangler r2 object delete` é de um objeto por vez.
- **Limites do Free (por conta, produção + preview):**
  - 10 GB-mês, 1 M de Classe A, 10 M de Classe B, egress grátis. O teto real é o armazenamento;
  - **sem hard cap:** o excedente é cobrado e o budget alert só avisa. A ativação do R2 passa por um checkout, provavelmente com cartão;
  - o corpo de request no Free vai até 100 MB, então 10 MB pelo Worker cabe;
  - **(teste)** `put(key, request.body)` de 10 MiB ok, mas um stream sem tamanho conhecido falha. O upload exige `Content-Length` (411 sem ele, 413 acima de 10 MiB);
  - URL pré-assinada descartada: sem `POST` não dá para impor tamanho, e ainda exige CORS e um secret S3.
- **Miniatura no navegador** (`createImageBitmap` + `OffscreenCanvas.convertToBlob`, WebP com fallback para JPEG, 320 px), num segundo PUT.
  - O Images Free dá 5.000 transformações únicas por mês, sem cobrança acima disso. Mas o tutorial oficial (2026-06) diz que o binding exige Images Paid, e a página de preço (2026-10) diz o contrário.
  - Fica como upgrade opcional depois de confirmado. **(teste)** O binding roda local no harness (low-fidelity, com `sharp`).
  - Sem miniatura, o cartão mostra um ícone e o detalhe mostra o original reduzido.
- **Testes:** **(teste)** o R2 local funciona no `createTestHarness()` com `getEnv()` para semear e inspecionar. `server.reset()` zera o bucket, e o harness usa o config do topo, não o bloco `previews`. O Playwright segue o fixture oficial, com `setInputFiles`.
- **Para a spec:**
  - binding `ATTACHMENTS`, com `<app>-attachments` no topo e `<app>-attachments-preview` em `previews`;
  - chave `${R2_PREFIX}${company}/${project}/${task}/${attachment}`;
  - `PUT` com o corpo cru pelo Worker;
  - download pelo Worker, depois de checar Member, com `Content-Disposition: attachment` para o que não for imagem raster e `nosniff`;
  - cascata pelas chaves vindas do Postgres, ou por prefixo para Projeto e Company;
  - cota de ~8 GB na app.
- **Bootstrap:**
  - passo humano: ativar o R2 e criar o budget alert;
  - criar os 2 buckets e a regra `ttl` no de preview;
  - dar `Workers R2 Storage Write` ao token do cleanup;
  - nenhum secret novo e nenhum CORS.

[pesquisa](../research/22-r2-attachments-previews.md)
