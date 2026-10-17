# Pesquisa 05 — Ambiente de preview por PR

Ticket: [05-pr-preview-environments](../issues/05-pr-preview-environments.md) · Pesquisado em 2026-10-17 · Fontes primárias: docs da Cloudflare (Workers Previews, Version URLs, Static Assets, Hyperdrive, Access, Pages), código-fonte de `cloudflare/workers-sdk` (wrangler 4.151.1) e `cloudflare/wrangler-action` (v4.1.3), blog da Cloudflare, docs da Neon e código/READMEs de `neondatabase/*-action`, docs do Drizzle, docs do Resend, docs do Better Auth e GitHub Docs/Changelog.

## Resposta

**O fluxo oficial mudou em 22/09/2026.** A Cloudflare lançou os **Worker Previews** (`wrangler preview`). Cada branch ou PR ganha um ambiente isolado *dentro do mesmo Worker*, com vars, secrets, bindings, URL e observabilidade próprios. As antigas "preview URLs" (`wrangler versions upload --preview-alias`) foram renomeadas para **Version URLs**. A doc agora diz explicitamente: "Do not use Version URLs for branch or pull request testing. Use Previews instead." O motivo é que elas usam os recursos de produção. Já o Pages diz: "Start new projects with Workers."

A Neon não tem integração nativa com Workers Previews. O fluxo oficial dela continua sendo **GitHub Actions**: `create-branch-action@v6` → migrations → deploy do preview → `delete-branch-action@v3` no `closed`. O Drizzle não tem doc de CI/preview, então basta rodar `drizzle-kit migrate` contra a URL **direta** do branch Neon. O Resend **não tem modo de teste nem chave sandbox**; ele oferece endereços `@resend.dev` para simular eventos e uma caixa de recebimento `<id>.resend.app` que dá para ler por API.

**Fluxo recomendado para o Skeleton:**

1. **Um único Worker** serve front (Static Assets em modo SPA) e back (Hono em `/api/*`). Assim, um único Preview cobre front + back na mesma origem, sem CORS e com cookies do Better Auth funcionando. **Proposta de troca de stack:** sair do Cloudflare Pages (vira decisão do usuário, ticket 13). Separar front e API em dois Workers quebra o preview: um service binding vindo de um Preview chama a **produção** do Worker ligado.
2. **Workflow `preview.yml`** em `pull_request` (`opened, synchronize, reopened, closed`), mais `workflow_dispatch` com `preview_name` para a Factory criar preview antes de existir PR:
   1. `neondatabase/create-branch-action@v6` cria (ou reaproveita) o branch `preview/<nome>`, com `expires_at` como rede de segurança.
   2. (opcional, recomendado para a Factory) `reset-branch-action@v1` no `synchronize`, para o E2E sempre partir do pai.
   3. `drizzle-kit migrate` com o `db_url` **direto** (não o pooled).
   4. Build do front e depois `wrangler preview --name <nome> --json --secrets-file <tmp>`, com `DATABASE_URL` (pooled) injetado como secret **daquele** Preview. A URL sai de `jq -er '.preview.urls[0]'`.
   5. Probe de `/api/health`, comentário no PR (`gh pr comment --edit-last --create-if-none`) e job de E2E/prints com `BASE_URL` = URL do preview.
3. **Secrets fixos de preview** (chave Resend de preview, `BETTER_AUTH_SECRET` de preview etc.) entram uma única vez no bootstrap via `wrangler preview base-config secret put`. Todo Preview novo herda esses valores. Os secrets de produção nunca vão para Previews: "Previews do not inherit production settings."
4. **Limpeza** no `closed`: `wrangler preview delete --name <nome> --skip-confirmation` + `neondatabase/delete-branch-action@v3`. Redes de segurança: `expires_at` da Neon (máx. 30 dias) e despejo automático da Cloudflare (o Preview menos recente sai quando passa de 100 no Free e 500 no Paid).
5. **E2E e prints** apontam para a **Preview URL estável** `<nome>-<worker>.<subdomínio>.workers.dev`, passada como output do job (não via evento `deployment_status`, porque eventos criados pelo `GITHUB_TOKEN` não disparam workflows). Se o preview estiver atrás do Cloudflare Access, o Playwright manda os headers de *service token*.

## Esboço YAML

> Esboço, não testado. Versões verificadas em 2026-10-17: wrangler 4.151.1, `cloudflare/wrangler-action` v4.1.3, `neondatabase/create-branch-action` v6 (release 6.3.1), `delete-branch-action` v3.2.1, `reset-branch-action` v1.3.2, `schema-diff-action` v1.0.1, `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `pnpm/action-setup` v6.1.0, `actions/upload-artifact` v7.0.2. Em produção, fixar as actions por SHA.

```yaml
# .github/workflows/preview.yml
name: Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
  workflow_dispatch:            # a Factory pode criar o preview antes de abrir o PR (Stage E2E)
    inputs:
      preview_name:
        description: "lowercase letters, digits, dashes; starts with a letter (ex.: issue-42)"
        required: true
        type: string

permissions:
  contents: read
  pull-requests: write

env:
  PREVIEW_NAME: ${{ inputs.preview_name || format('pr-{0}', github.event.pull_request.number) }}

jobs:
  preview:
    # forks não recebem secrets; a doc da Cloudflare manda checar isso antes de expor credenciais
    if: >-
      github.event.action != 'closed' &&
      (github.event_name == 'workflow_dispatch' ||
       github.event.pull_request.head.repo.full_name == github.repository)
    runs-on: ubuntu-24.04
    concurrency:
      group: preview-${{ inputs.preview_name || github.event.pull_request.number }}
      cancel-in-progress: true
    outputs:
      preview_url: ${{ steps.preview.outputs.preview_url }}
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile   # wrangler >= 4.135 fixado no package.json (recomendado: 4.151.x)

      - name: Neon branch expiration (backstop)
        run: echo "EXPIRES_AT=$(date -u --date '+14 days' +'%Y-%m-%dT%H:%M:%SZ')" >> "$GITHUB_ENV"

      - name: Create/reuse Neon branch
        id: neon
        uses: neondatabase/create-branch-action@v6
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch_name: preview/${{ env.PREVIEW_NAME }}
          parent_branch: ${{ vars.NEON_PREVIEW_PARENT_BRANCH }}   # vazio = branch default (produção)
          expires_at: ${{ env.EXPIRES_AT }}                         # só vale na criação; o action não renova no reuso
          role: ${{ vars.NEON_ROLE || 'neondb_owner' }}

      # Opcional: estado determinístico a cada push (descarta dados criados no preview anterior)
      - name: Reset Neon branch to parent
        if: github.event.action == 'synchronize' && steps.neon.outputs.created == 'false'
        uses: neondatabase/reset-branch-action@v1
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch: preview/${{ env.PREVIEW_NAME }}
          parent: true

      - name: Drizzle migrations (conexão direta)
        run: pnpm drizzle-kit migrate
        env:
          DATABASE_URL: ${{ steps.neon.outputs.db_url }}   # Neon: migrations exigem conexão direta

      - run: pnpm build   # front (Vite) -> diretório de assets do Worker

      - name: Create/update Worker Preview
        id: preview
        run: |
          set -euo pipefail
          SECRETS_FILE="$RUNNER_TEMP/preview.secrets.json"
          jq -n --arg db "$DB_URL_POOLED" '{DATABASE_URL: $db}' > "$SECRETS_FILE"
          output="$(pnpm exec wrangler preview --name "$PREVIEW_NAME" --json --secrets-file "$SECRETS_FILE")"
          rm -f "$SECRETS_FILE"
          printf '%s\n' "$output"
          echo "preview_url=$(printf '%s' "$output" | jq -er '.preview.urls[0]')" >> "$GITHUB_OUTPUT"
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          DB_URL_POOLED: ${{ steps.neon.outputs.db_url_pooled }}
        # NÃO usar o input `secrets:` do wrangler-action aqui: ele roda `wrangler secret bulk` no Worker de PRODUÇÃO.

      - name: Probe
        run: curl --fail --show-error --silent --retry 5 --retry-all-errors "$PREVIEW_URL/api/health"
        env: { PREVIEW_URL: "${{ steps.preview.outputs.preview_url }}" }

      - name: Comment Preview URL
        if: github.event_name == 'pull_request'
        run: gh pr comment "${{ github.event.pull_request.number }}" --edit-last --create-if-none --body "Preview: ${{ steps.preview.outputs.preview_url }}"
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

      - name: Schema diff comment (opcional)
        if: github.event_name == 'pull_request'
        uses: neondatabase/schema-diff-action@v1   # roda em node20 -> forçado a node24 desde 2026-09-23
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          compare_branch: preview/${{ env.PREVIEW_NAME }}

  e2e:
    needs: preview
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium
      - run: pnpm exec playwright test
        env:
          BASE_URL: ${{ needs.preview.outputs.preview_url }}          # playwright.config: use.baseURL = process.env.BASE_URL
          CF_ACCESS_CLIENT_ID: ${{ secrets.CF_ACCESS_CLIENT_ID }}      # só se o preview estiver atrás do Access
          CF_ACCESS_CLIENT_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
          RESEND_API_KEY: ${{ secrets.RESEND_PREVIEW_API_KEY }}        # para ler e-mails (Receiving/List API)
      - uses: actions/upload-artifact@v7
        if: always()
        with: { name: e2e-${{ github.run_id }}, path: test-results/ }
      # publicar prints no PR: ver pesquisa 04

  cleanup:
    if: github.event.action == 'closed' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    concurrency: { group: preview-cleanup-${{ github.event.pull_request.number }}, cancel-in-progress: false }
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Delete Worker Preview
        run: pnpm exec wrangler preview delete --name "$PREVIEW_NAME" --skip-confirmation
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Delete Neon branch
        uses: neondatabase/delete-branch-action@v3
        continue-on-error: true   # o branch pode já ter expirado (expires_at)
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          api_key: ${{ secrets.NEON_API_KEY }}
          branch: preview/${{ env.PREVIEW_NAME }}
```

Esboço do `wrangler.jsonc` do Skeleton (só a parte relevante):

```jsonc
{
  "name": "app",                       // nome curto: entra no hostname do preview
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-17",   // >= 2026-08-04 já liga nodejs_compat por padrão
  "assets": {                           // fica no topo; o `wrangler preview` sobe os assets do branch
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/mcp/*"]
  },
  "vars": { "APP_ENV": "production" },
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<prod-hyperdrive-id>" }],   // produção
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["AppMcp"] }],           // DO do MCP (se houver)
  "previews": {                          // obrigatório (pode ser {}); nada é herdado da produção
    "vars": { "APP_ENV": "preview", "EMAIL_MODE": "sandbox" },
    "observability": { "logs": { "enabled": true, "invocation_logs": true } }
    // sem hyperdrive no preview: o código usa env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL
    // DO: com ctx.exports cada Preview já ganha namespace próprio; se usar env.X, repetir em previews.durable_objects.bindings
  }
}
```

## Achados detalhados

### A. Cloudflare: Workers Previews é o fluxo recomendado para PR (desde 22/09/2026)

- **Lançamento:** post "Introducing Worker Previews", publicado em 2026-09-22 ("Worker Previews are available now"). — [blog.cloudflare.com/worker-previews](https://blog.cloudflare.com/worker-previews/)
- **O que é:** "Previews give each branch an isolated, production-like environment under the same Worker. Each Preview is configured with its own variables, secrets, and bindings, served on its own URL, and has its own observability." O `npx wrangler deploy` continua sendo o comando de produção. — [Previews](https://developers.cloudflare.com/workers/previews/) (last updated 2026-09-24)
- **Versão mínima (fontes divergem):** a doc diz "Worker Previews requires Wrangler 4.135.0 or later" e pede para atualizar a dependência do projeto, porque um wrangler global mais novo não é usado. O README do `wrangler-action` diz "Workers Previews require Wrangler 4.136.3 or newer". A versão mais recente em 2026-10-17 é a **4.151.1** (2026-10-16). — [Previews](https://developers.cloudflare.com/workers/previews/), [README wrangler-action](https://github.com/cloudflare/wrangler-action), [release wrangler@4.151.1](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler@4.151.1)
- **Status:** no código do wrangler, `preview` e `preview secret *` estão marcados como `status: "open beta"` (commit "previews: move to open beta", #15681, 2026-09-17). O post do blog não usa a palavra beta. — [`packages/wrangler/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/preview/preview.ts)
- **Recomendação explícita contra Version URLs:** "Previews are the recommended way to test changes before production." / "A Version URL runs one uploaded Worker version with the production resources configured for that version." / "Do not use Version URLs for branch or pull request testing. Use Previews instead." Há uma tabela de migração: `wrangler versions upload --preview-alias staging` → `npx wrangler preview --name staging`. — [Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/) (2026-09-22)
- **Version URLs (antigas preview URLs):** "Version URLs were formerly called preview URLs". Não existem para "Workers that implement a Durable Object" (o que inclui Containers e Sandbox); os aliases ficam limitados a 63 caracteres no label DNS; os logs não aparecem em Workers Logs, `wrangler tail` nem Logpush. — [Version URLs](https://developers.cloudflare.com/workers/configuration/previews/) (2026-09-22). Consequência: **um Worker com McpAgent (Durable Object) não teria preview no modelo antigo**. No novo, cada Preview ganha um namespace DO próprio (seção C).
- **URLs:** a Preview URL `<preview-name>-<worker-name>.<subdomain>.workers.dev` "always serves the latest deployment". A Deployment URL `<deployment-id>-<worker-name>.<subdomain>.workers.dev` é imutável. Há opção de domínio próprio (`<preview-name>.app.example.com`). URLs `workers.dev` mandam `X-Robots-Tag: noindex`. — [Previews](https://developers.cloudflare.com/workers/previews/)
- **Limites:** Free: 100 Previews por Worker e 100 deployments por Preview. Paid: 500 e 100. Ao estourar, a Cloudflare apaga automaticamente o Preview menos recente (ou o deployment mais antigo). — [Previews](https://developers.cloudflare.com/workers/previews/)
- **Exemplo oficial de GitHub Actions:** trigger `pull_request` `[opened, synchronize, reopened, closed]`; `npx wrangler preview --name "pr-${{ github.event.pull_request.number }}" --json`; URL via `jq -er '.preview.urls[0]'`; comentário com `gh pr comment` (`--edit-last --create-if-none` para manter um comentário só); probe com `curl --fail`; screenshot com Playwright; job `cleanup` com `npx wrangler preview delete --name "pr-…" --skip-confirmation`. Sobre forks: "verify that `github.event.pull_request.head.repo.full_name == github.repository`". Sobre o token: "permission to edit Workers Scripts and the resources used by the Preview". — [Previews › Examples](https://developers.cloudflare.com/workers/previews/examples/) (2026-10-01)
- **Alternativa: Workers Builds** (app GitHub da Cloudflare). Ela roda `npx wrangler preview` sozinha e comenta a URL no PR. Não foi escolhida porque o branch Neon, as migrations e o E2E teriam que viver dentro do build script, e a stack pede GitHub Actions. — [Previews › Examples](https://developers.cloudflare.com/workers/previews/examples/)

### B. Front: Static Assets no mesmo Worker em vez de Pages

- O Pages diz: "Workers supports most Pages use cases and offers a broader feature set … It is Cloudflare's primary platform for building applications. Start new projects with Workers." — [Pages](https://developers.cloudflare.com/pages/) (2026-08-25)
- O guia de migração Pages → Workers ensina a obter os previews por branch com o bloco `previews` e Workers Builds. — [Migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) (2026-10-12)
- **Static Assets em Previews:** "`assets` — Keep at the top level, even with an `ASSETS` binding. `npx wrangler preview` uploads assets from the branch you are previewing." — [Previews › Configuration](https://developers.cloudflare.com/workers/previews/configuration/) (2026-09-22)
- **SPA:** `assets.not_found_handling: "single-page-application"` serve `/index.html` com 200, e `run_worker_first: ["/api/*", …]` define o que passa pelo Worker. — [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) (2026-10-12)
- **Por que um Worker só:** "Service bindings from a Preview call the bound Worker's production deployment." Num monorepo com dois Workers, cada um ganha um Preview `pr-123`, mas o service binding entre eles cai na produção. — [Resources › Limitations](https://developers.cloudflare.com/workers/previews/resources/#limitations), [Examples › Monorepo](https://developers.cloudflare.com/workers/previews/examples/)

### C. Configuração, isolamento e secrets dos Previews

- **Nada é herdado:** "Previews do not inherit production settings." O bloco `previews` "is required, but it can be empty". Vars, bindings de storage (KV, D1, R2, **Hyperdrive** etc.), `define` e `tail_consumers` precisam ser declarados em `previews`. `assets`, `compatibility_date` e `compatibility_flags` ficam só no topo. "Do not add Queue consumers, Cron Triggers, or production routes to `previews`." O wrangler lê o arquivo de config **do branch atual**. — [Configuration](https://developers.cloudflare.com/workers/previews/configuration/)
- **Isolamento por recurso:** Durable Objects e Containers ganham namespace/app próprio por Preview, automaticamente. KV, D1, R2, Hyperdrive etc. ficam isolados só se o Preview apontar para outro recurso. Workflows usam o Workflow existente. Queues não têm consumidor em Preview. Cron e routes só disparam em produção. Hyperdrive: "Must be created manually. True data isolation requires a separate config pointing at a separate database or schema." O estado do DO "persists across deployments within the same Preview and is deleted when the Preview is deleted". Com `ctx.exports` (padrão para `compatibility_date` ≥ 2025-11-17), a migration basta. Se o código usar `env.X` sem declarar `previews.durable_objects.bindings`, dá erro 1101. — [Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/) (2026-09-22)
- **Secrets:** são definidos uma vez na *Base configuration* e cada Preview novo os recebe ao ser criado. "Later changes to Base secrets apply only to new Previews, so active Previews remain unchanged." Comandos: `wrangler preview base-config secret put|delete|list|bulk` e `wrangler preview secret put|delete|list|bulk --name <preview>`. — [Configuration › Secrets](https://developers.cloudflare.com/workers/previews/configuration/#secrets), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview)
- **`preview secret put` exige Preview existente:** o código retorna "There are currently no deployments for the Preview … Please create a Preview deployment before modifying a secret." (erro 10032 / 10025). Além disso, cada `secret put` **cria um novo deployment**. — [`preview/secrets/index.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/preview/secrets/index.ts)
- **`--secrets-file` e `--var` no `wrangler preview`:** adicionados no **wrangler 4.132.0** (2026-09-15, PR #15256). Funcionam como no `deploy`: "CLI vars override same-named vars from the `previews` section … and secrets from the file take precedence over both." **Divergência:** a página de referência de comandos ainda não lista essas flags; elas existem no código (`preview.ts`) e no changelog. — [release wrangler@4.132.0](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler@4.132.0)
- **Secrets persistem entre pushes:** "A new deployment replaces the whole environment, so secrets set on the Preview … have to be inherited explicitly". O wrangler marca como `inherit` os `secret_text` do último deployment que não vierem no comando. Mesmo assim, o esboço manda `DATABASE_URL` a cada push, o que é idempotente. — [`deploy-helpers/src/preview/preview.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/preview/preview.ts)
- **Armadilha no `wrangler-action`:** o input `secrets:` roda `wrangler secret bulk` (com `--env`, se houver), ou seja, grava no **Worker de produção**, não no Preview. Já `vars:` vira `--var` também para `preview`. — [`src/wranglerAction.ts`](https://github.com/cloudflare/wrangler-action/blob/main/src/wranglerAction.ts)
- **`wrangler-action` v4.1.x:** `command: preview --name pr-N` expõe `preview-url`, `preview-deployment-url`, `preview-name`, `preview-id` e `preview-deployment-id`. Com `gitHubToken` e `deployments: write`, cria um GitHub Deployment não-produtivo cujo environment é o nome do Preview (`pr-N`). Releases: v4.1.0 (2026-09-22) a v4.1.3 (2026-09-24); roda em `node24`. — [README](https://github.com/cloudflare/wrangler-action), [`src/service/github.ts`](https://github.com/cloudflare/wrangler-action/blob/main/src/service/github.ts)
- **Observabilidade:** "Previews support the same Workers Observability features as production … configured independently". Isso inclui logs e traces em `previews.observability`. — [Test and debug](https://developers.cloudflare.com/workers/previews/test-and-debug/)

### D. Banco: Neon branch por PR

- **Fluxo oficial da Neon:** quatro actions (create, delete, reset e schema-diff) para "ephemeral database branches for pull requests". O workflow de exemplo da integração GitHub cria o branch no `opened/reopened/synchronize`, comenta onde rodar migrations e schema diff, e apaga no `closed`. Ele também avisa: "The step outputs from the `create_neon_branch` action will only be available within the same job … The outputs are marked as secrets." — [Branching with GitHub Actions](https://neon.com/docs/guides/branching-github-actions), [Neon GitHub integration](https://neon.com/docs/guides/neon-github-integration)
- **`create-branch-action@v6`** (README marca "v6 (latest)"; release mais recente: `6.3.1`, 2026-03-31, `runs.using: node24`). "If a branch with the specified name already exists, it returns the details of the existing branch." Outputs: `db_url`, `db_url_pooled`, `db_host`, `db_host_pooled`, `branch_id`, `password`, `created`, `auth_url` e `data_api_url`. Inputs relevantes: `parent_branch`, `role`, `database`, `expires_at` (RFC 3339), `branch_type: schema-only`, `masking_rules`, `suspend_timeout` e `ssl`. O código confirma que, para um branch existente, ele devolve `{...existingBranch, created: false}` **sem renovar `expires_at`**. — [README](https://github.com/neondatabase/create-branch-action), [`action.yml`](https://github.com/neondatabase/create-branch-action/blob/main/action.yml), [`src/branch.ts`](https://github.com/neondatabase/create-branch-action/blob/main/src/branch.ts)
- **Doc da Neon desatualizada:** o workflow da página da integração usa `create-branch-action@v5` e o output `db_url_with_pooler`, mas a v6 expõe `db_url_pooled`. As tags também são inconsistentes: a release se chama `6.3.1` (sem `v`), a tag `v6.4.0` aponta para um commit de 2026-01 e a `v6` para 2026-03-20. **Fixar por SHA.**
- **`delete-branch-action@v3`** (v3.2.1, 2026-03-31; composite com `neonctl@2.22.0`). O input `branch` aceita nome ou ID; `branch_id` está deprecated. — [README](https://github.com/neondatabase/delete-branch-action), [`action.yaml`](https://github.com/neondatabase/delete-branch-action/blob/main/action.yaml)
- **`reset-branch-action@v1`** (v1.3.2) volta o branch ao estado atual do pai (`parent: true`) e devolve `db_url`/`db_url_with_pooler`. — [action.yml](https://github.com/neondatabase/reset-branch-action/blob/main/action.yml)
- **`schema-diff-action@v1`** (v1.0.1, 2025-01-03) recebe `compare_branch` e `base_branch` e comenta o diff no PR. Ele usa `runs.using: node20`. O GitHub removeu o Node 20 dos runners em **2026-09-23** e as actions JS agora rodam forçadas em Node 24. — [action.yml](https://github.com/neondatabase/schema-diff-action/blob/main/action.yml), [GitHub Changelog 2026-09-23](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/)
- **Expiração:** máximo de 30 dias a partir de agora. Não vale para branch protegido, default ou com filhos ("Cannot expire branches that have children or create children from expiring branches"), nem com Data API. Por padrão, branches criados via API não expiram. — [Branch expiration](https://neon.com/docs/guides/branch-expiration)
- **Limites de plano:** branches incluídos por projeto: Free 10, Launch 10, Scale 25. "Extra branches are not available on the Free plan." Nos planos pagos, branch extra custa US$ 1,50/branch-mês (cobrança por hora), até 5.000 por projeto. — [Plans](https://neon.com/docs/introduction/plans)
- **Dados de produção no preview:** um branch normal copia schema **e dados** do pai. As alternativas têm custo:
  - *schema-only* cria um **root branch**, e a cota de root branches é 3 no Free, 5 no Launch e 25 no Scale. Ele também não tem reset. — [Schema-only branches](https://neon.com/docs/guides/branching-schema-only)
  - *Anonimização* (`masking_rules`) está em **beta**, não aceita reset/restore e não mascara FKs. — [Data anonymization](https://neon.com/docs/workflows/data-anonymization)

  O ponto não documentado (inferência minha): num branch schema-only a tabela `drizzle.__drizzle_migrations` vem **vazia**, então o `drizzle-kit migrate` tentaria reaplicar tudo sobre tabelas que já existem. Por isso o esboço usa `parent_branch` configurável. Ou é a produção enquanto não houver dados reais, ou é um branch longo `preview-base` com seed sintético, migrado pelo deploy da `main`.
- **Pooled × direto:** "Use a direct connection for schema migrations, pg_dump …" (o pooler é PgBouncer em modo transaction). — [Connection pooling](https://neon.com/docs/connect/connection-pooling)
- **Neon × Workers:** a doc da Neon recomenda Hyperdrive + driver nativo (`pg`/Postgres.js) ou o serverless driver (HTTP/WebSocket). O WebSocket funciona, desde que `Pool`/`Client` sejam criados, usados e fechados dentro de um único request. — [Use Neon with Cloudflare Workers](https://neon.com/docs/guides/cloudflare-workers), [Serverless driver](https://neon.com/docs/serverless/serverless-driver) (`@neondatabase/serverless` 1.2.0, 2026-10-01)
- **Contradição:** o README do exemplo oficial `neondatabase/preview-branches-with-cloudflare` (marcado "Beta", último push em 2026-05-23) afirma "Neon's WebSocket driver doesn't run on Cloudflare Workers", o que contradiz a doc do serverless driver acima. O exemplo ainda usa o modelo **antigo**: Workers Builds + `wrangler versions upload --preview-alias` + um Hyperdrive config por branch criado por script + TTL de 7 dias. Ele avisa: "A local deploy would inherit the latest Worker version's secret (typically the most recent preview's database URL) and clobber production". É exatamente o problema que os Previews resolvem. — [repo](https://github.com/neondatabase/preview-branches-with-cloudflare)

### E. Hyperdrive no preview: não recomendado por padrão

- Hyperdrive no Preview exige um config **criado à mão** por branch Neon, com o `id` em `previews.hyperdrive`, que vive no arquivo commitado. No CI, isso significa `wrangler hyperdrive create` + editar o `wrangler.jsonc` antes do `wrangler preview` + apagar o config no cleanup. — [Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)
- **Limite:** 10 configs por conta no Free e 25 no Paid. Contando o de produção, isso dá no máximo ~9 ou ~24 previews simultâneos com Hyperdrive. — [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/) (2026-06-09)
- **Alternativa adotada no esboço:** o Preview conecta direto via TCP ao endpoint **pooled** da Neon com o mesmo driver (`pg`). O tutorial da Cloudflare usa `pg` com secret `DB_URL` e trata Hyperdrive como etapa opcional. A partir de `compatibility_date` 2026-08-04, `nodejs_compat` vem ligado por padrão. Em produção, o código usa `env.HYPERDRIVE.connectionString`. — [Connect to PostgreSQL](https://developers.cloudflare.com/workers/tutorials/postgres/) (2026-10-12). A escolha final do driver fica com o ticket 06.

### F. Drizzle

- `drizzle-kit migrate` "lets you apply SQL migrations generated by `drizzle-kit generate`". Ele lê as credenciais de `drizzle.config.ts` (`dbCredentials.url`) ou de `--url`, e registra o que aplicou em `drizzle.__drizzle_migrations`. A página **não fala** de CI/CD nem de preview. — [drizzle-kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate)
- "Migrations for teams" é um placeholder: "This section will be updated right after our release of the next version of migrations folder structure." — [kit-migrations-for-teams](https://orm.drizzle.team/docs/kit-migrations-for-teams)
- Versões (npm, 2026-10-17): `drizzle-orm` latest 0.45.4 (2026-10-08), rc 1.0.0-rc.4; `drizzle-kit` latest 0.31.11 (2026-09-21), rc 1.0.0-rc.4. A doc do site já mostra a estrutura v1 (pastas `<timestamp>_nome/migration.sql`).
- Inferência a partir do branching copy-on-write: o branch filho herda a tabela de migrations do pai, então só as migrations novas do PR rodam. Se o PR **reescrever** uma migration que já rodou no branch reaproveitado, o Drizzle não roda de novo. Por isso o esboço faz `reset-branch-action` no `synchronize`.

### G. Email no preview (Resend)

- **Não há modo de teste nem chave sandbox** documentados. A doc de teste traz endereços `delivered@resend.dev`, `bounced@resend.dev` (SMTP 550 5.1.1), `complained@resend.dev` e `suppressed@resend.dev`, com rótulos `+label`. Recomenda não mandar para endereço falso. Avisa: "Test emails count against your account's sending quota." — [Send Test Emails](https://resend.com/docs/dashboard/emails/send-test-emails)
- **Chave de API restrita:** permissão "Sending access", opcionalmente limitada a um domínio. Combina com uma chave exclusiva de preview no base-config. — [Create an API key](https://resend.com/docs/create-an-api-key)
- **Ler e-mails no E2E:** um domínio de recebimento gerenciado `<id>.resend.app` aceita qualquer endereço (`test@<id>.resend.app`), lido via Receiving API (List/Retrieve Received Email), webhook ou MCP. Também existem "List Sent Emails" e "Retrieve Sent Email". — [Receiving](https://resend.com/docs/dashboard/receiving/introduction), [API index](https://resend.com/docs/llms.txt)
- **Cota:** no Free, 100 e-mails/dia e 3.000/mês, **somando enviados e recebidos**. Vários destinatários contam separado. — [Quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- **Proposta:** no preview, `EMAIL_MODE=sandbox` (var) faz o adaptador de e-mail reescrever o destinatário para `<label>@<id>.resend.app` (o E2E lê o link de verificação pela API) ou `delivered+<label>@resend.dev`. Usuário real nunca recebe e-mail de preview. Isso é design próprio, não recomendação do Resend. SDK `resend` 6.34.1 (2026-10-16).

### H. E2E e prints apontando para o preview

- **URL:** a forma mais simples é o output do step (`.preview.urls[0]`), passado como `needs.preview.outputs.preview_url` e usado como `BASE_URL` no `playwright.config`. A doc da Cloudflare mostra exatamente o probe e o `playwright screenshot "$PREVIEW_URL"`. — [Examples](https://developers.cloudflare.com/workers/previews/examples/)
- **Não depender de `deployment_status`:** "events triggered by the `GITHUB_TOKEN` will not create a new workflow run". O GitHub Deployment criado pelo `wrangler-action` com `GITHUB_TOKEN` não dispara outro workflow. — [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
- **PR criado pela Factory com `GITHUB_TOKEN`:** os eventos `pull_request` `opened/synchronize/reopened` gerados assim ficam em estado **approval-required**, e outros tipos (como `closed`) não criam run nenhuma. "use a GitHub App installation access token or a personal access token instead". Isso afeta diretamente este workflow e confirma a conclusão da pesquisa 04 (identidade da Factory: tickets 03/12). — [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
- **Stage E2E antes de existir PR:** o Preview é identificado por **nome**, não por PR (`--name` vira o nome do branch git se for omitido). A Factory pode criar `issue-<N>` via `workflow_dispatch` (que sempre cria run, mesmo com `GITHUB_TOKEN`) ou rodando o mesmo script no próprio runner. — [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview)
- **Better Auth na URL do preview:** o `baseURL` aceita a forma de objeto, com `allowedHosts` e wildcards ("Use the object form when your app can be reached through multiple domains, such as preview deployments"). Outra opção é injetar `BETTER_AUTH_URL` via `--var`, já que a Preview URL é previsível (`<nome>-<worker>.<subdomínio>.workers.dev`). — [Better Auth options](https://www.better-auth.com/docs/reference/options) (better-auth 1.7.10). O detalhe fica com o ticket 07.
- **Acesso:** "Preview URLs are public by default." O Cloudflare Access protege só os Previews de um Worker (`preview_worker`) ou de todos (`all_preview_workers`). Para automação, *service token* com headers `CF-Access-Client-Id`/`CF-Access-Client-Secret` e política **Service Auth**. Limitação: "Worker-level Access policies do not currently support WebSocket connections … will fail with a `403` error." — [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) (2026-10-12), [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) (2026-10-02)

### I. Limpeza

- Cloudflare: `wrangler preview delete --name <n> --skip-confirmation` "Delete a Preview and all its deployments". Ele remove o namespace DO. Container apps podem sobrar (`wrangler containers list/delete`). A doc **não lista** um `wrangler preview list`, então uma varredura periódica precisaria da API. — [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview-delete), [Resources › Containers cleanup](https://developers.cloudflare.com/workers/previews/resources/#containers)
- Neon: `delete-branch-action@v3` no `closed` (merge ou fechamento), com `expires_at` como backstop. A Neon recomenda limpar porque branches antigos "fall outside the history retention window and start contributing to storage costs". — [CI/preview workflows](https://neon.com/branching/ci-preview-workflows)

## Riscos em aberto

1. **Previews é recente e está em "open beta" no código** (lançado em 2026-09-22). As fontes já divergem: versão mínima 4.135.0 na doc e 4.136.3 no README da action; `--secrets-file` existe no código e no changelog, mas não na referência de comandos. Fixar o wrangler (≥ 4.151.x) no `package.json` e revisar perto da implementação.
2. **Teto de concorrência:** Neon Free e Launch incluem 10 branches por projeto (contando o de produção). No Free não dá para passar disso. Com a Factory rodando issues em paralelo, isso limita a ~9 previews vivos. Hyperdrive por preview teria um teto ainda menor (10 ou 25 configs). Precisa de decisão de plano e bootstrap.
3. **Paridade preview × produção:** preview sem Hyperdrive (TCP direto no pooler) e produção com Hyperdrive. Mesmo driver, caminho de rede diferente. Mitigar com Hyperdrive automatizado por PR, se o teto permitir.
4. **Dados reais em preview:** o branch padrão copia os dados de produção. Schema-only esbarra na cota de root branches e (inferência) quebra o histórico do Drizzle. Anonimização está em beta. O caminho prático é um `preview-base` com seed, mas falta definir quem o mantém migrado.
5. **Previews públicos por padrão:** com Access, o E2E precisa de service token, e WebSocket em Workers protegidos por política de Worker dá 403 (relevante se o MCP ou o Agents SDK usar WebSocket).
6. **Identidade da Factory:** PR ou push com `GITHUB_TOKEN` deixa o `preview.yml` aguardando aprovação. É preciso GitHub App ou PAT (tickets 03/12).
7. **Ações da Neon:** tags confusas, doc com `@v5` e output antigo, e `schema-diff-action` parado em node20 (agora forçado a node24, sem release nova). Fixar por SHA e testar.
8. **Branch Neon reaproveitado:** o `expires_at` não é renovado no reuso. Um PR que viva mais que o TTL perde o banco até o próximo push (o esboço recria e migra no push seguinte). Migrations reescritas exigem reset.
9. **Resend:** sem sandbox; o E2E consome a cota (100/dia no Free, enviados + recebidos). O redirecionamento de destinatário é responsabilidade do app.
10. **Nome do Preview e hostname:** a doc dos Previews não diz como o nome vira *slug* nem qual é o limite de tamanho. Para Version URLs o limite era de 63 caracteres no label DNS. Manter o nome do Worker curto e nomes no formato `pr-<n>` / `issue-<n>`.
