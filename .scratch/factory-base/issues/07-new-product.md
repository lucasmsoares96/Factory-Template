# 07: `new-product` e molde

Spec: [../spec.md](../spec.md)

**What to build:** um dev roda `pnpm new-product <id>` e ganha um Product novo que já sobe com `pnpm dev <id>`, passa no `verify` e roda os E2E do Skeleton, sem editar nenhum arquivo do Skeleton. O `example` passa a ser exatamente o que o molde gera.

**Blocked by:** 06

**Status:** done

- [x] Molde dentro do pacote do Skeleton; `pnpm new-product <id>` cria `apps/<id>/`, registra o Product no workspace e mostra o comando do bootstrap.
- [x] Identidade em `product.config.ts` (`id`, `title`, `emailFrom`, domínio); tema por tokens do shadcn e textos do i18n por cima.
- [x] Interface `Feature` (`id`, `api`, `mcp?`, `nav?`, `companyPage?`, `seed?`, `events?`) exportada pelo Skeleton; features e roles a mais (`INSERT` em `member_roles`) do Product entram por ela. A interface (os tipos e a montagem em `createApp`) está completa. **Adiado, fora deste critério:** `messages.ts` e códigos de erro por feature, e a ligação do `seed` ao E2E e ao branch `base` do Neon (ver Comments e ticket 15).
- [x] Cada Product tem o seu snapshot do `tools/list` e as suas migrations, aplicadas depois das do Skeleton.
- [x] Specs de E2E do Skeleton ficam no pacote e rodam no `e2e` de cada Product.
- [x] `pnpm dev` sobe o Product quando há um só e pede `pnpm dev <id>` quando há vários.
- [x] O molde gera o `AGENTS.md` do Product (conteúdo final no ticket 11).
- [x] Teste: `new-product` numa cópia temporária + `verify` passa, e a cópia é apagada no fim.

## Comments

Implementado em 2026-10-19. Nenhuma dependência nova (só built-ins do Node 24 e o que já está no `catalog`); registrado em `notes/versions.md`.

O que ficou:
- Molde em `packages/skeleton/template/` (`{{id}}`, `{{title}}`, `{{domain}}`). `pnpm new-product <id> [--title] [--domain] [--no-install]` (`skeleton new-product`, `src/node/products.ts`) valida o id (minúsculas, dígitos e hífens), copia o molde para `apps/<id>/`, roda `pnpm install` (o glob `apps/*` é o registro; o install atualiza o lockfile) e `generate` (arquivos `*.gen.*` commitados), e mostra `pnpm dev <id>` e `pnpm bootstrap product <id>`.
- `apps/example` é exatamente a saída do molde para `example` (teste `test/new-product.test.ts` compara arquivo a arquivo com os rastreados pelo Git, exceto `*.gen.*`, que vêm do `generate`). Ele ganhou `product.config.ts`, `src/features/index.ts` e `AGENTS.md`; perdeu `src/client/messages.ts` (agora `messages` está no `product.config.ts`).
- `product.config.ts` (`defineProduct` de `@workspace/skeleton/product`, subpath novo, sem código de servidor para a SPA poder empacotar): `id`, `title`, `emailFrom`, `domain`, `messages`. Tema: tokens do shadcn em `src/client/styles.css`. `createApp({ product, features, mcpTools })` substitui `title`/`emailFrom`/`messages`/`routers`.
- `Feature` (`platform/feature.ts`, exportada de `@workspace/skeleton`): `id`, `api(app)`, `mcp?(server)`, `nav?`, `companyPage?`, `seed?(db)`, `events?`. `createApp` monta cada `api` num `createRouter()` sob `/api` (as rotas entram no OpenAPI e viram tools); `mcp` roda a cada request de `/mcp` (teste com a tool manual `manualPing` na composição de teste); ids repetidos falham; `seedFeatures()` roda os seeds em ordem. A composição de teste do Skeleton usa uma `Feature` no lugar do `routers`.
- Rotas de UI por convenção: `src/features/<id>/routes/` (logado) e `src/features/<id>/public/` (visitante, ao lado do login), ambas montadas por `physical()` em `/<id>`, pelo mesmo `featureRoutes()` no `skeleton generate` e no plugin do Vite (antes o `generate` não via as rotas passadas ao plugin). Fecha a pendência do ticket 04 (rotas públicas de Product).
- Schemas por glob e migrations por Product já vinham do ticket 01 (`defineProductDrizzleConfig`, `drizzle/` do Product depois das do Skeleton); o snapshot `src/mcp-tools.gen.json` é por Product (o molde traz `[]`, o `generate` escreve o real). Os specs de E2E ficam em `packages/skeleton/e2e/` e o `playwright.config.ts` de cada Product os roda.
- `pnpm dev [id]` (`scripts/dev.ts`): um Product só sobe sozinho; vários pedem `pnpm dev <id>`; sem Product, aponta `pnpm new-product`.
- `pnpm factory:ci-probe` (`scripts/ci-probe.ts`): copia o repo (arquivos do Git, sem `.scratch`/`.agents`/`.claude`) para um tmp com `git init -b main`, roda `pnpm new-product ci-probe` e `node scripts/verify.ts --filter ci-probe` (generate, typecheck, lint, test, e2e só do Product), e apaga a cópia e os projetos `docker compose` que nasceram dela no `finally` e em SIGINT/SIGTERM. `scripts/verify.ts` ganhou `--filter <pacote>`.

O `ci-probe` achou um bug real do molde na primeira execução: o plugin do Vite da Cloudflare nomeia a pasta de saída de um jeito próprio (`ci-probe` vira `ci_probe`), e o E2E assumia `dist/<id>/`. Agora `builtWorkerConfig()` (`@workspace/skeleton/node`) lê o redirect `.wrangler/deploy/config.json` que o plugin escreve (teste `test/built-worker.test.ts`). `pnpm factory:ci-probe` passou ponta a ponta (cópia + `new-product` + verify do Product), sem sobras de container nem de pasta temporária.

Decisões:
- O `ci-probe` NÃO roda dentro do `factory:verify`: precisa de um `pnpm install` completo e de um build de produção, o que dobraria o `verify`. O ticket 12 chama `pnpm factory:ci-probe` como o job `ci-probe`. O que o `verify` já cobre do molde: o teste que compara `example` com a saída do molde (um molde que quebra o `example` falha no `verify`).
- `emailFrom` do `example` passou de "Example <no-reply@example.com>" a derivar do molde (`<Title> <no-reply@<id>.com>`), o mesmo valor; o título pt-BR do `example` era "Exemplo" e agora é "Example" nos dois idiomas (o molde não traduz o nome do Product).

Desvios (o que não entrou, por não haver consumidor ainda):
- Códigos de erro próprios do Product e `messages.ts` por feature como campo da `Feature`: o `ErrorCode` e a tabela `errors` do i18n são uniões fechadas do Skeleton; abri-los (e o `DeepPartial` dos overrides) pede decisão de tipos que só faz sentido com a primeira feature de Product real. Hoje a feature traz `messages.ts` e o `product.config.ts` o espalha em `messages`. A interface cresce quando a primeira feature precisar.
- `nav`, `companyPage` e `events` estão só nos tipos: quem renderiza e emite são as features `account`/`companies` da Factory. O `seed` não está ligado ao E2E nem ao branch `base` do Neon (ticket 15).
- O `AGENTS.md` do Product é um marcador; o conteúdo final vem no ticket 11.
