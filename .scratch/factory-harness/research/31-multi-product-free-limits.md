# Limites gratuitos com vários produtos

Ticket: [31-multi-product-free-limits](../issues/31-multi-product-free-limits.md)
Pesquisado em: 2026-10-19

Versões e datas consultadas:
- Cloudflare: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) (last updated 2026-10-12), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2026-10-02), [KV Limits](https://developers.cloudflare.com/kv/platform/limits/) (2026-10-08), [KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/) (2026-04-21), [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (2026-06-01), [Previews](https://developers.cloudflare.com/workers/previews/) (2026-09-24), [Previews › Resources](https://developers.cloudflare.com/workers/previews/resources/) (2026-09-22), [Previews › Examples](https://developers.cloudflare.com/workers/previews/examples/) (2026-10-01), [Email Service Pricing](https://developers.cloudflare.com/email-service/platform/pricing/) (2026-06-09). `wrangler` mais recente: **4.151.2** (npm, 2026-10-19).
- Neon: [Plans](https://neon.com/docs/introduction/plans) (página sem data; lida em `.md` em 2026-10-19) e [Pricing](https://neon.com/pricing).
- Resend: [Pricing](https://resend.com/pricing), [Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Managing Teams](https://resend.com/docs/dashboard/settings/team), [How to add more domains](https://resend.com/docs/knowledge-base/how-to-add-more-domains) (sem data), post [Multiple Teams](https://resend.com/blog/multiple-teams) (2025-03-25, atualizado 2026-07-09).
- GitHub: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Actions limits](https://docs.github.com/en/actions/reference/limits), [Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages), [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Secrets](https://docs.github.com/en/actions/reference/security/secrets) (páginas sem data, lidas em 2026-10-19).
- Turborepo: [`turbo run`](https://turborepo.dev/docs/reference/run), [Constructing CI](https://turborepo.dev/docs/crafting-your-repository/constructing-ci), [`turbo query`](https://turborepo.dev/docs/reference/query) (todas lastUpdated 2026-10-16). `turbo` mais recente: **2.11.9** (2026-10-16). O domínio mudou: `turborepo.com` responde 301 para `turborepo.dev`.
- pnpm: [Filtering](https://pnpm.io/filtering) (cita até a v12.7.0). `pnpm` mais recente: **12.14.0** (2026-10-15).

## Resposta

**O que limita o número de produtos de graça, em ordem:**

1. **Resend Free: 3 domínios verificados por team.** Com um domínio por produto, **cabem 3 produtos** com e-mail de produção. Um 4º exige Pro ($20/mês, 10 domínios). Times extras parecem exigir plano pago. A cota de **100 e-mails/dia e 3.000/mês** é da conta e soma todos os produtos, inclusive os e-mails recebidos no E2E dos previews.
2. **GitHub Free em repo privado: 2.000 minutos de Actions por mês, por conta.** Soma `verify`, previews, E2E, deploy e a Factory de todos os produtos. Não há número fixo de produtos: o teto é de minutos. Além disso, o repo privado no Free **não tem** environments, secrets de environment, branch protection nem rulesets.
3. **Neon Free: 100 projetos.** Com dois por produto (produção e `<produto>-preview`), **cabem 50**. O teto que pesa antes é o **armazenamento de 20 GB somados** entre projetos. Compute (100 CU-h), egress (5 GB) e o limite de 1 GB são por projeto, então um produto não esgota o do outro.
4. **Cloudflare Workers Free: 100 mil requests/dia por conta,** somados entre todos os Workers (e provavelmente os Previews). Static assets são grátis e ilimitados. O número de Workers (100) e de classes de Durable Object (100, ou seja 50 produtos com 2 classes cada) só limita muito depois.

Os demais limites são por recurso (Previews por Worker, branches por projeto Neon, CPU por request, domínios e rotas por zona) e não limitam o número de produtos.

## Achados detalhados

### 1. Cloudflare Workers Free

**Por conta (somados entre produtos):**
- **Requests:** "Accounts on the Workers Free plan have a daily request limit of 100,000 requests, resetting at midnight UTC." Ao passar disso, "Cloudflare returns **Error 1027**". Cada rota pode ser *fail open* (o Worker é pulado) ou *fail closed* (página de erro) ([Limits](https://developers.cloudflare.com/workers/platform/limits/)).
- **Static assets:** "Requests to static assets are free and unlimited" ([Pricing](https://developers.cloudflare.com/workers/platform/pricing/)). A SPA de cada produto não gasta cota. Só `/api/*` (com `run_worker_first`) gasta.
- **Número de Workers:** "100" por conta. **Cron Triggers:** "5" por conta ([Limits](https://developers.cloudflare.com/workers/platform/limits/)). O desenho atual não usa cron (os workflows da Factory são por evento, ver [Anatomia do job](../issues/16-factory-job-anatomy.md)), mas 5 crons por conta seria um teto se um produto precisar de um.
- **Durable Objects:**
  - "Classes per account: 500 (Workers Paid) / 100 (Free)".
  - "Accounts on the Workers Free plan are limited to 5 GB total Durable Objects storage" (1 GB por objeto no Free, pelo FAQ).
  - Só SQLite no Free ([DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
  - No [Pricing](https://developers.cloudflare.com/workers/platform/pricing/): "Requests 100,000 / day", "Duration 13,000 GB-s / day", "Rows written 100,000 / day", "SQL stored data 5 GB (total)". A página não diz "por conta" nas cotas diárias. **Inferência:** são por conta, como a dos Workers.
  - Com `PasswordHasher` e `RateLimiter` por produto, são 2 classes por produto, então cabem **50 produtos** pelas classes.
- **KV:**
  - "Namespaces per account: 1,000" e "Storage/account: 1 GB" ([KV Limits](https://developers.cloudflare.com/kv/platform/limits/)).
  - Operações por dia: "Keys read 100,000 / day", "Keys written 1,000 / day", "All limits reset daily at 00:00 UTC". Ao estourar, "further operations of that type will fail with an error" ([KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)).
  - **Não documentado:** se as operações são por conta ou por namespace. **Inferência:** por conta. Com `OAUTH_KV` de produção e um de preview por produto, são 2 namespaces por produto, ou seja 500 produtos. O que soma é **1.000 escritas/dia** (tokens OAuth do MCP de todos os produtos).

**Por recurso:**
- **CPU:** "10 ms" por request HTTP. **Memória:** 128 MB por isolate. **Subrequests:** 50 por request. **Variáveis:** "64/Worker". **Tamanho:** 64 MiB por Worker. **Static assets:** 20.000 arquivos por versão ([Limits](https://developers.cloudflare.com/workers/platform/limits/)).
- **Rotas e domínios** (todos os planos): "Routes 1,000" por zona, "Custom domains 100" por zona, "Routed zones 1,000" por Worker ([Limits](https://developers.cloudflare.com/workers/platform/limits/)). Um domínio por produto é uma zona Free por produto.
  - A Cloudflare não publica um teto fixo de zonas por conta. A doc de automação só cita o limite de "25 domains every 10 minutes" e um bloqueio quando há mais de 50 domínios com mais pendentes do que ativos ([Add multiple sites via automation](https://developers.cloudflare.com/fundamentals/manage-domains/add-multiple-sites-automation/)).
- **Previews:** "Previews per Worker 100 | 500" e "Deployments per Preview 100 | 100" (Free | Paid). No limite, a Cloudflare apaga o Preview menos recente. Exige Wrangler ≥ 4.135.0 ([Previews](https://developers.cloudflare.com/workers/previews/)). Como o limite é por Worker, cada produto tem os seus 100.
  - Cada Preview ganha um namespace de Durable Object próprio, apagado com o Preview ([Previews › Resources](https://developers.cloudflare.com/workers/previews/resources/)).
  - **Não documentado:** se requests a Previews contam nos 100 mil/dia e se os namespaces DO de Preview contam no limite de classes ou nos 5 GB.
- **Service bindings entre Previews** caem na produção do Worker chamado: "Service bindings between these Previews resolve to the bound Worker's production deployment" ([Examples](https://developers.cloudflare.com/workers/previews/examples/)). Com produtos independentes, isso não importa.

**Alternativa ao Resend na Cloudflare (descartada):** o Email Sending da Cloudflare marca o Free como "Not available". "Sending to arbitrary recipients requires the Workers Paid plan", que inclui 3.000/mês por conta ([Email Service Pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).

### 2. Neon Free

Fonte: [Plans](https://neon.com/docs/introduction/plans) e [Pricing](https://neon.com/pricing).

- **Projetos:** "Free: 100 projects" (Launch também 100, Scale 1.000). A própria Neon recomenda "create a project for each app or customer to isolate data". **Inferência:** o limite vale por organização, que é a unidade de plano. A Pricing não diz a unidade.
- **Branches:** "Free: 10 branches/project". "Extra branches are not available on the Free plan". "Branch creation fails once you reach 10 branches per project". **Por projeto.** Então cada `<produto>-preview` comporta até 9 previews simultâneos além do root (ver [isolamento Neon](19-neon-preview-isolation.md) para o caso schema-only).
- **Compute:** "100 CU-hours/project/month (enough to run a 0.25 CU compute in a project for 400 hours/month)". Scale to zero é obrigatório: "computes suspend after 5 minutes of inactivity". **Por projeto.**
- **Armazenamento:** "1 GB of Postgres storage per project, up to 20 GB total across all projects". Os dois limites "are enforced independently". **Por projeto e por conta ao mesmo tempo.**
- **Egress:** "5 GB per project per month". **Por projeto.**
- **Ao estourar:** "when you run out of CU-hours or public network transfer, your compute is suspended until the next billing period or until you upgrade". Passar do armazenamento faz "inserts, updates, and deletes" falharem. "None of these limits delete your data."
- **Conta:** dois projetos por produto dão 50 produtos. Os 20 GB somados viram o teto antes disso só se os projetos de produção se aproximarem de 1 GB cada (cerca de 20 produtos cheios). Os projetos de preview têm poucos dados.

### 3. Resend Free

- **Domínios:**
  - A [Pricing](https://resend.com/pricing) lista "100 emails a day, 3 domains, 3 inboxes, Ticket support, 10,000 automation runs, 30-day data retention".
  - O [Account quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits) diz "Domains: up to 3 verified domains".
  - **Mudou:** o Free antes tinha 1 domínio.
  - Pro: "$20/mo" com "50,000" e-mails, "10 domains, No daily email limit". O add-on "+100 domains" por $20/mês "is available on paid transactional plans" ([How to add more domains](https://resend.com/docs/knowledge-base/how-to-add-more-domains)).
- **Cota:**
  - "daily email quota of 100 emails/day and 3,000 emails/month". O dia é UTC.
  - "Each received email counts as 1 email against your daily and monthly limits". CC e BCC contam separado.
  - Os e-mails "count towards your account's email quota" ([Account quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)).
  - **Somada entre domínios e produtos** e com o E2E dos previews.
- **Rate limit:** "10 requests per second", "per team, not per API key or per domain".
- **Times:** "Each team is distinct, with its own API keys, billing, and usage" ([Managing Teams](https://resend.com/docs/dashboard/settings/team)). Para criar um time novo, o post diz "choose a paid transactional or marketing plan" ([Multiple Teams](https://resend.com/blog/multiple-teams)). **Inferência:** um 2º time Free na mesma conta não é oferecido. Um domínio "can only be active on one Resend team at a time" ([Managing Domains](https://resend.com/docs/dashboard/domains/manage-domains)). Contas separadas com outro e-mail não foram pesquisadas, incluindo os termos de uso.
- **Subdomínios:** "You can add and verify multiple subdomains of the same domain" ([Managing Domains](https://resend.com/docs/dashboard/domains/manage-domains)). Cada um é um domínio verificado. **Inferência:** cada subdomínio conta entre os 3.
- **Não documentado:** se o domínio de recebimento gerenciado `*.resend.app` (usado no E2E) conta entre os 3. O Free também lista "Inboxes: up to 3 inboxes".

### 4. GitHub Free com repo privado

- **Minutos:**
  - Free (pessoal ou org): "500 MB | 2,000 | 10 GB" (storage de artifacts, minutos/mês, cache por repo).
  - "each GitHub account receives a quota". "Minutes usage is charged to the repository owner".
  - Linux 2-core custa "$0.006" por minuto.
  - Sem forma de pagamento, "usage is blocked once you use up your quota" ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
  - Repo público com runner padrão é grátis.
- **Concorrência:** 20 jobs simultâneos (5 macOS). Até 6 h por job. Matrix de até 256 jobs. "up to 100 jobs or workflow runs can be queued per concurrency group" ([Actions limits](https://docs.github.com/en/actions/reference/limits)).
- **Armazenamento:** artifacts 500 MB, "shared with GitHub Packages". Cache "10 GB per repository", o que num repo só é **somado entre todos os produtos**. "Container image storage and bandwidth for the Container registry is currently free", com aviso de um mês antes de mudar ([Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)).
- **Recursos que o Free privado não tem** (já em [GitHub bootstrap](26-github-bootstrap.md), conferido de novo):
  - "If you are using GitHub Free, environment secrets are only available in public repositories" ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).
  - "Protected branches are available in public repositories with GitHub Free" e "Rulesets are available in public repositories with GitHub Free [...] and in public and private repositories with GitHub Pro, GitHub Team" (páginas de [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) e [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)).
  - "Organization-level secrets and variables are not accessible by private repositories for GitHub Free" ([Using secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)).
- **Secrets por repo:** "You can store up to 1,000 organization secrets, 100 repository secrets, and 100 environment secrets". Variáveis: 500 por repo ([Secrets](https://docs.github.com/en/actions/reference/security/secrets)).
  - **Inferência:** sem environments, os secrets de cada produto vão para o nível do repo com prefixo (ex.: `<PRODUTO>_NEON_API_KEY`). Com 3 ou 4 secrets por produto (key Neon prod, key Neon preview, key Resend, …) mais os compartilhados (token Cloudflare, account ID, token do Claude, `FACTORY_TOKEN`), os 100 secrets acabam em uns 20 produtos.

### 5. Turborepo e pnpm: rodar só o que o PR afeta

- **`turbo run <tasks> --affected`:**
  - "Filter to only packages that are affected by changes on the current branch".
  - "By default, the flag is equivalent to `--filter=...[main...HEAD]`". O `...` antes do filtro inclui os **dependentes**, então mudar um pacote compartilhado (o Skeleton) seleciona todos os produtos que dependem dele.
  - Com `--filter`, "only packages matching **both** constraints are selected".
  - Base e head podem ser trocados por `TURBO_SCM_BASE` e `TURBO_SCM_HEAD` ([`turbo run`](https://turborepo.dev/docs/reference/run)).
- **No GitHub Actions:** o turbo detecta o PR "by inspecting environment variables set by GitHub, like `GITHUB_BASE_REF`". No push, usa `GITHUB_EVENT_PATH` ([Constructing CI](https://turborepo.dev/docs/crafting-your-repository/constructing-ci)).
- **Clone raso:**
  - "If the checkout is too shallow, then all packages will be considered changed".
  - Recomenda checkout com `--filter=blob:none --depth=0` ([`turbo run`](https://turborepo.dev/docs/reference/run)).
- **Mudanças globais que selecionam tudo** ([`turbo query`](https://turborepo.dev/docs/reference/query)):
  - `GlobalDepsChanged`: arquivo em `globalDependencies`.
  - `DefaultGlobalFileChanged`: "`turbo.json` or `turbo.jsonc` changed".
  - `RootInternalDepChanged`: dependência interna do pacote raiz.
  - `LockfileChangeDetectionFailed`, `LockfileChangedWithoutDetails`, `GitRefNotFound` e `ScmError`.
  - Mudança normal no lockfile é atribuída por pacote (`LockfileChanged`).
  - Pacotes puxados por dependência aparecem como `DependencyChanged`.
  - **Inferência:** arquivos da raiz que afetam todos (tsconfig base, config do lint, workflows) precisam entrar em `globalDependencies`, ou só o workspace raiz `//` é marcado.
- **Lista para o CI decidir o que rodar:** `turbo query affected --packages [--base main --head HEAD] [--exit-code]` devolve JSON. Com `--exit-code`, sai 0 se nada foi afetado, 1 se algo foi e 2 em erro ([`turbo query`](https://turborepo.dev/docs/reference/query)). Serve para montar uma matrix de previews/deploys por produto afetado.
- **pnpm:** `--filter "...[origin/main]"` seleciona os pacotes mudados e seus dependentes. Desde a v12.7.0 compara com o merge base. `...pkg` traz os dependentes, `pkg...` as dependências, e há `--changed-files-ignore-pattern` e `--test-pattern` ([Filtering](https://pnpm.io/filtering)).

### 6. Precedentes oficiais

- **Cloudflare, Workers Builds em monorepo:**
  - Cada Worker é ligado ao mesmo repo, com o seu *root directory* e *watch paths*.
  - "a new build and deploy will trigger for each Worker if the change is within each of its included watch paths".
  - Com Turborepo, um deploy command por Worker, ex. "`turbo deploy -F product-service`" ([Advanced setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/), 2026-09-22).
  - Free: 3.000 minutos de build/mês, 1 build simultâneo por conta e timeout de 20 min ([Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), 2026-05-29). Não usamos, porque o CI é GitHub Actions, mas é uma fonte de minutos grátis separada.
- **Cloudflare, Previews em monorepo:**
  - "Preview names are scoped to a Worker", então cada Worker tem o seu `pr-123`.
  - Roda-se `npx wrangler preview --name "pr-123"` no diretório de cada Worker.
  - A doc **não** trata de detectar quais Workers mudaram ([Examples](https://developers.cloudflare.com/workers/previews/examples/)).
- **Turborepo:** os exemplos oficiais (`vercel/turborepo/examples`, lidos em 2026-10-19) **não** têm nenhum com Cloudflare Workers.
- **Não oficial:**
  - [`jahands/workers-monorepo-template`](https://github.com/jahands/workers-monorepo-template) (push em 2026-08-13) usa `apps/<worker>/` e faz o release com `turbo deploy` em todos os Workers, sem `--affected`.
  - Nenhum repo oficial da Cloudflare encontrado combina vários Workers, Previews e `--affected`. Os repos com Previews vistos na [pesquisa 19](19-cloudflare-previews-practice.md) têm um Worker por preview.

## Tabela

| Limite (Free) | Por conta ou por recurso | Quantos produtos cabem de graça | O que exige plano pago |
| --- | --- | --- | --- |
| **Resend: 3 domínios verificados** | Por team | **3** (1 domínio por produto) | 4º produto: Pro $20/mês (10 domínios) ou add-on +100 domínios ($20/mês, só em plano pago) |
| Resend: 100 e-mails/dia, 3.000/mês (enviados + recebidos) | Por conta/team, somado entre domínios | Depende do volume. E2E dos previews consome a mesma cota | Pro: sem limite diário, 50 mil/mês |
| Resend: 10 req/s | Por team | Não limita | — |
| **GitHub Actions: 2.000 min/mês (privado)** | Por conta dona do repo | Depende dos minutos por PR × produtos afetados + Factory | Cobrança por minuto ($0.006 Linux) com forma de pagamento, ou repo público (grátis) |
| GitHub: 20 jobs simultâneos | Por conta | Não limita (fila) | Planos pagos |
| GitHub: artifacts + Packages 500 MB; cache 10 GB | Por conta; cache por repo (somado entre produtos no monorepo) | Depende de retenção de prints e traces | Pago por uso. GHCR grátis hoje |
| GitHub privado: sem environments, secrets de environment, branch protection, rulesets ou secrets de org | Por plano | — | Pro/Team (environments, secrets de env, rulesets, protected branches) |
| GitHub: 100 secrets por repo | Por repo | ~20 (inferência: 3–4 por produto + compartilhados) | Não muda com plano. Environments (Pro/Team) dão +100 por environment |
| **Neon: 100 projetos** | Por organização (inferência) | **50** (prod + `<produto>-preview`) | Scale (1.000). Launch continua com 100 |
| Neon: 20 GB de storage somados | Por conta | ~20 com produção perto de 1 GB, mais se pequenos | Launch (sem teto, pago por uso) |
| Neon: 1 GB storage, 100 CU-h, 5 GB egress por mês | Por projeto | Não limita | Launch, se um produto precisar de mais |
| Neon: 10 branches | Por projeto | Não limita (≤ 9 previews simultâneos por produto) | Launch/Scale com extra branches |
| **Workers: 100 mil requests/dia** | Por conta, somado entre Workers | Depende do tráfego de `/api/*` (assets não contam) | Workers Paid ($5/mês por conta) |
| Workers: 100 Workers | Por conta | 100 (1 por produto) | Paid |
| Workers: 10 ms CPU, 64 vars, 64 MiB | Por request / por Worker | Não limita | Paid |
| Workers: 5 Cron Triggers | Por conta | 5 produtos com cron (hoje sem cron) | Paid |
| Durable Objects: 100 classes | Por conta | **50** (2 classes por produto) | Paid (500) |
| DO: 5 GB storage, 100 mil req/dia, 100 mil rows escritas/dia | Por conta (storage explícito; cotas diárias inferidas) | Somado entre produtos | Paid |
| KV: 1.000 namespaces | Por conta | 500 (prod + preview por produto) | — |
| KV: 1 GB storage, 1.000 escritas/dia, 100 mil leituras/dia | Storage por conta; operações por conta (inferência) | Somado entre produtos | Paid |
| Previews: 100 por Worker, 100 deployments por Preview | Por Worker | Não limita | Paid (500 por Worker) |
| Rotas 1.000 e custom domains 100 | Por zona | Não limita (1 zona Free por produto) | — |
| Zonas (domínios) | Por conta, sem teto publicado | Não limita (o registro do domínio é pago, exceção aceita) | — |
| Email Sending da Cloudflare | Por conta | 0 (não existe no Free) | Workers Paid |

## Lacunas

- Se requests a Previews contam nos 100 mil/dia do Workers Free, e se os namespaces DO de Preview contam nas 100 classes e nos 5 GB.
- Se as cotas diárias de KV e DO são por conta ou por namespace (as páginas não dizem).
- Se o Resend conta `*.resend.app` entre os 3 domínios, e se a política aceita várias contas Free da mesma pessoa.
- A unidade do limite de 100 projetos da Neon (conta ou organização).
