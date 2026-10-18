# Pesquisa 28: Puxar o Skeleton upstream num produto privado

Ticket: [28-upstream-skeleton-sync](../issues/28-upstream-skeleton-sync.md) · Pesquisado em 2026-10-18 · Só fontes primárias:
- código publicado de `drizzle-kit@1.0.0-rc.4` (`bin.cjs`: `src/commutativity/engine.ts`, `src/dialects/postgres/commutativity.ts`, `src/cli/commands/check.ts`, `prepareSnapshot`, `prepareOutFolder`) e de `drizzle-orm@1.0.0-rc.4` (`migrator.js`, `migrator.utils.js`, `pg-core/async/session.js`);
- docs do Drizzle ([v0 → v1 updates](https://orm.drizzle.team/docs/v0-v1-changes), [`drizzle-kit check`](https://orm.drizzle.team/docs/drizzle-kit-check), [Migrations for teams](https://orm.drizzle.team/docs/kit-migrations-for-teams)), a discussion e as issues do `drizzle-team/drizzle-orm`;
- docs do pnpm, do git (`gitattributes`), do TanStack Router e as issues dele;
- docs de upgrade de Epic Stack, Jumpstart Pro, Bullet Train e Open SaaS (Wasp).

Quando a conclusão vem de um experimento local, e não de documentação, isso aparece como **(teste)**.

Versões consultadas: `drizzle-orm` e `drizzle-kit` **1.0.0-rc.4** (dist-tag `rc`, publicada em 2026-06-27; há snapshots `1.0.0-rc.5-*` até 2026-09-09, sem rc.5 estável; a `latest` do kit ainda é 0.31.11 e a do ORM 0.45.4). `pg` 8.23.1. Postgres 17.11 (Docker). Node 26.3.0. pnpm 10.28.1 local (a `latest` no npm é 12.14.0). git 2.50.1. `@tanstack/react-router` 1.170.45, `@tanstack/router-cli` 1.167.45, `@tanstack/virtual-file-routes` 1.162.0.

## Resposta

**1. O merge ingênuo funciona no caso comum, porque o Drizzle v1 trata o histórico como um grafo.**
- Cada `snapshot.json` tem `id` e `prevIds: string[]`. O `drizzle-kit check` monta um DAG com eles, acha as bifurcações e compara o diff de cada ramo. A doc oficial chama isso de detecção de migrations "non-commutative" ([v0 → v1](https://orm.drizzle.team/docs/v0-v1-changes)).
- **O migrator aplica pelo nome da pasta, não pelo timestamp.** Ele aplica "every missing migration, regardless of timestamp ordering", em ordem alfabética e numa transação só. O hash fica gravado, mas não é comparado.
- **(teste)** O upstream gerou `invitations` antes de o produto gerar `app_tasks`, e o merge chegou depois. Resultado:
  - o `git merge` não teve conflito (cada migration é uma pasta nova);
  - o `check` passou;
  - o `generate` não teve diff;
  - o `migrate` aplicou o `invitations` intercalado no banco que já estava no estado anterior do produto;
  - o banco novo aplicou tudo na ordem dos nomes;
  - os dois terminaram com o mesmo schema.
- **Nada de `DROP`.** O `generate` compara o schema TS inteiro (glob `src/features/**/schema.ts`) com o snapshot "anterior". Com um ramo só, o anterior é o último snapshot em ordem de nome. Com várias folhas que comutam, o anterior é o ancestral comum mais a união dos diffs das folhas, e a nova migration nasce com `prevIds` = todas as folhas (um nó de merge).
  - **(teste)** A migration do produto gerada depois do merge saiu só com o `ALTER TABLE "tasks" ADD COLUMN "status"` e `prevIds` com as duas folhas.
- **O risco real é o inverso: recriar o que já existe.**
  - **(teste)** Com `--ignore-conflicts`, o `generate` usou o snapshot do upstream (que não conhece `tasks`) e emitiu de novo `CREATE TABLE "tasks"`, o que falharia com "already exists".
  - A issue [#5764](https://github.com/drizzle-team/drizzle-orm/issues/5764) é o mesmo sintoma sem a flag, no rc.1. O autor confirmou que o rc.4 corrige.
- **O `check` pega conflito na mesma entidade.** **(teste)** O produto e o upstream acrescentaram `companies.plan`. O `git merge` deu conflito no `schema.ts`, e o `check` apontou "Non-commutative migrations detected … add_column: plan on companies table".
  - O `generate` e o `drizzle-kit migrate` também recusam.
  - Já o `migrate()` do ORM, que não roda o check, falhou com "column plan already exists" e fez rollback.
- **O `check` não pega rename ou drop no Skeleton de algo que a FK do produto referencia.**
  - O footprint de `create_fk` cobre só a tabela dona da FK, e não a tabela referenciada.
  - **(teste)** O upstream renomeou `companies` → `organizations`, e o produto criou `projects` com FK para `companies` num ramo paralelo. O `check` disse "Everything's fine". O banco do produto migrou bem. **O banco novo quebrou** ("relation companies does not exist"), porque o rename tem timestamp anterior.
- **Fluxo documentado:**
  - A [discussion #5005](https://github.com/drizzle-team/drizzle-orm/discussions/5005) (Andrii Sherman, mantenedor, 2025-10-31) recomenda, em caso de conflito, "removing the conflicted migration (and all subsequent migrations) from the target branch", depois sincronizar e gerar de novo.
  - A página [Migrations for teams](https://orm.drizzle.team/docs/kit-migrations-for-teams) continua um placeholder.
  - Não existe "rebase de migrations" nem um `drizzle-kit up` para isso: o `up` só converte o formato antigo.

**2. Saídas: nenhuma alternativa supera a pasta única. A garantia vem de regras do Skeleton e de um gate.**
- **Skeleton num schema Postgres próprio, com `migrationsTable` separada.**
  - **(teste)** Funciona com dois `drizzle.config` de globs disjuntos. A config do produto gera `REFERENCES "skeleton"."companies"` sem copiar as tabelas do Skeleton.
  - O `schemaFilter` não restringe o `generate` **(teste)**: com o glob inteiro, ele recria o schema `skeleton`.
  - Mas o rename continua quebrando o banco novo **(teste)**, e a separação ainda exige aplicar o Skeleton antes e nunca rodar a config do Skeleton no produto. Não compensa.
- **Regenerar o snapshot a cada merge:** no v1 isso não é preciso.
  - Depois de um merge sem mudanças, o `generate` diz "No schema changes" e não grava nada. O nó de merge só nasce na próxima migration real.
  - Para fechar o ramo na hora, use `drizzle-kit generate --custom --name merge_upstream` **(teste)**: gera um `migration.sql` vazio com `prevIds` = as folhas.
- **Skeleton em SQL puro fora do Drizzle Kit:** o produto perde o snapshot das tabelas do Skeleton. O `generate` do produto tentaria criá-las, ou exigiria globs separados (a opção anterior, sem o diff automático no Skeleton). Não compensa.

**3. Os outros arquivos de conflito se resolvem regenerando.**
- **`routeTree.gen.ts`**:
  - **(teste)** Conflita sempre que os dois lados acrescentam rotas.
  - O `routes.ts` (do Skeleton) e o `routes.app.ts` (do produto) se mesclam sem conflito.
  - Resolução: `git checkout --ours` + `tsr generate`.
  - Um `merge=ours` no `.gitattributes` só vale se cada clone definir `merge.ours.driver` no `.git/config`. Sem isso, o git volta ao merge de texto **(teste)**. Com o driver, o merge fica "limpo" mas com o arquivo velho **(teste)**.
- **`pnpm-lock.yaml`**:
  - "just run `pnpm install` and commit the changes" ([pnpm: Working with Git](https://pnpm.io/git)).
  - **(teste)** O `pnpm install` resolveu o lockfile com marcadores de conflito, e o `--frozen-lockfile` passou depois.
  - O `package.json` compartilhado conflita quando os dois lados acrescentam dependências vizinhas, e isso se resolve à mão.
- **Registros de features**: o conflito some se cada lado for dono dos seus arquivos. O Skeleton cria `features/app.ts` e `routes.app.ts` como stubs e nunca mais mexe neles.

**4. Os templates parecidos fazem `git merge` do upstream ou dizem para não atualizar.**
- **Merge de verdade:**
  - Jumpstart Pro: remote `jumpstart-pro`, `git merge jumpstart-pro/main`.
  - Bullet Train: merge por tag, uma versão por vez, com uma GitHub Action que abre o PR de upgrade e `Gemfile.lock` regenerado.
- **Sem merge:**
  - Epic Stack: "no way to update it other than making manual changes".
  - Open SaaS: "advise against updating", e quem quiser deve olhar os commits e fazer cherry-pick.
- Nenhum dos quatro documenta migrations no merge.

## Recomendação para a spec do Skeleton

**O que o Skeleton garante para o merge do upstream ser seguro:**
1. **Migrations publicadas são imutáveis.** Nunca editar, renomear, apagar ou achatar uma pasta de `app/drizzle/`.
   - **(teste)** Renomear uma pasta faz o migrator aplicá-la de novo ("relation invitations already exists").
   - Editar o SQL passa em silêncio, porque o hash não é comparado.
   - Consequência: a regeneração da migration inicial, que o Strip fazia, nunca acontece depois do primeiro release.
2. **Mudanças de schema no Skeleton só por expansão entre majors.** Pode criar tabela, coluna nullable ou com default, índice. Não pode renomear, apagar ou trocar o tipo de tabela, coluna ou constraint que um produto possa referenciar (`users.id`, `companies.id`, os enums).
   - A mudança destrutiva vai num major, em duas fases (expand → contract), com nota de upgrade.
   - O `check` não pega esse caso, e ele quebra o banco novo (item 1 da resposta).
   - O nome da FK do produto embute o nome da tabela do Skeleton. Por isso um rename também força uma migration de rename de constraint no produto **(teste)**.
3. **Fronteira de arquivos.** O Skeleton é dono de `platform/`, `features/{auth,account,companies,invitations}/`, `features/skeleton.ts` e `routes.ts`. O produto é dono de `features/<app>/`, `features/app.ts` e `routes.app.ts`. O Skeleton cria os stubs do produto uma vez e nunca mais os edita.
   - O produto estende tabela do Skeleton com tabela própria 1:1 (FK + `ON DELETE CASCADE`), e não com coluna nova. Isso vai no `AGENTS.md` de `app/` junto com o `no-restricted-imports`.
4. **Uma pasta só de migrations e um `drizzle-kit` pinado no catalog**, igual no template e no produto.
   - Uma subida que exija `drizzle-kit up` (snapshot "nonLatest") sai num release marcado.
   - Os nomes das migrations do produto levam prefixo (`--name app_…`), para quem revisa enxergar a origem.
5. **Releases com tag (`vX.Y.Z`) e um `CHANGELOG.md`** com as seções "Migrations" e "Breaking", como o Bullet Train: um merge por versão.
6. **Gates no `factory:verify` do template**, que o produto herda:
   - `drizzle-kit check`;
   - migrate num Postgres vazio + `drizzle-kit push --explain --output json` com saída `{"status":"no_changes"}`. O exit code é 0 nos dois casos **(teste)**, então o script tem de ler o JSON;
   - `pnpm generate && git diff --exit-code`, que já existia no `strip-check`.

**Script `pnpm sync-upstream [tag]`** (`scripts/sync-upstream.ts`, também no repo público, para os produtos herdarem):
1. Recusa rodar com a árvore suja. Confere o remote `upstream`. `git fetch upstream --tags`.
2. `git merge --no-ff --no-commit <tag>` (padrão: a última tag).
3. Resolve os gerados:
   - `routeTree.gen.ts` com conflito → `git checkout --ours`;
   - `pnpm-lock.yaml` com conflito → mantém e deixa o `pnpm install` resolver.
   Se sobrar conflito (por exemplo, no `package.json` ou em arquivos do Skeleton editados pelo produto), para, lista os arquivos e espera `--continue`.
4. `pnpm install`, `pnpm generate` (OpenAPI, Kubb e `routeTree`).
5. `drizzle-kit check`. Se houver conflito, para e manda apagar a migration do produto que ainda não foi aplicada em produção, junto com as seguintes, e gerar de novo, como manda a #5005.
6. Duas checagens de banco no Postgres do `docker-compose`:
   - **(a)** banco vazio → `migrate` com a pasta mesclada;
   - **(b)** banco vazio → `migrate` com a pasta de `ORIG_HEAD` (via `git archive ORIG_HEAD app/drizzle`), que reproduz o estado anterior do produto → `migrate` com a pasta mesclada.

   Nos dois, `push --explain --output json` tem de dar `no_changes`.
7. `pnpm factory:verify`. Depois commit `chore: sync skeleton vX.Y.Z`. O preview do PR repete a checagem (b) com dados reais, porque migra um branch Neon criado do `base`.

## Achados detalhados

### A. Drizzle v1 RC: grafo de snapshots, `generate`, `check` e `migrate`

- **A1. Layout e metadados.**
  - O `drizzle-kit generate` grava `drizzle/<YYYYMMDDHHMMSS>_<nome>/migration.sql` + `snapshot.json`, sem journal. O `migrator.js` recusa a pasta se existir `meta/_journal.json` ("You must upgrade drizzle-kit and run \"drizzle-kit up\"").
  - O snapshot do Postgres é `{ version: "8", dialect: "postgres", id, prevIds, ddl, renames }`. O primeiro aponta para `00000000-0000-0000-0000-000000000000`.
  - A doc diz que o layout novo existe para "eliminate potential Git conflicts with the journal file" e "simplify the process of dropping or fixing conflicted migrations" ([v0 → v1](https://orm.drizzle.team/docs/v0-v1-changes)).
- **A2. Como o `generate` escolhe o snapshot anterior** (`prepareSnapshot` do Postgres, rc.4):
  - `prepareOutFolder` lista os `snapshot.json` e ordena pelos nomes das pastas. `latestSnapshot` é o último.
  - O `generate` chama o `checkHandler` antes. O check devolve um "commutative branch" quando não há conflito e há mais de uma folha. Aí o anterior passa a ser `generateLatestSnapshot(LCA, união dos statements das folhas)`, e `prevIds = leafIds`.
  - Sem ramo aberto, o anterior é o `latestSnapshot`, e `prevIds = [latest.id]`.
  - Com `--ignore-conflicts` e conflitos, o anterior volta a ser o `latestSnapshot` (a pasta de nome maior), mas `prevIds` = todas as folhas.
- **A3. O `check`** (`detectNonCommutative`):
  - Para cada nó com mais de um filho, calcula `diff(pai → folha)` de cada ramo.
  - Cruza "footprints": `<ação>:<alvo>` de um lado contra `<ação conflitante>:<alvo primário>` do outro.
  - No Postgres, `add_column`/`alter_column`/`drop_column`/`rename_column` conflitam na mesma coluna. `drop_table`/`rename_table` conflitam com mudanças na mesma tabela. `create_fk`/`drop_fk`/`recreate_fk` têm como alvo **só a tabela dona da FK**.
  - A doc cita como exemplos "two branches altering the same column, or one renaming a table that another is altering". Criar uma FK que referencia a tabela renomeada não conta como "altering".
  - A [doc do `check`](https://orm.drizzle.team/docs/drizzle-kit-check) admite: com `--ignore-conflicts`, "there is a big chance that `drizzle-kit` didn't check migrations right and it's a bug".
- **A4. Quem roda o check:**
  - `generate` (sempre) e `drizzle-kit migrate` (sempre, issue [#5777](https://github.com/drizzle-team/drizzle-orm/issues/5777), aberta). Saem com código 1 quando há conflito.
  - **(teste)** O `migrate()` do `drizzle-orm/node-postgres/migrator` **não** roda o check.
  - A discussion #5005 diz que "`migrate` … runs `check` by default", e confere com o código.
- **A5. O migrator** (`getMigrationsToRun`):
  - Filtra as migrations locais cujo `name` não está em `drizzle.__drizzle_migrations`.
  - Aplica em ordem de `localeCompare` do nome, numa única `db.transaction`.
  - A doc: "Migrations are now matched by their full folder name instead of timestamps" e "detects and applies every missing migration, regardless of timestamp ordering". No 0.x, migrations mais antigas que a última aplicada eram puladas.
  - O `migrationsTable`/`migrationsSchema` (no `drizzle.config`: `migrations: { table, schema }`) é configurável **(teste)**.
- **A6. Issues abertas que pesam:**
  - [#6216](https://github.com/drizzle-team/drizzle-orm/issues/6216) (aberta em 2026-08-31, rc.4 e rc.5): falso conflito quando duas folhas têm o mesmo conjunto de pais (fan-in). O `--ignore-conflicts` "isn't a safe workaround, since it can diff from the wrong state". Há o PR #6328 de um contribuidor, sem merge.
  - [#5777](https://github.com/drizzle-team/drizzle-orm/issues/5777) (aberta): o check no `migrate` levou cerca de 115 s num repo com 70 migrations e rebases. O mantenedor tem uma correção local e ainda não publicou.
  - [#5764](https://github.com/drizzle-team/drizzle-orm/issues/5764) (aberta, rc.1): o `generate` não fazia o nó de merge e duplicava o `ADD COLUMN`. O autor confirmou a correção no rc.4. No meu teste, o rc.4 fez o nó de merge.

### B. Experimento local (teste)

Fiz tudo em `/tmp/r28`, fora do repo. O upstream é um repo git com o Skeleton (`users`, `companies` com FK para `users`). O produto é um `git clone` com `upstream` como remote e a feature `features/app/tasks` (FK `companies.id` com `CASCADE` e `users.id` com `SET NULL`). Uma pasta só, `drizzle/`, com o glob `./src/features/**/schema.ts`. Os bancos foram `prod_state` (o produto migrado antes de cada merge), `fresh1/2/3` (vazios) e `split1/2`.

| Cenário | git merge | `check` | `generate` | `migrate` em `prod_state` | `migrate` em banco vazio |
|---|---|---|---|---|---|
| R1: upstream `invitations` + `companies.logo_url` com timestamp **anterior** ao `app_tasks` do produto | limpo | ok | "No schema changes" | aplica `invitations` depois de `app_tasks` | aplica em ordem de nome; schema igual |
| R1b: produto acrescenta `tasks.status` depois do merge | — | ok | só `ADD COLUMN "status"`; `prevIds` = [app_tasks, invitations] | ok | ok |
| R2: upstream `users.name` + `audit_log` com timestamp **posterior** | limpo | ok | sem diff | ok | ok |
| R3: os dois lados acrescentam `companies.plan` | conflito em `companies/schema.ts` | **conflito** (exit 1) | recusa | — | `drizzle-kit migrate` recusa; `migrate()` do ORM: "column plan already exists", rollback |
| R3 resolvido: apagar a migration do produto (`app_company_plan`) | — | ok | sem diff | ok | ok |
| R3 com `--ignore-conflicts` e uma mudança nova do produto | — | — | **`CREATE TABLE "tasks"` de novo** (anterior = snapshot do upstream) | (falharia) | (falharia) |
| R4: upstream renomeia `companies` → `organizations` (anterior); produto cria `projects` com FK para `companies` | limpo | **ok (não detecta)** | pede hints para renomear 2 FKs | ok | **"relation companies does not exist"** |
| R4 resolvido: editar o `migration.sql` de `app_projects` para `organizations` + migration de rename das FKs | — | ok | — | ok (a edição passa em silêncio) | ok; `push --explain`: `no_changes` nos dois |
| Renomear a pasta `…_invitations` já aplicada | — | — | — | **"relation invitations already exists"** | — |

- **B1.** Nenhum cenário gerou `DROP` de tabela do produto. O schema TS sempre tem todas as tabelas. O que aparece é `CREATE`/`ADD` duplicado quando o snapshot anterior está errado.
- **B2.** `drizzle-kit push --explain --output json` contra um banco migrado devolve `{"status":"no_changes","dialect":"postgresql"}` quando bate com o schema TS. Quando falta algo, devolve a lista de `statements`. O exit code é 0 nos dois casos. Serve de checagem de deriva depois do `migrate`.
- **B3.** `drizzle-kit generate --custom --name merge_upstream` depois de um merge grava um `migration.sql` com só o comentário. O snapshot tem `prevIds` = as duas folhas e a união das tabelas. O `check` continua ok.

### C. Saídas da pergunta 2

- **C1. Schema Postgres próprio para o Skeleton (teste).** Usei `pgSchema('skeleton')` e duas configs:
  - `drizzle.skeleton.config.ts`: glob dos schemas do Skeleton, `out: drizzle/skeleton`, `migrations.table: __skeleton_migrations`;
  - `drizzle.app.config.ts`: glob `features/app/**`, `out: drizzle/app`, `__app_migrations`.

  Resultados:
  - A config do produto gerou só `tasks` com `REFERENCES "skeleton"."companies"`. O import do Skeleton no `schema.ts` do produto não puxa as tabelas dele para o snapshot.
  - Rodar o produto antes do Skeleton falha. Na ordem Skeleton → produto, funciona, e o Skeleton acrescentou coluna e tabela sem efeito no produto.
  - **O rename quebrou o banco novo do mesmo jeito.** E `schemaFilter: ['public']` com o glob inteiro **não** filtra o `generate` (gerou `CREATE SCHEMA "skeleton"` e as tabelas do Skeleton).
  - Prós: ordem determinística (Skeleton sempre antes) e nenhum ramo no DAG.
  - Contras: duas configs, dois comandos, a regra "nunca rode a config do Skeleton no produto", e a decisão de [Layout do monorepo](../issues/21-monorepo-layout-and-strip.md) a rever. E não resolve o caso difícil.
- **C2. Regenerar o snapshot a cada merge.** É a resposta do 0.x (journal linear). No v1, o DAG e o nó de merge cumprem esse papel (A2, B3). Regenerar a pasta inteira quebraria a imutabilidade (renomear pasta = aplicar de novo).
- **C3. SQL puro do Skeleton fora do Drizzle Kit.** Sem snapshot, o `generate` do produto vê as tabelas do Skeleton no schema TS e tenta criá-las. Ou o Skeleton sai do glob (o mesmo que C1), e aí o Skeleton perde o diff automático. Não testei além disso, porque C1 já mostra o limite.

### D. Arquivos gerados e de registro

- **D1. `routeTree.gen.ts` (teste).** Com `virtualRouteConfig` (`routes.ts` faz spread de `appRoutes` de `routes.app.ts`):
  - O upstream montou `/account` em `routes.ts` e o produto montou `/tasks` em `routes.app.ts`. **Só o `routeTree.gen.ts` conflitou.**
  - `git checkout --ours` + `tsr generate` deu o arquivo certo (rotas dos dois lados).
  - Com `src/routeTree.gen.ts merge=ours` no `.gitattributes` e o driver não definido, o git fez merge de texto e deu conflito. Com `git config merge.ours.driver true`, o merge passou, mas o arquivo ficou sem a rota nova, e o `tsr generate` seguinte mudou 21 linhas.
  - O [gitattributes](https://git-scm.com/docs/gitattributes) (2.56.0) diz que a definição do driver "is done in the `.git/config` file, not in the `gitattributes` file". Ou seja, não é versionada.
- **D2. Commitar ou não.** O [FAQ do TanStack Router](https://tanstack.com/router/latest/docs/framework/react/faq) manda commitar ("part of your application's runtime, not a build artifact"). A doc do Start dizia "You may gitignore this file". A contradição foi registrada nas issues [#5340](https://github.com/TanStack/router/issues/5340) e #5354, fechada em 2025-12-05 sem mudança de doc ligada. Como a task `generate` do Turborepo já roda antes do `typecheck`, tirar o arquivo do git também seria viável, mas contraria o FAQ e a decisão de [Layout do monorepo](../issues/21-monorepo-layout-and-strip.md). Fico com commitar + regenerar no sync + `git diff --exit-code` no CI.
- **D3. `pnpm-lock.yaml`.** A doc ([Working with Git](https://pnpm.io/git)) diz: "pnpm can automatically resolve merge conflicts in `pnpm-lock.yaml`. If you have conflicts, just run `pnpm install` and commit the changes", e pede revisão porque "we cannot guarantee that pnpm will choose the correct head".
  - **(teste)** Quando os dois lados acrescentaram dependências não vizinhas, o git mesclou o `package.json` e o lockfile sem conflito, e o `--frozen-lockfile` passou.
  - Com dependências vizinhas (`immer` × `ky`), os dois conflitaram. Corrigi o `package.json` à mão, e o `pnpm install` regenerou o lockfile com marcadores. O `--frozen-lockfile` passou.
  - O Bullet Train faz o mesmo com o `Gemfile.lock` (`git checkout HEAD -- Gemfile.lock` + `bundle install`).
- **D4. Registros.** No teste D1, `routes.ts` e `routes.app.ts` se mesclaram sem conflito porque cada lado só editou o seu. O mesmo vale para `features/skeleton.ts` × `features/app.ts`. Conflito só aparece se o upstream mexer no stub do produto.

### E. Prática de outros templates

- **E1. Jumpstart Pro** ([Upgrading](https://jumpstartrails.com/docs/upgrading)): `git clone`, `git remote rename origin jumpstart-pro`, novo `origin`, e depois "merge updates at any time" com `git fetch jumpstart-pro` + `git merge jumpstart-pro/main`. Nada sobre conflitos ou migrations.
- **E2. Bullet Train** ([Upgrades](https://bullettrain.co/docs/upgrades)):
  - remote `bullet-train`, merge por tag (`git merge v1.4.1`), "one version at a time";
  - uma GitHub Action "Create Bullet Train Upgrade PR";
  - o `Gemfile.lock` é regenerado;
  - a maior parte do código vem em gems, e o starter só traz "hooks and initializers".
- **E3. Epic Stack** ([managing-updates.md](https://github.com/epicweb-dev/epic-stack/blob/main/docs/managing-updates.md)): "This code is completely yours and there is no way to update it other than making manual changes". Guarda a data e o hash no campo `epic-stack` do `package.json`.
- **E4. Open SaaS / Wasp** ([How (Not) to Update](https://docs.opensaas.sh/guides/updating-opensaas/)): "advise against updating". Se mesmo assim for atualizar, revisar os commits e encaixar à mão. Quem tem migration documentada é só o próprio Wasp.
- **E5.** O que dá para concluir: quem suporta merge (Jumpstart Pro, Bullet Train) clona com histórico e faz merge, por tag no caso do Bullet Train. É o mesmo desenho do [ticket 27](../issues/27-skeleton-first-private-app.md), que manda `git push` para outro remote e não "Use this template", cujo histórico novo exige `--allow-unrelated-histories`.

## Riscos em aberto

- **R1. O `check` não cobre FK para tabela renomeada ou apagada (A3).** A regra 2 (só expansão) e a checagem de banco vazio do sync são a defesa. Vale abrir issue no `drizzle-orm` pedindo o alvo referenciado no footprint de `create_fk`.
- **R2. #6216 (fan-in).** Os nós de merge do produto são fan-in. Um falso conflito bloquearia o `generate` e o `migrate`, e o `--ignore-conflicts` gera DDL errado (B, R3). No meu teste não apareceu. Mitigação: o drizzle-kit pinado e testado no CI do template.
- **R3. #5777 (o check no `migrate` fica lento com histórico ramificado).** O produto vai acumular um nó de merge por sync. Se pesar no deploy, rodar o `migrate()` do ORM (sem check) e manter o `check` só no CI.
- **R4. O RC ainda muda o formato.** Um snapshot "nonLatest" exige `drizzle-kit up`. Se o Skeleton subir o kit e rodar o `up`, os snapshots do produto também precisam do `up` depois do merge. Só fica seguro como passo explícito do sync e nota no changelog.
- **R5. Editar migration aplicada passa em silêncio (A5).** É útil para corrigir o banco novo (R4 resolvido), mas também esconde erro. O `push --explain` nos dois bancos é o que garante a convergência.
- **R6. `package.json` e `wrangler.jsonc` são compartilhados.** O nome do Worker, os bindings e as dependências do produto conflitam com as mudanças do upstream. A spec do Skeleton deve pôr o que é do produto em variáveis ou num arquivo à parte quando der. O resto é resolução manual no sync.
