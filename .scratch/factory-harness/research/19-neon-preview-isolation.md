# Pesquisa 19b — Isolamento do branch Neon do preview

Ticket: [19-pr-ci-security](../issues/19-pr-ci-security.md) (Q2: projeto Neon separado para previews?) · Pesquisado em 2026-10-18
Complementa e corrige a seção 4 de [19-pr-ci-security](19-pr-ci-security.md). Não repete o desenho do CI que está lá.

Versões consultadas:
- **Docs Neon**: páginas `.md` (`https://neon.com/docs/<página>.md`), lidas em 2026-10-18. Elas não têm data por página; quando a página traz uma data, ela vai junto do fato.
- **API Neon**: spec OpenAPI `https://neon.com/api_spec/release/v2.json`, `Last-Modified: Fri, 16 Oct 2026 18:23:02 GMT`. É a fonte da [API Reference](https://neon.com/docs/reference/api).
- **Changelog Neon**: arquivos de `neondatabase/website/content/changelog/` com a data de cada entrada.
- **`neondatabase/create-branch-action`**: `main` no commit `db56a9f` (2026-10-14). O último *release* é **6.3.1** (2026-03-31). Existe também uma tag `v6.4.0` (2026-01-07) sem release, e `src/version.ts` diz `6.1.1`: a numeração do projeto é inconsistente.
- **`neondatabase/neonctl`**: v2.27.0 (2026-06-22).
- **Exemplos oficiais**: `neondatabase/preview-branches-with-cloudflare` no commit `61a1cf6` (2026-05-23) e `neondatabase/preview-branches-with-vercel` (push de 2026-05-21).
- **PostgreSQL**: docs 18.6.

Convenção: **Fonte diz** é afirmação da fonte primária (doc, spec ou código). **Inferência** é leitura minha. **Não documentado** quer dizer que procurei e não achei.

---

## Resposta

### O que a pesquisa anterior acertou e errou

| Afirmação anterior | Veredito |
| --- | --- |
| (a) No Free, o branch filho herda as mesmas roles e senhas da produção | **Correta.** Vale em qualquer plano, exceto quando o pai é *protected* (recurso pago). A senha herdada **funciona no endpoint da produção**. Ver §1. |
| (b) Uma key project-scoped apaga qualquer branch, inclusive a produção, e protected branches são pagos | **Meio errada.** A API **não deixa apagar o branch root nem o default**, nem um branch com filhos. Mas a key lê a senha da produção, roda SQL nela e pode fazer `restore` por cima dela, então o estrago possível é o mesmo. Protected é pago, sim. Ver §3. |
| (c) Schema-only existe no Free, com no máximo 2 simultâneos | **Correta.** São 3 root branches por projeto no Free, contando a produção. Continua **Beta**. Ver §2. |
| (d) `dblink` e `postgres_fdw` estão disponíveis | **Correta**, e a Neon documenta que as computes fazem **conexões de saída** pela internet (há IPs de NAT publicados). **Correção:** o `pg_cron` **não** pode ser ligado só com SQL; precisa de uma chamada à API. Ver §4. |

### Conclusão em uma frase

O risco grave do desenho atual vem de **dados reais + senha da produção no preview**. Ele some **sem projeto separado**: basta derivar os previews de um branch `preview-base` saneado, com a senha da role resetada (opção B). O projeto separado (opção C) acrescenta duas coisas que o B não dá:
1. **cotas do Free isoladas.** CU-hours, egress e storage são **por projeto**. Um preview descontrolado ou malicioso no mesmo projeto pode **suspender a produção** até o próximo ciclo;
2. **raio menor da API key.** A key do deploy de preview deixa de alcançar a produção.

No Free, o custo do C é um projeto a mais (o limite é 100) e uma key a mais. Ver a comparação em §7.

---

## 1. Senhas: o branch filho compartilha as senhas do pai?

- **Fonte diz:** "When creating a new branch, the branch will have the same Postgres roles and passwords as the parent branch. If you want your branch created with new role passwords, you can enable branch protection." ([Manage branches](https://neon.com/docs/manage/branches))
- **Fonte diz:** "By default, Postgres roles on the child branch will have the same passwords as on the parent branch. However, this does not apply to protected branches." A justificativa é: "This behavior is designed to prevent the exposure of passwords that could be used to access your protected branch". O recurso de senhas novas é de 2024-07-31. Protected branches existem só nos planos pagos: Launch 2, Scale 5 ([Protected branches](https://neon.com/docs/guides/protected-branches)).
  - **Inferência:** a própria Neon reconhece que a senha herdada **dá acesso ao branch pai**. No Free não há como herdar com senha nova.
- **A senha vazada funciona contra o endpoint da produção?** Sim, desde que o atacante saiba o ID do endpoint dela.
  - **Fonte diz:** "Neon uses compute IDs (the first part of a Neon domain name) to route incoming connections". O ID vai no SNI ou em `options=endpoint%3D<id>` ([Connection errors](https://neon.com/docs/connect/connection-errors#the-endpoint-id-is-not-specified)).
  - **Inferência:** o hostname só escolhe a compute. Quem autentica é a role do branch daquela compute, e no Free ela tem a mesma senha. A única barreira é o atacante não conhecer o `ep-…` da produção. Esse ID **não é tratado como segredo** pela Neon: aparece em hostnames, logs e na `DATABASE_URL` de produção. Contar com ele é segurança por obscuridade.
  - **Não documentado:** se, de dentro de um branch filho, dá para descobrir o endpoint ID do pai, por exemplo por algum GUC `neon.*`. Não testado.
- **Dá para resetar a senha só no branch filho?** Sim.
  - **Fonte diz:** `POST /projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password`. "Resets are branch-scoped, so reset the role on each branch where it is used." Não há comando no CLI: "There's no CLI command for this operation" ([Manage roles](https://neon.com/docs/manage/roles#reset-a-password)). Confirmei no código do `neonctl` v2.27.0, que não tem reset de senha.
  - **Fonte diz (spec):** o reset "Returns a new password … The old password remains valid until last operation finishes. Connections to the compute endpoint are dropped."
  - **Fonte diz:** a doc de rotação manda resetar "on every branch where it can log in", porque as roles são branch-scoped ([Security overview › Rotate credentials](https://neon.com/docs/security/security-overview#rotate-credentials)).
- **É recomendado?** A Neon não recomenda isso explicitamente como prática para previews no Free. A recomendação oficial é usar branch *protected*: "When production is protected … Neon automatically generates new database credentials for that branch" ([Manage production and staging as branches](https://neon.com/branching/production-staging-workflows)).
  - **Inferência:** o reset por API faz à mão o que o protected faz sozinho.
- **Como encaixar no CI.** O `create-branch-action` não reseta senha. Ele lê a senha do branch com `getProjectBranchRolePassword` (`reveal_password`) e monta a URL com ela ([`src/branch.ts`](https://github.com/neondatabase/create-branch-action/blob/main/src/branch.ts), `main@db56a9f`). Há duas formas de fazer o reset (inferência):
  1. **Resetar uma vez no `preview-base`.** Os previews nascem dele e herdam a senha dele, que já difere da produção. Dispensa um passo por PR.
  2. **Resetar em cada `preview/pr-N`** logo depois de criar, com `curl` para `reset_password`, e montar a URL com a senha devolvida.

## 2. Dados: o que a Neon recomenda para previews

- **Fonte diz (recomendação oficial com PII):** "When production data does contain PII or regulated information, **branching directly from production isn't appropriate**". O fluxo indicado é: "Create an anonymized branch from production … Use this anonymized branch as a safe, production-like baseline … Derive staging (and later development and **preview**) branches from it" ([Manage production and staging as branches](https://neon.com/branching/production-staging-workflows)).
  - O guia [Branch-per-PR is not the same as a staging database](https://neon.com/guides/branch-per-pr-vs-staging-database#anonymize-sensitive-data-when-you-branch) diz o mesmo, citando GDPR.
- **Fonte diz (sem PII):** "Because the branch starts from production or staging, previews reflect real data shapes" ([Create one branch per preview](https://neon.com/branching/ci-preview-workflows)).

### 2.1 Branches anonimizados

- **Fonte diz:**
  - status **Beta**, com masking **estático** via PostgreSQL Anonymizer. Fluxo: "Neon creates a new branch with the schema and data from the parent branch", depois aplica as regras;
  - limitações: "cannot reset to parent, restore, or delete the read-write endpoint"; "Branch is unavailable during anonymization"; "Masking does not fully enforce database constraints".

  Fonte: [Data anonymization](https://neon.com/docs/workflows/data-anonymization). A API `POST /projects/{id}/branch_anonymized` também é "currently in Beta" (spec).
- **Fonte diz:** o `create-branch-action` aceita `masking_rules` e chama `createProjectBranchAnonymized` ([`action.yml`](https://github.com/neondatabase/create-branch-action/blob/main/action.yml), [`src/branch.ts`](https://github.com/neondatabase/create-branch-action/blob/main/src/branch.ts)). Isso entrou no changelog de [2025-12-19](https://github.com/neondatabase/website/blob/main/content/changelog/2025-12-19.md).
- **Disponível no Free?** **Não documentado.** A tabela de [Plans](https://neon.com/docs/introduction/plans) não cita anonimização, nem como recurso pago. Os changelogs de lançamento ([2025-11-14](https://github.com/neondatabase/website/blob/main/content/changelog/2025-11-14.md), [2025-11-21](https://github.com/neondatabase/website/blob/main/content/changelog/2025-11-21.md)) também não restringem por plano.
- **Inferência (risco do anonimizado para o nosso caso):**
  - o mascaramento é uma *deny-list*: só some o que tiver regra. Coluna nova com PII, token de sessão ou hash sem regra vaza;
  - o próprio changelog teve de corrigir "stale un-anonymized data" em materialized views ([2025-12-19](https://github.com/neondatabase/website/blob/main/content/changelog/2025-12-19.md));
  - num app escrito por agente, com schema mudando a cada PR, isso é frágil. Dado sintético (seed) é *allow-list* e mais seguro.

### 2.2 Branches schema-only

- **Fonte diz:**
  - **Beta**; a API "is in beta and subject to change";
  - "Replicates only the database schema (tables, views, roles, etc.)" ([Manage branches](https://neon.com/docs/manage/branches));
  - cria um **root branch** sem pai e sem reset;
  - o root branch conta na cota: "Root branch allowance per project": **Free 3**, Launch 5, Scale 25. A cota inclui o `main` e "certain backup branches created by restore operations";
  - no Free, todos os branches dividem 1 GB.

  Fonte: [Schema-only branches](https://neon.com/docs/guides/branching-schema-only). O recurso entrou em Early Access em [2025-01-31](https://github.com/neondatabase/website/blob/main/content/changelog/2025-01-31.md) e ganhou suporte no CLI em [2025-02-07](https://github.com/neondatabase/website/blob/main/content/changelog/2025-02-07.md). A página ainda diz que o CLI virá "in a future release", e o código do `neonctl` v2.27.0 já tem `--schema-only`.
- **Fonte diz:** o `create-branch-action` tem `branch_type: 'default' | 'schema-only'` e envia `init_source: 'schema-only'` ([`action.yml`](https://github.com/neondatabase/create-branch-action/blob/main/action.yml)).
- **Inferência:** um schema-only **por PR** limita o projeto a 2 previews simultâneos. Um único schema-only `preview-base`, com os previews como filhos normais dele, gasta só 1 root branch.
- **Fonte diz (spec, não documentado em guia):** `init_source` aceita também `parent-schema`, que "copies schema only from the parent branch", ao lado de `schema-only`, que "creates a new root branch". Isso sugere um schema-only **não-root**.
  - **Incerto:** nenhum guia ou changelog documenta `parent-schema`. O `create-branch-action` não o usa.
- **Não documentado:**
  - se o schema-only copia as **senhas** das roles. Resetar no base resolve de qualquer forma;
  - se copia as linhas de `drizzle.__drizzle_migrations`. Pela definição, a tabela viria **vazia**.

## 3. API keys: o que cada tipo alcança

- **Fonte diz:** três tipos ([Manage API keys](https://neon.com/docs/manage/api-keys)):

  | Tipo | Quem cria | Escopo |
  | --- | --- | --- |
  | Personal | qualquer usuário | "All organization projects where the user is a member" |
  | Organization | Admin da org | "All projects within the organization", "admin-level access" |
  | Project-scoped | Admin da org | "Single specified project", com acesso **Editor** |

  - A project-scoped "cannot delete the project or manage who can access it". O CLI avisa: "It can still change and delete everything inside that project."
  - O Editor pode "Get connection strings and run SQL" e "Create, edit, or delete branches, endpoints, databases, and Postgres roles" ([User permissions](https://neon.com/docs/manage/user-permissions)).
- **Dá para restringir a key a "só branches"?** **Não.**
  - **Fonte diz (spec):** a criação de key aceita só `key_name` e, para keys de org, `project_id` ("If set, the API key can access only this project"). Não existe campo de permissão ou escopo.
  - **Fonte diz:** os "scoped credentials" com escopos valem só para Object Storage e AI Gateway, não para a API de gerenciamento ([Credentials & access](https://neon.com/docs/concepts/credentials-access)).
- **Free tem organização?** Sim: "all projects live within organizations. When you sign up, you automatically get a free organization" ([Organizations](https://neon.com/docs/manage/organizations)). Portanto a key project-scoped existe no Free.
- **Dá para apagar o branch de produção pela API?**
  - **Fonte diz (spec, `DELETE /projects/{id}/branches/{branch_id}`):** "**You cannot delete a project's root or default branch, or a branch that has a child branch.** A project must have at least one branch." A doc repete a parte dos filhos ([Manage branches › Delete](https://neon.com/docs/manage/branches#delete-a-branch)).
  - **Fonte diz:** default branches também não podem expirar ([Branch expiration](https://neon.com/docs/guides/branch-expiration)).
  - **Mas a key ainda pode (spec, endpoints em `/projects/{project_id}/…`):**
    - `GET …/roles/{role}/reveal_password` e `GET /connection_uri`. Com eles, conecta na produção e faz `DROP`/`DELETE`/leitura total;
    - `POST …/branches/{id}/restore` com `source_branch_id` de outro branch, que sobrescreve o branch. `preserve_under_name` "If omitted and not required, the previous state is not preserved";
    - `reset_password` da role de produção, derrubando o app;
    - apagar databases e roles;
    - `PATCH` e `DELETE` de endpoints.

    "Computes associated with a protected branch cannot be deleted" implica que as de branch não protegido podem.
  - **Fonte diz:** o histórico para recuperar no Free é de "**6 hours**, up to 1 GB-month", com "1 manual snapshot" ([Plans](https://neon.com/docs/introduction/plans)).
- **Protected branches:**
  - **Fonte diz:** só nos planos pagos ([Protected branches](https://neon.com/docs/guides/protected-branches)). A doc também diz: "All users are currently able to manage protected branches, regardless of their role or permission level" ([Organizations](https://neon.com/docs/manage/organizations)).
  - **Inferência:** mesmo no plano pago, uma key Editor provavelmente consegue desproteger o branch. Não documentado para keys.
- **Integração GitHub oficial:**
  - **Fonte diz:** ela "Generates a Neon API key for your Neon account", ou seja, uma key pessoal, e "allows you to run any Neon API method … create, update, and delete various objects in Neon such as projects, branches" ([Neon GitHub integration](https://neon.com/docs/guides/neon-github-integration#secret-and-variable-set-by-the-github-integration)).
  - **Inferência:** pior que a project-scoped. Não usar.

## 4. O que SQL malicioso ou o app do PR alcança além do próprio branch

- **Privilégios:**
  - **Fonte diz:** as roles criadas por Console, API ou CLI, inclusive `neondb_owner`, herdam `neon_superuser`. Isso inclui:
    - `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `REPLICATION`;
    - `pg_read_all_data`, `pg_write_all_data`, `pg_create_subscription`, `pg_signal_backend`;
    - `CREATE EVENT TRIGGER`.

    "you can't connect using the Postgres `superuser` account" ([Manage roles](https://neon.com/docs/manage/roles#the-neon_superuser-role)). As roles são por branch: "roles belong to a branch" (mesma página).
- **`COPY … TO PROGRAM`:**
  - **Fonte diz:** exige superuser ou `pg_read_server_files`/`pg_write_server_files`/`pg_execute_server_program` ([PostgreSQL 18 COPY](https://www.postgresql.org/docs/current/sql-copy.html)).
  - **Inferência:** a lista de privilégios do `neon_superuser` não inclui nenhuma dessas roles, então fica bloqueado.
  - **Fonte diz:** `file_fdw` "is not supported". `pageinspect`, `plpython3u`, `pg_net` e `http` não constam da lista ([Postgres extensions](https://neon.com/docs/extensions/pg-extensions)).
- **Rede de saída:**
  - **Fonte diz:** `dblink` 1.2 e `postgres_fdw` 1.1/1.2 estão disponíveis ([Postgres extensions](https://neon.com/docs/extensions/pg-extensions)). O `postgres_fdw` "query tables in external Postgres servers", e para outra Neon "unpooled connection strings are required" ([postgres_fdw](https://neon.com/docs/extensions/postgres_fdw)).
  - **Fonte diz:** "Neon uses multiple IP addresses per region for this outbound communication", com lista de IPs de NAT atualizada em 2026-10-07 ([Regions › NAT Gateway IP addresses](https://neon.com/docs/introduction/regions#nat-gateway-ip-addresses)).
  - **Inferência:** a compute abre TCP de saída para Postgres na internet. Uma migration pode fazer `dblink_exec` para um Postgres do atacante e mandar as linhas do branch. Restrição de portas ou destinos: **não documentada**.
- **Alcançar outros branches:**
  - **Inferência:** só pela rede, conhecendo **host e senha**. Nada no branch fornece o host de outro endpoint (não documentado, ver §1). A senha é a do branch, igual à da produção se não houver reset.
- **Replicação lógica:**
  - **Fonte diz:** publicar a partir da Neon exige ligar a replicação lógica no projeto pela Console ou pela API. A mudança é irreversível ([Logical replication in Neon](https://neon.com/docs/guides/logical-replication-neon#enable-logical-replication)).
  - **Inferência:** SQL sozinho não liga. `CREATE SUBSCRIPTION` puxa dados **para** o branch, o que não serve para exfiltrar.
- **`pg_cron` (correção da pesquisa anterior):**
  - **Fonte diz:** para instalar é preciso "setting the `cron.database_name` parameter … This requires making an Update compute endpoint API call", e "runs only while the compute is active" ([pg_cron](https://neon.com/docs/extensions/pg_cron)).
  - **Inferência:** a migration não consegue ativá-lo.
- **Cotas compartilhadas:**
  - **Fonte diz:**
    - "100 CU-hours/project"; "**All computes in your project count toward usage**";
    - "5 GB per project per month" de egress;
    - "1 GB of Postgres storage per project";
    - "when you run out of CU-hours or public network transfer, your compute is suspended until the next billing period"; acima de 1 GB, "inserts, updates, and deletes … fail".

    Fonte: [Plans](https://neon.com/docs/introduction/plans). No Free, "all branches in a project share a total storage limit of 1 GB" ([Schema-only branches](https://neon.com/docs/guides/branching-schema-only)).
  - **Inferência:** no mesmo projeto, um preview pode esgotar CU-hours, egress ou storage e **parar ou travar escritas da produção**. Basta CPU alta (autoscaling até 2 CU), exfiltração volumosa ou inserts em massa. Por exemplo, 2 CU durante 50 h somam 100 CU-h. Não testei se um `pg_sleep` longo vindo da migration mantém a compute acordada depois que o job cai.
  - **Mitigação parcial (Fonte diz, spec):** `BranchCreateRequestEndpointOptions` aceita `autoscaling_limit_max_cu`. O `create-branch-action` **não** expõe isso: só manda `suspend_timeout_seconds` (`src/branch.ts`).

## 5. Guias, exemplos oficiais e repositórios reais

- **Exemplos oficiais da Neon** (todos usam o **mesmo projeto** e criam o preview **a partir do default branch, com dados**):
  - [`preview-branches-with-cloudflare`](https://github.com/neondatabase/preview-branches-with-cloudflare) (`61a1cf6`, 2026-05-23): um `scripts/deploy.ts` roda nos **Workers Builds** a cada push. Ele cria `preview-<branch>` sem `parent_id`, portanto do default, com TTL de 7 dias, e roda `drizzle-kit migrate` do próprio branch. A `NEON_API_KEY` fica no build, que executa o código do branch. O README diz: "the free tier is enough".
  - [`preview-branches-with-vercel`](https://github.com/neondatabase/preview-branches-with-vercel/blob/main/.github/workflows/deploy-preview.yml): `on: [pull_request]`, `permissions: write-all`, `create-branch-action@v5` sem parent e `prisma migrate deploy` no mesmo job que tem a key.
  - **Workflow da integração GitHub** ([doc](https://neon.com/docs/guides/neon-github-integration)): `preview/pr-N-<branch>`, a partir do default, com key pessoal.
  - **Integrações Vercel:** "Neon creates branch `preview/<git-branch>`", e as migrations rodam no build da Vercel ([Vercel-managed](https://neon.com/docs/guides/vercel-managed-integration), [Neon-managed](https://neon.com/docs/guides/neon-managed-vercel-integration)).
  - **Inferência:** os exemplos otimizam conveniência, não modelo de ameaça com código não confiável. **Nenhum** usa projeto separado, reset de senha ou dado saneado. A recomendação de saneamento aparece só nos guias conceituais (§2).
- **Repositórios públicos** (busca `gh search code` em 2026-10-18; todos pequenos, nenhum com projeto separado):

  | Repo (arquivo) | Prática |
  | --- | --- |
  | [`ubeann/vmb`](https://github.com/ubeann/vmb/blob/main/.github/workflows/preview.yml) | `pull_request`, parent `production` fixado, `branch_type: default` (dados completos, pelo journal do Drizzle), key no job que builda o PR; pula forks e Dependabot |
  | [`lakshgupta8/manasbal`](https://github.com/lakshgupta8/manasbal/blob/main/.github/workflows/preview-db.yml) | `create-branch-action` 6.3.1 por SHA, `branch_type: schema-only` ("Legal guardrail: previews get the schema only"), `role:` próprio, `expires_at` +14 dias |
  | [`TrgHieu05/meal-planner-monorepo`](https://github.com/TrgHieu05/meal-planner-monorepo/blob/main/.github/workflows/pull-request-create-preview.yml) | schema-only a partir do branch de produção, `expires_at` +7 dias |
  | [`wmishak404/laica`](https://github.com/wmishak404/laica/blob/main/.github/workflows/ci.yml) | schema-only com 3 tentativas (provável disputa da cota de root branches) e pula forks |
  | [`EmilioEsposito/portfolio`](https://github.com/EmilioEsposito/portfolio/blob/main/.github/workflows/neon_workflow.yml) | template da integração, `branch_type: default`, `expires_at` +14 dias |

## 6. Limites do Free relevantes

Fonte: [Plans](https://neon.com/docs/introduction/plans), salvo indicação.

| Item | Free |
| --- | --- |
| Projetos | **100** por conta (eram 50 no changelog de [2025-11-21](https://github.com/neondatabase/website/blob/main/content/changelog/2025-11-21.md)) |
| Branches | **10 por projeto**; "Extra branches are not available on the Free plan"; "Branch creation fails once you reach 10" |
| Root branches | 3 por projeto ([Schema-only](https://neon.com/docs/guides/branching-schema-only)) |
| Compute | 100 CU-h por projeto por mês; autoscaling até 2 CU; scale to zero após 5 min, sem como desligar |
| Storage | 1 GB por projeto, 20 GB no total |
| Egress | 5 GB por projeto por mês |
| Histórico | 6 h; 1 snapshot manual |
| `expires_at` | RFC 3339, "Maximum expiration is 30 days". Não pode em branch default, protegido ou com filhos, e não se criam filhos de um branch que expira ([Branch expiration](https://neon.com/docs/guides/branch-expiration)) |

- **Incerteza sobre `expires_at`:** a spec ainda diz "Access to this feature is currently limited to participants in the Early Access Program". O guia, o changelog (presets em [2025-10-17](https://github.com/neondatabase/website/blob/main/content/changelog/2025-10-17.md)) e o Console (que liga auto-delete por padrão) indicam que é GA. **Inferência:** o texto da spec está desatualizado.
- **Inferência:** o `preview-base` não pode ter `expires_at`, porque tem filhos. Os `preview/pr-N` podem.

## 7. Comparação de risco

Premissas: o build do PR não tem secrets. O job de deploy roda código da `main` e tem uma key **project-scoped**. O Worker de preview roda código do PR com a `DATABASE_URL` pooled do branch.

| | **(A)** Mesmo projeto, branch da produção com dados | **(B)** Mesmo projeto, branch de um `preview-base` saneado, com senha resetada no base | **(C)** Projeto Neon só de previews |
| --- | --- | --- | --- |
| **Quem tem a `DATABASE_URL` do preview** | Cópia integral da produção: e-mails, hashes de senha e **tokens de sessão ou reset ainda válidos na produção** (inferência: permitem sequestrar sessão real se forem guardados em claro). A **mesma senha da produção**: com o endpoint ID dela, lê e escreve na produção (§1) | Só dado sintético. Senha diferente da produção, então o endpoint ID da produção não basta. Alcança previews irmãos se souber os endpoints (mesma senha herdada do base), mas eles só têm lixo | Igual ao B, sem caminho algum para a produção (outro projeto, outras roles) |
| **SQL da migration do PR** | O mesmo de cima, mais exfiltração por `dblink` (§4) | Exfiltra só dado sintético | Igual ao B |
| **Disponibilidade da produção** | Preview pode esgotar CU-h, egress ou storage **do projeto** e suspender a produção (§4) | **Igual ao A** | **Isolada**: cotas próprias |
| **Key no deploy (código da `main`)** | Lê a senha da produção, roda SQL nela, faz restore por cima, reseta senha. Não apaga o branch root/default nem o projeto (§3) | **Igual ao A** | Só o projeto de previews. A key de produção fica num job/environment separado, só de deploy de produção |
| **Custo operacional** | Zero | Manter o `preview-base` com o schema da `main`: o deploy de produção também migra o base. Um reset de senha uma vez. 1 branch a mais na cota de 10 | 1 projeto e 1 key a mais. O base é semeado só com migrations (Drizzle `migrate` desde o zero) mais o seed. O deploy da `main` também migra o base de previews |

**Inferências finais:**
- **(A) não é aceitável** para código não confiável. A Neon diz que branchear da produção com PII "isn't appropriate" (§2), e a senha compartilhada abre a produção.
- **(B) elimina o risco de dados e de credencial** com custo baixo. Detalhes de implementação:
  - criar o `preview-base` como filho da produção e limpar com `TRUNCATE` (não `DELETE`) mais o seed. Isso preserva o journal `drizzle.__drizzle_migrations`, que sai junto com os dados;
  - **ou** criar o base como schema-only e semear. Nesse caso o journal pode vir vazio (não documentado);
  - depois, `reset_password` no base.
- **O que (C) acrescenta sobre (B):**
  1. **isolamento das cotas do Free**, que é o argumento forte, porque a produção pode ser suspensa por um preview;
  2. **key do preview sem alcance na produção**. Isso pesa mais no Forgejo, onde a pesquisa 19 mostrou que todos os secrets vão para todo job. Mas o ganho só existe se a key de produção não estiver no mesmo cofre.
- **Para quem aceitar (B),** reduzir o risco de cotas:
  - `expires_at` curto nos `preview/pr-N`;
  - criar o branch pela API (não pelo action) com `autoscaling_limit_max_cu: 0.25`;
  - acompanhar o uso. Um teto de 0,25 CU limita cada preview a cerca de 6 CU-h por dia acordado.

## Incertezas e pontos não verificados

- Não testei de verdade se a senha herdada autentica no endpoint da produção. É inferência forte, baseada na justificativa da própria Neon em [Protected branches](https://neon.com/docs/guides/protected-branches) e no roteamento por endpoint ID.
- Não documentado:
  - descobrir o endpoint ID do pai a partir do filho;
  - restrição de portas ou destinos na saída de rede;
  - se o schema-only copia senhas e o journal do Drizzle;
  - disponibilidade dos branches anonimizados no Free;
  - o que é o `init_source: parent-schema`.
- Não verifiquei se uma key Editor consegue desproteger um branch protegido (só vale para planos pagos).
- A numeração de versões do `create-branch-action` é inconsistente: release 6.3.1, tag v6.4.0, `version.ts` 6.1.1. Fixar por SHA.
