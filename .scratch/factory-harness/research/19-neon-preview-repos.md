# Pesquisa 19c — Como projetos sérios isolam os branches Neon de preview

Ticket: [19-pr-ci-security](../issues/19-pr-ci-security.md) (Q2: de onde o preview ramifica e se fica em projeto Neon separado) · Pesquisado em 2026-10-18
Complementa a §5 de [19-neon-preview-isolation](19-neon-preview-isolation.md), que encontrou só repositórios hobby. Não repete os fatos de senha, API key, cotas e anonimização que estão lá (§1–§4, §6).

Versões consultadas:
- **Repositórios no GitHub:** cada link aponta para o commit da branch default lido em 2026-10-18. As estrelas são as dessa data, lidas pela API do GitHub.
- **Site da Neon** (blog, docs e case studies): o repositório [`neondatabase/website`](https://github.com/neondatabase/website), commit `6c64ff6` (2026-10-16). Os posts trazem a data no front-matter, que vai junto de cada citação.
- **Docs da Vercel:** [Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github), `last_updated: 2026-09-17`.

Método: `gh search code` com os termos `create-branch-action`, `delete-branch-action`, `neonctl branches`, `console.neon.tech/api/v2/projects … branches`, `NEON_API_KEY`, `masking_rules` (com e sem `path:.github/workflows`). Isso deu 290 repositórios, que ordenei por estrelas. Li os workflows dos 15 primeiros que não são do próprio Neon nem coleções de skills. Os case studies saíram de `content/blog/posts/*.md` com `category: case-study` que mencionam preview ou PR.

Convenção: **Fonte diz** é afirmação da fonte primária (código, doc ou post). **Inferência** é leitura minha. **Não verificável** quer dizer que a resposta depende de configuração privada (secrets, Console da Neon) que não aparece no repositório.

---

## Resposta

**Quem tem dados sensíveis ou é organização grande não ramifica o preview da produção.** As duas formas de evitar isso aparecem nesta ordem de frequência:
1. **Banco de preview fora do projeto de produção (C), com dado sintético (seed).** É o que fazem:
   - **Isomer**, da GovTech de Singapura: a produção está em AWS RDS, e a Neon é só dos previews, semeados;
   - **okou**: um "test project" Neon separado do projeto de produção, com `db:reset` mais seed a cada preview;
   - **Metaculus**: a produção está no Heroku, e a Neon é só dos previews;
   - **Neo.Tax**: um projeto Neon por ambiente;
   - **Dispatch**: a produção está no Aurora e a Neon recebe só um subconjunto sem PII;
   - **Invenco**: "all our non-prod services into a single Neon project" com "synthetic dataset".
2. **Mesmo projeto, preview ramificado de um branch intermediário (B ou variante).** São os casos de:
   - **Commonwealth**: um branch dedicado `Review App Parent`;
   - **Zoonk** e **cali.so**: os previews ramificam do branch `staging`;
   - **Bitso**: "copies of their staging data";
   - **Rocketseat/upload**: um branch fixo mais seed.

**Ramificar da produção com dados (A) aparece em três situações:**
- quando o mantenedor aceita o risco de forma explícita e o mitiga. O caso mais claro é o **Rallly**: "Preview deployments get a Neon branch containing a copy of production data". Ele compensa com TTL de 6 dias, previews atrás de Vercel Authentication e uma cláusula no DPA;
- em apps pequenos, como o Otter, que apaga a tabela `jwks` copiada da produção;
- nos exemplos e integrações oficiais da Neon.

Nenhum projeto sério que encontrei roda **código não confiável** contra um branch com dados de produção. Todos excluem forks e Dependabot, ou dependem da *fork protection* da Vercel.

**Para o nosso caso (código de PR escrito por IA, plano Free), a prática dos projetos sérios aponta para C.**
- **O que pesa:** os projetos que separam têm pelo menos um destes três motivos: dados regulados (Isomer, Dispatch, Rallly com o DPA), cotas e raio de dano (okou, Neo.Tax), ou credencial/KMS da produção (okou).
- **O argumento das cotas por projeto** é específico do Free, ver [19b §4/§6](19-neon-preview-isolation.md). **Nenhum** repositório o cita explicitamente.
- **B fica como alternativa aceitável** se o C for inviável: há precedente (Commonwealth, Zoonk), mas sempre no mesmo projeto e sem tratar cotas.

| Opção | Quem faz | Por quê (quando dito) |
| --- | --- | --- |
| **A** produção com dados | Rallly, Otter, Magic Circle (case study); provavelmente Superset; exemplos oficiais da Neon | conveniência e "real data"; o Rallly mitiga com TTL, autenticação e DPA |
| **B** mesmo projeto, branch base intermediário | Commonwealth (`Review App Parent`), Zoonk e cali.so (`staging`), Bitso (staging), Rocketseat (branch fixo + seed) | não explicitado. A Neon descreve: "PR branches are usually derived from staging when a staging branch exists, and from production otherwise" ([Branching workflows](https://github.com/neondatabase/website/blob/6c64ff6/content/pages/use-cases/branching-workflows.md)). Note que o staging do diagrama é "created from production" |
| **C** projeto/banco separado | Isomer, okou, Metaculus, Neo.Tax, Dispatch, Invenco | PII/compliance (Dispatch "excluding PII", Isomer), separar credenciais (okou) e "a mistake in one project can't touch the others" (FAQ da Neon, §3) |

---

## 1. Repositórios públicos

### 1.1 Tabela

| Repo (★) | Gatilho | Pai do branch | Key/URL no job com código do PR? | Forks | Projeto separado? | Limpeza |
| --- | --- | --- | --- | --- | --- | --- |
| [superset-sh/superset](https://github.com/superset-sh/superset/blob/0e0c87f/.github/workflows/deploy-preview.yml#L3-L50) (15,3k) | `pull_request` | default do projeto (sem `parent`) | sim: migra e builda o código do PR com a URL | sem secrets, o job falha | **não verificável** (secrets por *environment* `preview` e `production`) | `delete-branch-action` ao fechar o PR |
| [lukevella/rallly](https://github.com/lukevella/rallly/blob/4cf46ff/.github/workflows/delete-stale-preview-branches.yml#L1-L28) (5,3k) | integração Vercel | **produção, com dados** | sim: o build da Vercel roda o código do PR | *fork protection* da Vercel | **não** | job noturno apaga `preview/*` com mais de 6 dias |
| [okou-ai/okou](https://github.com/okou-ai/okou/blob/212eb92/.github/workflows/turbo.yml#L1215-L1259) (1,2k) | `pull_request` | default do **projeto de teste**, depois `db:reset` + seed | sim | pula forks | **sim** | `pull_request_target` ao fechar + job de stale |
| [opengovsg/isomer](https://github.com/opengovsg/isomer/blob/1aa9d06/.github/workflows/neon_cleanup.yml#L1-L18) (32, GovTech SG) | integração Vercel | default do projeto Neon **só de previews** (a produção é RDS), com seed | sim: o build da Vercel | *fork protection* da Vercel | **sim** | `delete-branch-action` ao fechar o PR |
| [Metaculus/metaculus](https://github.com/Metaculus/metaculus/blob/6a858ea/.github/workflows/pr_preview.yml#L12-L14) (115) | `pull_request` | default do projeto (sem `parent`) | sim | pula forks com comentário explicativo | **sim, de fato** (produção no Heroku) | ao fechar o PR + varredura |
| [hicommonwealth/commonwealth](https://github.com/hicommonwealth/commonwealth/blob/fca71cc/.github/workflows/review_app.yml#L134-L151) (90) | `issue_comment` `/deploy` | **`Review App Parent`** (branch dedicado) | sim | **sem filtro** (ver §1.2) | não (o comentário cita `compare_branch: production`) | workflow `destroy_review_app.yml` |
| [zoonk/zoonk](https://github.com/zoonk/zoonk/blob/944dce2/.github/workflows/preview.yml#L63-L77) (158) | `pull_request` | **`staging`** (validado ≠ produção) | sim (`NEON_API_KEY` no `env` do job) | pula forks | não | ao fechar o PR |
| [CaliCastle/cali.so](https://github.com/CaliCastle/cali.so/blob/653615f/.github/workflows/deploy-preview.yml#L19-L43) (2,0k, site pessoal) | `push` em branches internas | **`staging`** | sim | `fork == false`, sem Dependabot | não | `cleanup-preview.yml` |
| [mrmartineau/Otter](https://github.com/mrmartineau/Otter/blob/cd104a8/.github/workflows/ci.yml#L33-L59) (192) | `pull_request` | **produção, com dados** | sim | pula forks | não | `delete-branch-action` ao fechar o PR |
| [Rocketseat/upload](https://github.com/Rocketseat/upload/blob/d962027/.github/workflows/deploy-preview.yml#L49-L78) (180) | `pull_request` | branch fixo `br-quiet-king-…`, depois `db:seed` | sim (secrets no `env` do workflow) | nenhum filtro (forks não recebem secrets) | não verificável | `cleanup-preview.yml` |
| [evloghq/evlog](https://github.com/evloghq/evlog/blob/3f1617d/.github/workflows/neon-preview-cleanup.yml#L3-L23) (1,9k) | integração Vercel | default (padrão da integração) | sim: o build da Vercel | limpeza só para PRs internos | não verificável | ao fechar o PR |
| [scanopy/scanopy](https://github.com/scanopy/scanopy/blob/709c7c9/.github/workflows/release.yml#L171-L211) (5,9k) | `release` (não é PR) | "Create Neon branch off prod" | código já em release, confiável | n/a | não | `expires_at` +1 dia |

### 1.2 Detalhes que importam

- **Rallly** é o único que **documenta a decisão de usar A**:
  - **Fonte diz** ([workflow](https://github.com/lukevella/rallly/blob/4cf46ff/.github/workflows/delete-stale-preview-branches.yml#L3-L10)): "Preview deployments get a Neon branch containing a copy of production data. This job deletes any preview/* branch older than the TTL so those copies never outlive the retention commitments in our DPA." A config é "NEON_API_KEY secret (project-scoped)".
  - **Fonte diz** ([PR #3121](https://github.com/lukevella/rallly/pull/3121), 2026-08-31): "Keeps the integration's default preview branching (copies of production data, branched from the default branch)". E também: "preview deployments are already behind Vercel Authentication (SSO, all non-custom domains), so with this TTL the posture is 'production data in previews: access-restricted, auto-deleted ≤7 days.'"
  - **Fonte diz** ([PR #3122](https://github.com/lukevella/rallly/pull/3122)): o TTL baixou para 6 dias para que o "Section 9.4 of the DPA … deleting preview copies within 7 days" seja "true by construction".
  - **Inferência:** o Rallly trata o preview como ambiente confiável, só de quem tem acesso ao repo. A mitigação dele é de *retenção e acesso*, não de *código não confiável*. Para nós não serve: o código do PR (o agente) leria os dados copiados.
- **okou** é o exemplo mais próximo do que queremos:
  - **Fonte diz** ([turbo.yml L1252-L1257](https://github.com/okou-ai/okou/blob/212eb92/.github/workflows/turbo.yml#L1252-L1257)): "Recreate this disposable preview branch so parent data cannot retain ciphertext encrypted with the retired test KMS key. This job has no production environment; NEON_PROJECT_ID is the test project." Em seguida roda `db:reset` e `db:dev-seed --preview-onboarding-catalog`.
  - **Fonte diz:** o deploy de produção roda em `environment: production` e pega a URL com `neonctl connection-string production --project-id ${{ vars.NEON_PROJECT_ID }}` ([release-please.yml L1191-L1237](https://github.com/okou-ai/okou/blob/212eb92/.github/workflows/release-please.yml#L1191-L1237)).
  - **Inferência:** a separação entre o projeto de teste e o de produção é feita com **variáveis e secrets por GitHub Environment**: o nível do repo aponta para teste, o environment `production` sobrescreve. O job de preview não declara `environment:` ([turbo.yml L1146-L1161](https://github.com/okou-ai/okou/blob/212eb92/.github/workflows/turbo.yml#L1146-L1161)). No Forgejo esse mecanismo não existe, ver [19-forgejo-secrets-isolation](19-forgejo-secrets-isolation.md).
- **Isomer (GovTech Singapura):**
  - **Fonte diz:** staging, UAT e prod ficam em RDS, acessados por túnel ("Sets up a tunnel to the RDS instance … prod|staging|uat|vapt", [connectRds.sh](https://github.com/opengovsg/isomer/blob/1aa9d06/apps/studio/scripts/connectRds.sh)).
  - **Fonte diz:** o preview Vercel roda `migrate`, `migrate:custom` e **`db:seed`** no build ([package.json `vercel-build`](https://github.com/opengovsg/isomer/blob/1aa9d06/apps/studio/package.json)).
  - **Fonte diz:** a key é "neon project-scoped api key: isomer-studio-postgres" ([neon_cleanup.yml L17](https://github.com/opengovsg/isomer/blob/1aa9d06/.github/workflows/neon_cleanup.yml#L17)).
  - **Fonte diz** ([PR #2307](https://github.com/opengovsg/isomer/pull/2307)): o preview usa R2 no lugar do S3 de produção. Tem também um OTP estático e um bypass de SingPass, "forbidden outside preview at boot".
  - **Inferência:** C no grau máximo. A produção nem está na Neon, e o preview só tem seed.
- **Metaculus:**
  - **Fonte diz** ([pr_preview.yml L12-L14](https://github.com/Metaculus/metaculus/blob/6a858ea/.github/workflows/pr_preview.yml#L12-L14)): "This workflow only runs for internal PRs … Fork PRs are skipped because GitHub Actions does not provide secrets access to workflows triggered by fork PRs".
  - **Fonte diz:** a produção é o app Heroku `metaculus-web` ([deploy_production.yml](https://github.com/Metaculus/metaculus/blob/6a858ea/.github/workflows/deploy_production.yml)).
  - **Não verificável:** o que há no branch default do projeto Neon de previews.
- **Commonwealth** é B, e também um **antiexemplo de gatilho**:
  - **Fonte diz** ([review_app.yml L3-L26, L125-L151](https://github.com/hicommonwealth/commonwealth/blob/fca71cc/.github/workflows/review_app.yml#L3-L26)): o gatilho é `issue_comment` com `body == '/deploy'`, **sem checar `author_association`**. O job faz checkout de `refs/pull/N/head`, roda `./.github/actions/setup` e `pnpm migrate-db` do PR com `NEON_API_KEY` e `RAILWAY_TOKEN`.
  - **Inferência:** é o padrão "pwn request" descrito pelo [GitHub Security Lab](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/): qualquer pessoa comenta `/deploy` num PR de fork e executa código com os secrets. O pai dedicado (B) limita os *dados* expostos, mas não a key.
- **Zoonk:**
  - **Fonte diz** ([database.mts L77-L88](https://github.com/zoonk/zoonk/blob/944dce2/scripts/deploy/database.mts#L77-L88)): para `preview`, grava `NEON_PARENT_BRANCH=${staging.id}`. O script recusa rodar se staging e produção forem o mesmo branch: "Staging and production must use different Neon branches".
  - **Não verificável:** se o `staging` tem dados de produção.
- **Otter** (Cloudflare Workers + Neon, a stack mais parecida com a nossa):
  - **Fonte diz** ([ci.yml L33-L57](https://github.com/mrmartineau/Otter/blob/cd104a8/.github/workflows/ci.yml#L33-L57)): "a Neon branch of production per PR". E também: "The branch copies production's JWKS, whose private keys are encrypted with production's BETTER_AUTH_SECRET … drop them". Faz isso com `delete from jwks`.
  - **Inferência:** esse é o tipo de vazamento que A traz. O preview herda segredos guardados em tabelas, e o projeto apaga um a um. Isso é *deny-list*, como o anonimizado da [19b §2.1](19-neon-preview-isolation.md).
- **Superset:**
  - **Fonte diz** ([deploy-preview.yml L36-L50](https://github.com/superset-sh/superset/blob/0e0c87f/.github/workflows/deploy-preview.yml#L36-L50)): grava `DATABASE_URL` e `DATABASE_URL_UNPOOLED` num arquivo `database-status.env` e o publica com `actions/upload-artifact`.
  - **Fonte diz:** baixar artifacts exige "Read access to the repository" ([GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)).
  - **Inferência:** num repo público, qualquer usuário logado pode baixar a connection string do preview enquanto o branch existe. Se o pai for a produção no mesmo projeto, a senha dela é a mesma da produção ([19b §1](19-neon-preview-isolation.md)). Não baixei o artifact para confirmar.
- **cali.so:** usa duas roles, `migration-role` e `runtime-role` ("Neon role limited to application CRUD"), na [action local](https://github.com/CaliCastle/cali.so/blob/653615f/.github/actions/deploy-neon-vercel/action.yml#L31-L35). É o único caso de mínimo privilégio na role do runtime.

## 2. Case studies da Neon com detalhes concretos

| Empresa | O que a fonte diz | Opção |
| --- | --- | --- |
| **Dispatch** ([post](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/how-dispatch-speeds-up-development-with-neon-while-keeping-workloads-on-aurora.md), 2024-10-14) | A produção fica no Aurora. "replicate a portion of their workload data (excluding PII) for testing in ephemeral environments"; "a safe, SOC 2-compliant subset … AWS DMS to replicate data from their Aurora cluster into a main branch in Neon" | **C** com subconjunto saneado |
| **Neo.Tax** ([post](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/from-days-to-minutes-how-neo-tax-accelerated-their-development-lifecycle.md), 2024-06-03) | "three primary environments, each one with its own separate project in Neon: development, staging, and production". Deploy previews com "pre-built accounts" | **C** |
| **Invenco** (citado em [Branching With or Without PII](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/branching-environments-anonymized-pii.md), 2025-11-11) | "we consolidated all our non-prod services into a single Neon project. We just load our synthetic dataset once into the main staging branch and spin off child branches as needed" | **C** com seed |
| **Bitso** ([post Neon](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/bitso-branching-workflow.md), 2026-01-07; [post Signadot](https://www.signadot.com/blog/how-bitso-is-scaling-branch-based-development-with-signadot-and-neon)) | "without affecting the baseline staging data"; segundo a Signadot, "spin up copies of their staging data for every Signadot Sandbox". Não diz se a produção está na Neon | **B** (staging como pai) |
| **Magic Circle** ([post](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/how-magic-circle-scaled-up-to-2m-games-with-cloudfare-and-neon.md), 2024-12-12) | "We get a totally isolated copy … We can test all changes in real data"; "every branch mirrors the production database" | **A** |
| **Topo.io** ([post](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/why-topo-io-switched-from-amazon-rds-to-neon.md), 2024-02-01) | Branches de dev "with production data"; previews "shortly" | **A** (dev, não preview) |

- **Inferência:** os dois casos com dados financeiros ou regulados (Dispatch; Bitso é fintech) **não** expõem a produção ao ambiente efêmero. A usa produção do lado de fora; a Bitso, staging. A aparece em produtos de consumo pequenos (jogo, CRM).

## 3. Orientação da Neon que não estava na 19b

- **Fonte diz** ([FAQ "How do I create a new project in Neon?"](https://github.com/neondatabase/website/blob/6c64ff6/content/faqs/create-new-neon-project.md), `updatedOn` 2026-09-23): "Create a separate project for each application or each customer. Each one gets its own storage, computes, and branches, so a mistake in one project can't touch the others."
  - O texto fala de app e de cliente, **não de ambiente**. **Inferência:** a justificativa ("a mistake … can't touch the others") é a mesma do nosso argumento de cotas.
- **Fonte diz** ([Promoting Postgres Changes Safely](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/promoting-postgres-changes-safely-production.md), 2025-11-25): "the workflow that many Neon customers run in production today … two isolated root branches, prod and dev". Depois: "Create short-lived child branches for previews or PR workflows" a partir do `dev`.
  - **Inferência:** essa é uma **variante de B** com o `preview-base` como *root branch* (schema-only ou restaurado), sem linhagem de dados com a produção. Gasta 1 dos 3 root branches do Free e continua dividindo as cotas do projeto.
- **Fonte diz** ([Data anonymization with GitHub Actions](https://github.com/neondatabase/website/blob/6c64ff6/content/docs/workflows/data-anonymization-github-actions.md), `updatedOn` 2026-06-05): o exemplo usa `on: pull_request` com `masking_rules` e pede "a Neon project with a populated parent branch". A página não fala de forks nem de projeto separado.
- **Fonte diz** ([Neon GitHub Actions automated branching](https://github.com/neondatabase/website/blob/6c64ff6/content/guides/neon-github-actions-authomated-branching.md)): "The `DATABASE_URL` secret … points to your production database. The workflow uses it only after a PR is merged … so production stays separate from the ephemeral preview branches."
  - **Inferência:** o guia separa a *credencial* de produção do job de PR, mas o preview continua sendo filho da produção, com a mesma senha ([19b §1](19-neon-preview-isolation.md)).
- **Fonte diz:** o post de 2023 [A database for every preview environment](https://github.com/neondatabase/website/blob/6c64ff6/content/blog/posts/branching-with-preview-environments.md) descarta seed ("will not accurately represent production") e recomenda o branch com "production data".
  - **Inferência:** o material de marketing mais antigo puxa para A. O mais novo (2025–2026) puxa para anonimizado ou staging.
- **Vercel** ([Vercel for GitHub › Deployment Authorizations for Forks](https://vercel.com/docs/git/vercel-for-github)): "If you receive a pull request from a fork … Vercel will require authorization … This behavior protects you from leaking sensitive project information such as environment variables". É a única barreira contra forks nos projetos que usam a integração (Rallly, Isomer, evlog). A integração Neon cria `preview/<git-branch>` para todo preview **autorizado** ([Neon-managed integration](https://github.com/neondatabase/website/blob/6c64ff6/content/docs/guides/neon-managed-vercel-integration.md)).

## 4. Incidentes e discussões públicas

- **Não achei** nenhum incidente público nem postmortem de vazamento de dados via branch Neon de preview. Busquei na web, no Hacker News e em issues do GitHub.
- O que existe são autocorreções em repositórios pequenos (0★). Servem só como evidência anedótica do risco:
  - [Rocktown-Labs/mysoundkit#267](https://github.com/Rocktown-Labs/mysoundkit/issues/267) (2026-09-27, aberta): "PR preview Workers currently deploy with full production secrets … and share the production database. An arbitrary same-repo PR branch can exfiltrate or mutate production data."
  - [dlopez2392/prism#33](https://github.com/dlopez2392/prism/pull/33) (2026-10-01, merged): "previews pointed at production's database. Unmerged code, or a compromised dependency in an update PR, could therefore open every sealed bank token". O fix foi "no vault key and no database" em preview.
- **Inferência:** a ausência de incidente público não é evidência de segurança. Um vazamento por preview tende a não ser divulgado ou a não ser detectado.

## 5. Mapeamento para A/B/C

- **Prática comum:**
  1. Previews só para PRs internos: todos os projetos sérios filtram `head.repo.full_name == github.repository` ou usam a *fork protection* da Vercel.
  2. Limpeza ao fechar o PR, e às vezes TTL.
  3. Key project-scoped (Rallly, Isomer).
  4. A `DATABASE_URL` ou a key no mesmo job que roda o código do PR. **Todos** fazem isso: nenhum separa "criar branch" de "rodar código do PR" como a pesquisa 19 propõe.
- **A** existe em projetos conhecidos, mas sempre com a premissa de que **o código do PR é confiável**, porque é de colaboradores. O Rallly, o mais sério desse grupo, precisou de DPA, TTL e SSO para sustentar a escolha. Nosso modelo de ameaça (código de agente não confiável) quebra essa premissa.
- **B** tem precedente (Commonwealth, Zoonk, cali.so, Bitso), mas nenhum deles documenta reset de senha no pai. Pelo que a 19b mostrou, a senha do `staging` ou do `Review App Parent` continua igual à da produção, a menos que tenha sido resetada à mão (não verificável). Nenhum deles trata cotas.
- **C** é o que fazem os projetos com mais em jogo: governo (Isomer), fintech/logística com SOC 2 (Dispatch), e quem tem KMS e produção separados (okou), além de Neo.Tax e Invenco. Os motivos citados são PII ou compliance, credenciais e "a mistake in one project can't touch the others".
- **Conclusão:** projetos sérios escolhem **C**, muitas vezes com a produção nem na Neon, e com **seed ou subconjunto saneado** no projeto de preview. Isso coincide com a recomendação da 19b. O motivo deles é dado e credencial; para nós, no Free, as cotas por projeto são um motivo a mais, que nenhum deles precisou citar.

## Incertezas e pontos não verificados

- **Não verificável sem acesso ao Console ou aos secrets:**
  - se `NEON_PROJECT_ID` do Superset (environment `preview`) é o mesmo projeto da produção;
  - o conteúdo do branch default do projeto de preview do Metaculus;
  - o conteúdo de `staging` (Zoonk, cali.so), de `Review App Parent` (Commonwealth) e do branch fixo da Rocketseat;
  - se `evi-db` é a produção do evlog.
- **okou:** a separação em dois projetos é inferência. Ela se apoia no comentário "NEON_PROJECT_ID is the test project" e no uso de `environment: production` nos jobs de produção. Não vi os valores.
- **Commonwealth:** a leitura de "pwn request" vem só do YAML. Não testei, e pode haver proteção fora do arquivo (por exemplo, aprovação exigida para workflows de forks não cobre `issue_comment`). O último commit é de 2026-04-23.
- **Superset:** não baixei o artifact para confirmar que a URL vai em texto claro. É o que o YAML indica.
- **A busca de código do GitHub** indexa só parte dos repositórios e não vê a configuração das integrações Vercel/Neon feita pelo painel. Grandes projetos que usam só a integração, sem workflow, ficam invisíveis. Exemplo: o Rallly só apareceu por causa do job de limpeza.
- **Os case studies são marketing da Neon.** Os detalhes de segurança neles (Dispatch "excluding PII", Invenco "synthetic dataset") são declarações, não código auditável.
