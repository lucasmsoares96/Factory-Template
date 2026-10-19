# Vários produtos num repo só

Type: grilling
Status: resolved
Blocked by: 31

## Question

O usuário quer um repo privado com vários produtos separados (cada um com seus usuários, domínio, Worker e banco), e não um repo por produto, porque é mais fácil de manter. O template de hoje supõe um produto por cópia: workspace com só `app/` ([Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md)), um `APP_NAME`, um Worker, um projeto Neon e um domínio no Resend ([Bootstrap do template público](26-template-bootstrap.md)). Como o template passa a comportar N produtos? Pontos a fechar (usar `codebase-design`):

- **Forma**: (a) `apps/<produto>/`, um Worker por produto, com o Skeleton (a `platform/` e as features do Skeleton) num pacote compartilhado; (b) um Worker só, com o produto escolhido pelo hostname; (c) outra. O que cada produto pode sobrescrever no Skeleton (textos, tema, roles a mais, telas).
- **O template público**: já sai com a estrutura de vários produtos (com um produto só, o exemplo) ou só o repo privado muda? Sem `upstream`, uma estrutura diferente no privado não recebe as melhorias da Factory.
- **Banco e migrations**: um banco por produto, com o schema do Skeleton + o do produto. Uma mudança no Skeleton atinge todos os produtos, então volta a regra "nunca alterar migration publicada" e talvez a de schema só por expansão ([Puxar o Skeleton upstream num produto privado](28-upstream-skeleton-sync.md)).
- **Bootstrap**: módulos por produto (`pnpm bootstrap product <nome>`?), nomes de secrets, variáveis e environments por produto, projeto `<produto>-preview` por produto, `destroy` por produto.
- **CI**: `verify`, preview e deploy só dos produtos afetados pelo PR; um PR que mexe no Skeleton afeta todos; um preview por produto afetado, com o limite de previews simultâneos ([Segurança do CI do PR com código da Factory](19-pr-ci-security.md), [Ambiente de preview por PR](05-pr-preview-environments.md)).
- **Factory**: como a issue diz o produto (label `product:<nome>`?), o `factory:verify` escopado, prints e E2E contra o preview do produto certo, a Triage ([Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md), [Contrato de cada Stage e do loop](15-stage-contracts.md)).
- **MCP**: um servidor por produto, cada um com a sua OpenAPI ([Ferramentas do MCP do Skeleton](23-reference-app-mcp-tools.md)).
- **Limites gratuitos somados**: os fatos de [Limites gratuitos com vários produtos](31-multi-product-free-limits.md) decidem quantos produtos cabem de graça e o que muda de plano.
- **O que isso revê** em [Fronteira entre a base e o backlog da Factory](29-base-vs-factory-backlog.md): o que entra na base e como fica o backlog do Skeleton.

## Answer

Decidido em 2026-10-19 com o usuário. Fatos em [Limites gratuitos com vários produtos](31-multi-product-free-limits.md) e [Runner próprio no repo privado](32-self-hosted-runner.md).

**Forma**
- O template público já sai com a estrutura de N **Products** (termo novo no glossário) e um de exemplo, `apps/example/`.
- Um Worker por Product (`apps/<id>/`), com `wrangler.jsonc`, DOs, `OAUTH_KV` e Previews próprios.
- O Skeleton é um pacote compartilhado (`packages/skeleton/`: `platform/`, as features `auth`, `account`, `companies`, `invitations`, migrations, molde do `new-product`, specs de E2E). Cada Product é uma raiz de composição fina pela interface `Feature`. Uma mudança no Skeleton atinge todos os Products, de propósito.
- O Product só **estende**: configuração (nome, título, remetente, tema por tokens do shadcn, textos do i18n por cima), features próprias e roles a mais por `INSERT` em `member_roles`. Não substitui tela nem regra do Skeleton; se faltar algo, a interface do Skeleton cresce.
- `pnpm new-product <id>` cria `apps/<id>/` a partir do molde do pacote e mostra o comando do bootstrap. A cópia pode apagar o `example`.

**Layout**
```
/
├── apps/<id>/            # product.config.ts, wrangler.jsonc, drizzle/, src/features/, routes.ts, AGENTS.md
├── packages/skeleton/    # platform/, features/, drizzle/, molde, e2e/, AGENTS.md
├── .factory/             # AGENTS.md
└── AGENTS.md  turbo.json  pnpm-workspace.yaml (apps/*, packages/*, .factory)
```
- Um Product importa só os exports públicos do Skeleton; o Skeleton nunca importa de `apps/` (lint).
- O `AGENTS.md` de `app/` se divide entre o do pacote e o que o molde gera.
- `pnpm dev` sobe o Product único ou pede `pnpm dev <id>`.

**Banco**: um banco por Product. As migrations do Skeleton ficam no pacote, num schema Postgres e numa `migrationsTable` próprios, e rodam antes das do Product (dois configs com globs disjuntos, testados em [Puxar o Skeleton upstream num produto privado](28-upstream-skeleton-sync.md)). Só a regra "migration publicada é imutável" volta, agora valendo também para o pacote. A regra "schema só por expansão" não volta, porque o CI recria do zero, e também a partir da `main`, o banco de cada Product afetado.

**Bootstrap**
- A identidade fica em `apps/<id>/product.config.ts` (`id`, `title`, `emailFrom`, domínio) e substitui `APP_NAME`/`APP_TITLE`. Worker `<id>`, projetos Neon `<id>` e `<id>-preview`.
- Parte comum (Cloudflare, machine user, token do Claude, labels) + `pnpm bootstrap product <id>` (Produção e Previews). `doctor` e `destroy` aceitam `product <id>`.
- Secrets comuns sem prefixo, os do Product com `<ID>_`. Environments `<id>-production` e `<id>-preview` onde a API aceitar. `DEPLOY_PRODUCTS` e `PREVIEW_PRODUCTS` como listas de ids. `FACTORY_ENABLED` continua único.
- Resend: remetente por Product (`emailFrom`), uma API key por Product restrita ao domínio dele. Um domínio por Product até o 3º; do 4º em diante, o usuário escolhe entre o Pro e reaproveitar um domínio. A cota de 100/dia é da conta.

**CI**
- Checkout com `--filter=blob:none`. `turbo query affected --packages` monta a matrix dos Products afetados (`fail-fast: false`). Os arquivos da raiz vão em `globalDependencies`. `.factory/` e `.github/` só rodam os testes do harness.
- `factory:verify` = `turbo run … --affected` no CI e na Factory; no local, roda tudo.
- Preview `pr-N`, smoke e deploy por Product afetado; o comentário do preview lista cada Product. Limite de 9 previews por Product. Um PR só do Skeleton sobe tudo em todos os Products.
- Runner: `runs-on: ${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}` só no `work` e no `build`, como em [Runner próprio no repo privado](32-self-hosted-runner.md). O template público fica no runner hospedado.

**Testes do Skeleton**: os unitários e de integração ficam no pacote e rodam uma vez, contra uma composição só de teste. Os specs de E2E do Skeleton ficam no pacote e cada Product os roda no seu `e2e`. Eles localizam elementos por role + chave do i18n (ou `data-testid`), nunca pelo texto; essa regra vai para a skill `skeleton-*` de testes.

**Factory**: label `product:<id>` criada pelo bootstrap; sem label, a mudança é no Skeleton. A Triage confere a label e a acrescenta quando o caso é claro. O escopo do `verify` vem do diff, e a label só orienta onde mexer. Os prints `@evidence` saem de todos os Products afetados, agrupados por Product no comentário único.

**MCP**: um `/mcp` por Worker, com `OAuthProvider` e `OAUTH_KV` próprios; o token de um Product não vale em outro. O gerador fica no pacote e roda sobre a OpenAPI composta de cada Product, com um snapshot do `tools/list` por Product. "Conexões" é do Skeleton.

**Revisão de [Fronteira entre a base e o backlog da Factory](29-base-vs-factory-backlog.md)**: a base passa a incluir a divisão entre pacote e `example`, o `new-product`, o bootstrap por Product, a matrix de afetados e o E2E do Skeleton por Product. Base pronta exige também um teste de CI com `new-product ci-probe` numa cópia temporária + `verify`, sem deploy. O backlog do Skeleton não muda (issues sem `product:`, com previews e prints do `example`). O ADR "vários Products num repo, Skeleton como pacote compartilhado" entra no último ticket da base.

## Comments

**Rodada 1 (2026-10-19)**
- **Template já com vários produtos**: o template público sai com a estrutura de N produtos e um produto de exemplo. Bootstrap, CI e Factory conhecem "o produto X" desde o núcleo; com um produto só, a label de produto é opcional.
- **Um Worker por produto** (`apps/<produto>/`), cada um com o seu `wrangler.jsonc`, DOs, `OAUTH_KV` e Previews. Um Worker só, escolhendo pelo hostname, não economiza nada (os tetos são por conta) e junta tudo num ponto de falha.
- **Skeleton como pacote compartilhado** (`platform/` + features do Skeleton). Cada `apps/<produto>/` é uma raiz de composição fina pela interface `Feature` de [Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md). Uma mudança no Skeleton afeta todos os produtos, de propósito.
- **Minutos do Actions**: o template aceita um runner próprio por variável (`runs-on: ${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}`), com o hospedado como padrão. Cobrança, segurança e requisitos do runner próprio vão para [Runner próprio no repo privado](32-self-hosted-runner.md).
- **Resend**: o remetente é configuração de cada produto (`EMAIL_FROM` com o domínio verificado que o usuário quiser). Um domínio por produto até o 3º; do 4º em diante, o usuário escolhe entre Pro e reaproveitar um domínio. A cota de 100/dia é da conta. Uma API key por produto, restrita ao domínio dele.
- **Glossário**: termo **Product** criado; **Template** e **Skeleton** ajustados (o Skeleton é a base compartilhada, nunca vai para produção sozinho).

**Rodada 2 (2026-10-19)**
- **O Product só estende o Skeleton**: configuração (nome, título, remetente, tema por tokens do shadcn, textos do i18n por cima dos do Skeleton), features próprias pela interface `Feature` e roles a mais por `INSERT` em `member_roles`. Não substitui tela nem regra do Skeleton. Se precisar de algo que a interface não dá, a interface do Skeleton cresce.
- **Product de exemplo**: o template sai com `apps/example/`, o Skeleton composto sem features próprias, alvo do deploy, do preview e do E2E no repo público. `pnpm new-product <id>` cria `apps/<id>/` a partir de um molde que mora no pacote do Skeleton, registra o Product e mostra o comando do bootstrap. A cópia pode apagar o `example`.
- **Migrations**: as do Skeleton ficam no pacote, com pasta e `migrationsTable` próprias (schema Postgres próprio, dois configs com globs disjuntos, como testado em [Puxar o Skeleton upstream num produto privado](28-upstream-skeleton-sync.md)), aplicadas antes das de cada Product. Só volta a regra "migration publicada é imutável", agora também no pacote. "Schema só por expansão" não volta: o CI recria o banco de cada Product afetado do zero e a partir da `main`.
- **Bootstrap**: identidade em `apps/<id>/product.config.ts` (`id`, `title`, `emailFrom`, domínio), no lugar de `APP_NAME`/`APP_TITLE`. Worker `<id>`, projetos Neon `<id>` e `<id>-preview`. Parte comum (Cloudflare, machine user, token do Claude, labels) + `pnpm bootstrap product <id>` (Produção e Previews); `doctor` e `destroy` aceitam `product <id>`. Secrets comuns sem prefixo e os do Product com `<ID>_`; environments `<id>-production` e `<id>-preview` onde houver. `DEPLOY_PRODUCTS` e `PREVIEW_PRODUCTS` como listas de ids; `FACTORY_ENABLED` continua único.
- **CI**: checkout com `--filter=blob:none`; `turbo query affected --packages` monta a matrix dos Products afetados (`fail-fast: false`); arquivos da raiz em `globalDependencies`; `.factory/` e `.github/` só rodam os testes do harness. `factory:verify` = `turbo run … --affected` no CI e na Factory, tudo no local. Preview `pr-N`, smoke e deploy por Product afetado; o comentário do preview lista cada Product com a URL. Limite de 9 previews por Product. Um PR só do Skeleton sobe tudo de todos os Products.
- **Factory**: label `product:<id>` criada pelo bootstrap; sem label, a mudança é no Skeleton. A Triage confere a label e a acrescenta se o caso for claro. O escopo do `verify` vem do diff; a label só orienta onde mexer. Prints `@evidence` de todos os Products afetados, agrupados por Product no comentário único.

**Rodada 3 (2026-10-19)**
- **MCP por Product**: cada Worker serve o seu `/mcp`, com `OAuthProvider` e `OAUTH_KV` próprios. O gerador fica no pacote do Skeleton e roda no `pnpm generate` de cada Product, sobre a OpenAPI composta. Um snapshot do `tools/list` por Product. "Conexões" é do Skeleton. Um token não vale em outro Product.
- **Testes do Skeleton**: unitários e de integração no pacote, contra uma composição só de teste, uma vez só. Os specs de E2E do Skeleton ficam no pacote e cada Product os roda no seu `e2e`. Eles localizam por role + chave do i18n (ou `data-testid`), nunca pelo texto; a regra vai para a skill `skeleton-*` de testes.
- **Layout**: `apps/<id>/` + `packages/skeleton/` + `.factory/`. O `AGENTS.md` de `app/` se divide entre o pacote e o molde. Um Product importa só os exports públicos do Skeleton, e o Skeleton nunca importa de `apps/`. `pnpm dev` sobe o Product único ou pede `pnpm dev <id>`.
- **Revisão da base**: entram a divisão pacote/`example`, o `new-product`, o bootstrap por Product, a matrix de afetados e o E2E do Skeleton por Product. Base pronta exige um teste de CI com `new-product ci-probe` numa cópia temporária + `verify`, sem deploy. O backlog do Skeleton não muda (issues sem `product:`, previews e prints do `example`). ADR "vários Products num repo, Skeleton como pacote compartilhado" no último ticket da base.
