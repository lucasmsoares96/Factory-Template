# Puxar o Skeleton upstream num produto privado

Type: research
Status: resolved

## Question

O produto privado é uma cópia do repo público, com o público como `upstream`, e recebe as melhorias do Skeleton por `git merge upstream/main` ([Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md)). O layout está em [Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md): uma pasta só de migrations (`app/drizzle/`), `routeTree.gen.ts` commitado, a app em `features/<app>/`. Na documentação e no código mais recentes (outubro de 2026):

1. **Migrations do Drizzle v1 RC** (`1.0.0-rc.4`, uma pasta por migration com `snapshot.json`): o que acontece quando um merge traz migrations do upstream com timestamp intercalado às do produto, e com snapshots que não conhecem as tabelas do produto? Como o `drizzle-kit generate` escolhe o snapshot anterior, e se o próximo `generate` geraria `DROP` das tabelas do produto. O `drizzle-kit check` detecta isso? Há fluxo documentado para migrations vindas de dois lados (por exemplo, Drizzle "commutative migrations", `drizzle-kit up`, rebase de migrations)?
2. **Saídas** se o merge ingênuo quebrar: o Skeleton num schema Postgres próprio com `migrationsTable` separada; o produto regenerar o snapshot depois de cada merge; o Skeleton entregar migrations em SQL puro fora do Drizzle Kit. Prós e contras, com as chaves estrangeiras do produto apontando para as tabelas do Skeleton.
3. **Outros arquivos de conflito**: `routeTree.gen.ts`, `pnpm-lock.yaml` e os registros de features. Qual é o jeito recomendado de resolver cada um (regenerar depois do merge, `.gitattributes` com `merge=ours`/driver próprio).
4. **Prática de outros templates** que suportam atualizar a partir do upstream (por exemplo, Epic Stack, Bullet Train, Jumpstart Pro, Wasp, Saas starter kits): merge do upstream, cherry-pick ou só changelog.

Conclua com uma recomendação para a spec do Skeleton (o que o Skeleton precisa garantir para que o merge do upstream seja seguro) e, se for o caso, um script `pnpm sync-upstream`.

## Answer

- **O merge ingênuo funciona no caso comum.** Testado com `drizzle-kit`/`drizzle-orm` 1.0.0-rc.4 e Postgres 17.
  - Cada snapshot tem `prevIds`, e o histórico vira um DAG.
  - O migrator aplica pelo **nome da pasta**, não pelo timestamp. Uma migration intercalada do upstream entra no banco do produto, e o banco novo aplica em ordem de nome.
  - Nenhum `DROP`. O `generate` depois do merge usa o ancestral comum mais a união das folhas, e a migration nova sai como nó de merge (`prevIds` = as duas folhas).
  - O risco é o inverso: com `--ignore-conflicts`, ele diffa do snapshot errado e recria `CREATE TABLE` do produto.
- **O que o `check` pega e o que não pega:**
  - Pega os dois lados mexendo na mesma coluna ou tabela. Nesse caso o `generate` e o `drizzle-kit migrate` recusam, e o `migrate()` do ORM, que não roda o check, falha e faz rollback. Correção oficial ([#5005](https://github.com/drizzle-team/drizzle-orm/discussions/5005)): apagar a migration do produto e gerar de novo.
  - **Não pega** um rename ou drop no Skeleton de tabela que a FK do produto referencia: o footprint de `create_fk` só cobre a tabela dona. Testado: o `check` passou, o banco do produto migrou e **o banco novo quebrou** ("relation companies does not exist").
  - Renomear uma pasta já aplicada faz o migrator aplicá-la de novo. Editar o SQL passa em silêncio.
- **Saídas da pergunta 2: nenhuma vale a troca.**
  - Schema Postgres próprio com `migrationsTable` separada funciona com dois configs de globs disjuntos (a FK cruzada sai certa), mas o rename continua quebrando o banco novo.
  - Regenerar snapshot é coisa do 0.x. No v1, o nó de merge resolve, e `generate --custom` fecha o ramo quando preciso.
  - SQL puro tira o Skeleton do diff.
  - **Fica a pasta única.**
- **Gerados:**
  - O `routeTree.gen.ts` conflita quando os dois lados acrescentam rotas, enquanto `routes.ts` e `routes.app.ts` se mesclam limpos. Resolve com `--ours` + `tsr generate`. O `merge=ours` exige driver no `.git/config` de cada clone e deixa o arquivo velho.
  - O `pnpm-lock.yaml` se resolve com `pnpm install`, como manda a doc. O `package.json` com dependências vizinhas é à mão.
  - Os registros não conflitam se cada lado for dono dos seus arquivos.
- **Outros templates:** Jumpstart Pro e Bullet Train fazem `git merge` do upstream (o Bullet Train por tag, uma versão por vez, com Action que abre PR). Epic Stack e Open SaaS dizem para não atualizar e fazer à mão. Nenhum fala de migrations.
- **Spec do Skeleton:**
  1. migrations publicadas imutáveis, sem squash, sem regenerar e sem renomear pasta;
  2. schema só por expansão entre majors. Rename, drop ou troca de tipo do que um produto referencia (`users.id`, `companies.id`, enums) só num major, em expand → contract;
  3. fronteira de arquivos: o Skeleton cria `features/app.ts` e `routes.app.ts` como stubs e nunca mais os edita. O produto não edita arquivos do Skeleton e estende tabela dele com tabela 1:1 própria;
  4. `drizzle-kit` pinado no catalog;
  5. releases com tag e `CHANGELOG` com as seções Migrations e Breaking;
  6. `drizzle-kit check` e migrate num banco vazio + `push --explain --output json` = `no_changes` no `factory:verify`.
- **`pnpm sync-upstream [tag]`**:
  1. árvore limpa;
  2. `fetch --tags` + `merge --no-commit`;
  3. `routeTree` `--ours`;
  4. `pnpm install` + `pnpm generate`;
  5. para se sobrar conflito;
  6. `drizzle-kit check`;
  7. migrate num banco vazio e num banco no estado de `ORIG_HEAD`, ambos com `push --explain` = `no_changes`;
  8. `factory:verify`;
  9. commit.

  O preview Neon criado do `base` repete o teste com o banco no estado anterior.

[pesquisa](../research/28-upstream-skeleton-sync.md)

## Revisão

O `sync-upstream` não precisa funcionar: o comando `pnpm sync-upstream`, a regra "o schema só acrescenta entre majors", as releases com `CHANGELOG` e os stubs congelados saem da spec. Ficam só "migrations publicadas imutáveis" (o banco de produção do próprio produto depende disso) e a pasta única de migrations. Decidido em [Bootstrap do template público](26-template-bootstrap.md).
