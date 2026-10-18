# Layout do monorepo e fronteira do Strip

Type: grilling
Status: resolved

## Question

Como o código do template se organiza em pacotes e diretórios, e como o Strip separa a Reference App do Skeleton e deixa o Skeleton verde? A fronteira de domínio já está fechada ([Modelo de organização da Reference App](10-organization-model.md), [Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md)). A hospedagem também: um único Worker com a SPA e o Hono em `/api/*` e `/mcp` ([Trocas na stack](13-stack-swaps.md)), e `.factory/` como pacote à parte, que o Strip não toca ([Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md)). Pontos a fechar (usar `codebase-design`):

- **Pacotes do workspace**: um pacote só para o Worker (SPA + API + MCP + DOs `PasswordHasher`/`RateLimiter`), ou a separação em `apps/` e `packages/` (schema Drizzle, contrato OpenAPI, cliente gerado pelo Kubb, templates de email, UI shadcn). O que cada um exporta, e quais tasks do Turborepo existem por trás de `pnpm factory:verify`.
- **Unidade de corte do Strip**: módulos por feature (back e front lado a lado), pacotes da Reference App, ou marcadores no código. Como as features se registram: rotas do Hono, rotas do TanStack Router, tools do MCP, handlers do MSW, testes `@evidence`.
- **Pontos de extensão no Skeleton**: a role Manager, que só existe na Reference App, entra como extensão do enum de roles ou como tabela própria? O que a Reference App acrescenta aos menus, à página da Company e às regras de permissão.
- **Migrations do Drizzle**: como o histórico continua coerente depois do Strip (migrations separadas por módulo, o Skeleton sempre antes, ou regeneração das migrations no Strip).
- **Forma do Strip**: um comando (`pnpm strip`) que apaga caminhos de um manifesto e edita registros, ou só apagar diretórios. Quem garante que o Strip continua verde: um job de CI que roda o Strip e o `factory:verify` a cada PR, ou só na release do template.
- **Código gerado** (Kubb, rotas): commitado ou gerado no build, e como isso afeta o Strip e o diff dos PRs da Factory.

## Progresso do grilling (rodada 1)

- **Pacotes**: o workspace tem só dois, `app/` e `.factory/`. O `app/` reúne o Worker inteiro (SPA, API, MCP, DOs), os testes e o `docker-compose.yml` do Postgres de teste. Pacotes em `packages/` teriam um consumidor só, e seriam seams hipotéticos.
- **Unidade de corte**: fatias verticais em `app/src/features/<feature>/`, com schema, rotas Hono, tools MCP, telas, emails e testes. Cada feature exporta um objeto `Feature`, e as da Reference App ficam listadas num arquivo só (`features/reference.ts`). O Strip apaga as pastas e esvazia esse arquivo. As rotas da UI ficam em `features/<feature>/routes/`, juntadas com `physical()` do `@tanstack/virtual-file-routes`. Falta testar se o caminho `../features/...` funciona; se não funcionar, ficam em `src/routes/<feature>/`.
- **Quando o Strip roda**: uma vez só, numa cópia recém-criada do template, antes do bootstrap e do primeiro deploy, e sem volta. Tirar a Reference App de um produto em produção é trabalho manual, com uma migration própria.
- **Garantia de que o Skeleton continua verde**: um job no CI do repositório do template, em todo PR (os da Factory incluídos), roda o Strip numa cópia e depois o `pnpm factory:verify`. O próprio Strip apaga esse job e o comando.
- **Código gerado**: o cliente Kubb e o OpenAPI não vão para o git. O `pnpm generate` importa o app, chama `app.getOpenAPI31Document()` e roda o Kubb antes do typecheck e dos testes. O `routeTree.gen.ts` é commitado, como manda o FAQ do TanStack Router.
- **Fatos**: o Drizzle v1 RC (`1.0.0-rc.4`) grava uma pasta por migration, com `migration.sql` e `snapshot.json`, e sem journal. O `schema` aceita glob. Ter um histórico de migrations por módulo não é suportado: as chaves estrangeiras entre módulos quebram. _(Corrigido em [Puxar o Skeleton upstream num produto privado](28-upstream-skeleton-sync.md): com o Skeleton num schema Postgres próprio, a FK sai certa no rc.4; a pasta única continua, porque a ordem e o rename quebram nos dois casos.)_

## Progresso do grilling (rodada 2)

- **Migrations**: uma pasta só (`app/drizzle/`). O Strip apaga essa pasta e roda `drizzle-kit generate`, que gera uma migration inicial só, a partir do schema da Skeleton. Isso é seguro porque o Strip roda antes do primeiro deploy. O job de CI do Strip aplica essa migration num Postgres vazio antes do `verify`.
- **Turborepo fica**, como em [Trocas na stack](13-stack-swaps.md), mesmo com só dois pacotes.
- **Tudo é feature**: `app/src/platform/` guarda a base (app Hono, cliente do banco, Better Auth, `createMcpHandler`, DOs, layout da SPA, outbox), e o Strip não mexe nela. As features da Skeleton (`auth`, `account`, `companies`, `invitations`) ficam listadas em `features/skeleton.ts`, e as da Reference App em `features/reference.ts`. Interface da `Feature`: `{ id, api(app), mcp?(server), nav?, companyPage?, seed?(db), routesDir }`. Os schemas são achados pelo glob `src/features/**/schema.ts`, os handlers MSW saem do Kubb e os testes ficam dentro da pasta da feature.
- **Manager no enum da Skeleton**: `member_role` já traz `owner | employee | manager` na Skeleton, e o Strip não mexe nele. Isso revê em parte [Modelo de organização da Reference App](10-organization-model.md) e [Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md): o Strip tira o que o Manager pode fazer, mas o valor continua no enum. Detalhes na rodada 3.
- **Strip**: `pnpm strip` (`scripts/strip.ts` + manifesto). As features da Reference App ficam em `app/src/features/reference/<feature>/`, e o manifesto lista só o que está fora dali. Passos: apagar as pastas, esvaziar `features/reference.ts`, regenerar as migrations e o `routeTree.gen.ts`, apagar o próprio script, o manifesto e o job de CI, rodar o `verify` e mostrar o diff. Recusa rodar com a árvore suja. **Condição do usuário**: só vale se for o padrão de outros templates com app de exemplo. Pesquisa em andamento.
- **Fato (teste, TanStack Router 1.170.45, router-plugin 1.168.47, virtual-file-routes 1.162.0)**: `physical('/projects', '../features/reference/projects/routes')` funciona com a pasta fora de `src/routes`. `vite build` e `tsc` passam, e `$param` e layouts com e sem path saem certos. Apagar a pasta e a linha do `physical()` gera tudo limpo. Apagar só a pasta quebra o build (`ENOENT`). Um `<Link>` que sobrou apontando para uma rota apagada faz o `tsc` falhar, o que pega vazamento depois do Strip.
- **Fato (pesquisa: padrão de outros templates)**: o desenho segue a prática existente e é mais rigoroso que ela.
  - O Expo tem um script dedicado (`reset-project`) que move o exemplo para `/example` ou apaga.
  - O Ignite tem o `remove-demo`, que apaga, tem `--dry-run` e é testado no CI: depois do lint, do compile e dos testes, o `git diff` tem de sair vazio.
  - O `remix.init` se apaga depois de rodar.
  - Epic Stack, create-t3-app e Wasp não têm script.
  - Nenhum deles regenera migrations, exige a árvore do git limpa ou roda o verify no fim.
  - O Ignite marca o exemplo espalhado pelo código, e esses marcadores acabam aparecendo nos arquivos compartilhados. Por isso os arquivos esvaziados (`features/reference.ts`, `routes.reference.ts`) têm de ser os únicos pontos de contato.
  - Fontes: [reset-project.js](https://github.com/expo/expo/blob/main/templates/expo-template-default/scripts/reset-project.js), [remove-demo.ts](https://github.com/infinitered/ignite/blob/master/src/commands/remove-demo.ts), [teste do Ignite](https://github.com/infinitered/ignite/blob/master/test/vanilla/ignite-new-expo-router.test.ts), [Remix templates](https://v2.remix.run/docs/guides/templates).

## Progresso do grilling (rodada 3)

- **Manager depois do Strip**: a Skeleton mostra Manager na UI (convite e troca de role), como uma role sem poderes além dos de um Employee. O código depois do Strip não precisa ficar perfeito, porque quem usa o template vai ajustar mesmo. Na transferência de posse vale a regra de [Modelo de organização da Reference App](10-organization-model.md): o antigo Owner vira Manager.
- **Turborepo**: tasks `generate` (OpenAPI, Kubb e `routeTree`), `typecheck`, `lint`, `test` e `e2e`. Todas dependem de `generate`, e o `e2e` depende também de `build`. `pnpm factory:verify` = `turbo run typecheck lint test e2e`. O cache local fica ligado na máquina do dev e desligado no `build` do CI do preview e no `work` da Factory. Não há Remote Cache.
- **Barreira de imports**: `no-restricted-imports` do ESLint. Nada fora de `features/reference/` importa dali, com exceção de `features/reference.ts`. As linhas dessa regra estão no manifesto, e o Strip as apaga.
- **Rotas**: as montagens `physical()` da Reference App ficam em `src/routes.reference.ts`, e o `src/routes.ts` faz spread delas. O Strip esvazia esse arquivo. O `routesDir` sai da interface da `Feature`.
- **Strip (Q10 fechada)**: a condição do usuário está atendida, porque o padrão é comum (Expo, Ignite). Acrescenta `pnpm strip --dry-run`. O job de CI, depois do `verify`, roda `pnpm generate` e exige o `git diff` vazio.

## Progresso do grilling (rodada 4)

- **Eventos entre Skeleton e Reference App**: a Reference App aponta para a Skeleton e nunca o contrário. A remoção é só por chave estrangeira: Assignee com `ON DELETE SET NULL`, ligação com Team com `CASCADE`, Time Entries apontando para o usuário. O convite com Team é uma rota da Reference App: ela confere se quem convida é Manager daquele Team e chama `invitations.create(...)` da Skeleton. A ligação convite → Team mora numa tabela da Reference App. A `Feature` ganha `events?: { memberJoined?, companyDeleting? }`, e o `companyDeleting` apaga o prefixo no R2 antes do `DELETE`.
- **Árvore final** confirmada (ver Answer).

## Answer

> **Revisto em [Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md):** a Reference App sai do template, então o Strip, o manifesto e o job `strip-check` deixam de existir. O layout, a interface da `Feature` e a regra de imports ficam como convenção para apps construídas sobre o Skeleton. O Manager sai do Skeleton (role em `text` com chave estrangeira para a tabela `member_roles`), decidido no mesmo ticket.

**Pacotes**: o workspace tem só `app/` (o Worker inteiro: SPA, API, MCP, DOs, testes e o `docker-compose.yml` do Postgres de teste) e `.factory/`. O Turborepo fica. Tasks: `generate` (OpenAPI via `app.getOpenAPI31Document()`, Kubb e `routeTree`), `typecheck`, `lint`, `test` e `e2e`. Todas dependem de `generate`, e o `e2e` também de `build`. `pnpm factory:verify` = `turbo run typecheck lint test e2e`. O cache local fica ligado no dev e desligado no `build` do preview e no `work`. Sem Remote Cache.

**Árvore**:
```
/
├── package.json            # factory:verify, generate, strip
├── pnpm-workspace.yaml     # app, .factory; catalog; peerDependencyRules (MSW)
├── turbo.json
├── .factory/               # o Strip não mexe
├── .github/workflows/      # factory-*, preview, deploy, strip-check
├── scripts/strip.ts        # + strip.manifest.json
└── app/
    ├── wrangler.jsonc  docker-compose.yml
    ├── drizzle/            # uma pasta só; o Strip regenera
    └── src/
        ├── platform/       # Hono, db, Better Auth, MCP handler, DOs, outbox, layout da SPA
        ├── routes.ts  routes.reference.ts  routeTree.gen.ts (commitado)
        ├── gen/            # Kubb + openapi.json, fora do git
        └── features/
            ├── skeleton.ts  reference.ts
            ├── auth/ account/ companies/ invitations/
            └── reference/  # teams/ projects/ pipelines/ tasks/ sprints/ time/ attachments/
```

**Features**: tudo é feature, inclusive a Skeleton. Cada feature tem `schema.ts`, `api.ts`, `mcp.ts`, `routes/`, `emails/`, `seed.ts` e os testes. Interface da `Feature`: `{ id, api(app), mcp?(server), nav?, companyPage?, seed?(db), events?: { memberJoined?, companyDeleting? } }`. Os schemas entram pelo glob `src/features/**/schema.ts`. As rotas da UI entram por `physical()` do `@tanstack/virtual-file-routes`, e as da Reference App ficam em `routes.reference.ts` (testado com pasta fora de `src/routes`). O seed alimenta o branch `base` do Neon de preview e o E2E.

**Fronteira**: a Reference App aponta para a Skeleton, nunca o contrário. A remoção vai por chave estrangeira (`SET NULL` no Assignee, `CASCADE` na ligação com Team, Time Entries no usuário). O convite com Team é uma rota da Reference App que chama `invitations.create(...)` da Skeleton, e a ligação convite → Team mora numa tabela da Reference App. Um `no-restricted-imports` impede importar `features/reference/` fora de `features/reference.ts`. Essa regra vai para o `AGENTS.md` de `app/`.

**Manager**: `member_role` é `owner | employee | manager` já na Skeleton, e a Skeleton mostra Manager no convite e na troca de role. Sem Teams, o Manager tem exatamente os direitos de um Employee. O antigo Owner continua virando Manager na transferência. Isso revê [Modelo de organização da Reference App](10-organization-model.md) e [Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md), que tiravam o Manager no Strip. O código depois do Strip não precisa ficar perfeito.

**Strip**: `pnpm strip` (`scripts/strip.ts` + manifesto com o que fica fora de `features/reference/`). Roda uma vez só, numa cópia recém-criada, antes do bootstrap e do primeiro deploy, e recusa rodar com a árvore do git suja. Passos:
1. apaga `features/reference/` e o que o manifesto lista (incluindo as linhas da regra de lint);
2. esvazia `features/reference.ts` e `routes.reference.ts`;
3. apaga `app/drizzle/` e regenera uma migration inicial só, mais o `routeTree.gen.ts`;
4. apaga o script, o manifesto e o job `strip-check`;
5. roda o `verify` e mostra o diff.

Tem `--dry-run`. O job `strip-check` roda em todo PR do template: Strip numa cópia, migration num Postgres vazio, `verify`, depois `pnpm generate` e exige `git diff` vazio. O padrão segue Expo (`reset-project`) e Ignite (`remove-demo`) e é mais rigoroso que eles.

**Código gerado**: o Kubb e o `openapi.json` ficam fora do git. O `routeTree.gen.ts` é commitado, como manda o FAQ do TanStack.
