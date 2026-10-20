# Pesquisa 19b — Forgejo: isolar as credenciais de deploy do código do PR

Ticket: [19-pr-ci-security](../issues/19-pr-ci-security.md) · Pesquisado em 2026-10-18
Complementa: [19-pr-ci-security](19-pr-ci-security.md) (seção 2, Forgejo) e [14-forgejo-portability](14-forgejo-portability.md). Aqui a pergunta é **como resolver** no Forgejo, não só documentar.

Versões consultadas (fonte primária = código; a doc entra como confirmação ou contradição):
- **Forgejo v17.0.0**: tag `0d791421`, commit de 2026-10-15. É a versão citada nos links `F17` abaixo.
- **Forgejo v16.0.6**: tag `1aa13944`, 2026-10-12. Comparei por `diff` os arquivos-chave: `secret.go`, `task.go`, `auth.go`, `context.go`, `repo_permission.go`, `trust.go`, a detecção em `notifier_helper.go` e o `hook_pre_receive.go`. A lógica relevante é **idêntica** à da v17.0.0; só mudam nomes, *namespaces* de jobs e o novo `preReceivePull`.
- **Branch `v17.0/forgejo`**: commit `e5145ff6`, 2026-10-18. Ainda não lançada (será a v17.0.1). Traz o PR #14864, ver 1.1.
- **Forgejo Runner v13.2.0**: tag `df6b843f`, 2026-09-18. É a última release. O `main` (`c4a92ffa`, 2026-10-02) mantém o mesmo `getWriteIsolationKey`. Links `R`.
- **Docs Forgejo v17.0**: forgejo.org/docs/v17.0, lidas em 2026-10-18.
- **Gitea `main`**: commit `d0c35bcd`, 2026-10-18. Docs da Gitea versão 28.
- **Cloudflare / Neon**: docs com as datas citadas em cada item.

Bases dos links:
- `F17` = `https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/`
- `R` = `https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/`

Convenção: **Fonte diz** é o que o código ou a doc afirma. **Inferência** é leitura minha. **Não testado** quer dizer que não rodei numa instância.

---

## Resposta curta

1. **"Enviado ao runner" ≠ "alcançável pelo step".**
   - O servidor manda **todos** os secrets do repo e do dono em todo job não-fork.
   - O runner **só os expõe por expressões `${{ secrets.X }}`**. Ele não os põe no env nem em disco.
   - Um job cujo YAML não referencia secrets, rodando em container com a config padrão do runner (sem socket Docker, sem `privileged`, sem executor `host`), **não tem caminho documentado nem visível no código** para lê-los.
2. **O problema real não é o runner. É quem escreve o YAML.**
   - No desenho atual, o machine user tem escrita e cria branches no próprio repo. Ele pode subir um workflow `on: push` com `${{ toJSON(secrets) }}` e levar **todos** os secrets.
   - A doc oficial diz isso com todas as letras: "If Mallory can push directly to the repository, they can run arbitrary workflows." Também: branch protection não impede, porque "can create a new branch that isn't covered by branch protection" ([Securing Forgejo Actions Deployments, v17](https://forgejo.org/docs/v17.0/admin/actions/security/)).
   - Separar build e deploy em jobs, ou usar labels de runner, **não resolve nada** enquanto o machine user tiver escrita e os secrets estiverem no Forgejo.
3. **Há duas saídas que funcionam, e elas se combinam:**
   - **(a) Tirar do machine user a capacidade de executar YAML próprio com secrets.** Ele passa a ter só leitura e abre PRs via **AGit** (`git push origin HEAD:refs/for/main/<topic>`) ou via fork.
     - O Forgejo trata PR AGit como PR de fork. No `pull_request`, ele roda sem secrets, com token só de leitura e sem OIDC.
     - Só o `pull_request_target`, cujo YAML vem da branch base, roda com secrets.
   - **(b) Tirar as credenciais Cloudflare/Neon do Forgejo.** O job de deploy as obtém via **OIDC** (`enable-openid-connect`, só nele) num broker que valida `repository_id`, `event_name`, `ref` e `workflow_ref`.
4. **Truque Forgejo-nativo que reduz o que vai ao runner do build.** Coloque o job de build num **reusable workflow local** chamado **sem `secrets:`** e **sem `runs-on`** no job chamador. Assim o servidor envia ao job interno **só** os tokens automáticos, e nenhum secret do repo (seção 2.3).
5. **Ranking** (detalhes na seção 6):
   1. **Desenho B, o mais forte:** AGit + build em reusable sem secrets + deploy via OIDC/broker.
   2. **Desenho A, o mais simples sem infraestrutura nova:** AGit + build em reusable sem secrets + deploy com secrets do Forgejo + runners separados.
   3. **Desenho C, a menor mudança na Factory:** branches no mesmo repo + broker OIDC obrigatório. Sobram riscos: token de escrita no build, cache envenenável, demais secrets do Forgejo expostos.

   Os três mantêm a forma do YAML do GitHub: **um `pull_request_target` com dois jobs**.

---

## 1. Reverificação das afirmações da pesquisa anterior

| # | Afirmação | Status (v16.0.6 = v17.0.0) | Fonte |
|---|---|---|---|
| 1 | Todo job não-fork recebe **todos** os secrets do repo e da org, referenciados ou não | **Confirmada**, com uma exceção nova: o job **interno** de um reusable workflow recebe só o que o chamador mapeia em `secrets:`, ou tudo com `secrets: inherit` | [`services/actions/secret.go` L18-60](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/secret.go#L18-L60) → [`models/secret/secret.go` L191-215](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/secret/secret.go#L191-L215); exceção em [`secret.go` L62-134](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/secret.go#L62-L134) |
| 2 | O token automático tem escrita no repo inteiro | **Confirmada para PR não-fork.** PR de fork e AGit ficam com leitura, inclusive no `pull_request_target`. A doc v17 continua dizendo que o token do `pull_request` "does *not* have write permissions", o que **contradiz** o código | [`models/perm/access/repo_permission.go` L143-165](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/perm/access/repo_permission.go#L143-L165); [Security, v17](https://forgejo.org/docs/v17.0/user/actions/security/) |
| 3 | `permissions:` é ignorado | **Confirmada.** O servidor só gera um aviso apontando para "Authorized Integrations" | [`services/actions/notifier.go` L832-847](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/notifier.go#L832-L847); texto em `options/locale_next/locale_en-US.json` L1033 |
| 4 | `workflow_run` não existe | **Confirmada.** A feature request [#7722](https://codeberg.org/forgejo/forgejo/issues/7722) segue aberta. A doc v17 lista só push, issues, issue_comment, pull_request, pull_request_target, release, schedule, workflow_call e workflow_dispatch | [Reference, v17](https://forgejo.org/docs/v17.0/user/actions/reference/) |
| 5 | Com `pull_request_target`, o código do PR escreve no cache sem isolamento | **Confirmada** no runner v13.2.0 e no `main` `c4a92ffa`: só o `pull_request` recebe *write isolation key* | [`internal/app/run/runner.go` L194-230](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L194-L230) |

### Achados novos que mudam o desenho

- **O `environment:` é aceito e ignorado.**
  - O schema do runner aceita a chave (`"environment": "job-environment"`, [`act/schema/workflow_schema.json` L1464](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/schema/workflow_schema.json#L1464)), mas o `jobparser.Job` não tem esse campo ([`act/jobparser/model.go` L150-167](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/jobparser/model.go#L150-L167)).
  - A Gitea documenta o mesmo: "`jobs.<job_id>.environment` is ignored" ([Gitea: Compared to GitHub Actions](https://docs.gitea.com/usage/actions/comparison/)).
- **O claim OIDC `ref_protected` é sempre `"false"`.**
  - O código tem `gitContext["ref_protected"] = false` ([`services/actions/context.go` L106](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/context.go#L106)).
  - A doc diz "`true` if the ref has branch protection" ([Security OpenID Connect, v17](https://forgejo.org/docs/v17.0/user/actions/security-openid-connect/)), o que **contradiz** o código.
  - O PR que corrigia isso, [#13769](https://codeberg.org/forgejo/forgejo/pulls/13769), foi **fechado sem merge** em 2026-08-04. Um broker não pode confiar nesse claim.
- **A regra de secrets mudou na branch `v17.0/forgejo`** ([#14864](https://codeberg.org/forgejo/forgejo/pulls/14864), merge em 2026-10-16, ainda sem release).
  - A condição "fork && não é `pull_request_target`" vira `job.CanAccessSecrets()`. Ela retorna `true` para run não-fork e, em fork ou AGit, só quando o YAML veio da base (`WorkflowSourceCommit` presente) ([`models/actions/run_job.go` L215-235 @ e5145ff](https://codeberg.org/forgejo/forgejo/src/commit/e5145ff6a57c0704ced0a57bbf9b8da48e415383/models/actions/run_job.go#L215-L235)).
  - Para este desenho, o efeito é o mesmo: `pull_request_target` recebe secrets, e `pull_request` de fork ou AGit não recebe.
- **Até a release de segurança de 2026-08-20 (v16.0.3), reusable workflows locais em `pull_request_target` eram lidos do head do PR.** A correção passou a lê-los da base e a gravar `workflow_source_commit` ([#13984](https://codeberg.org/forgejo/forgejo/pulls/13984); [`models/actions/run.go` L59 e L303-308](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/actions/run.go#L59)). **O desenho com reusable workflow exige Forgejo ≥ v16.0.3.** Recomendo ≥ v16.0.6 ou v17.0.0, que também corrigem os eventos `pull_request_review*` de fork ([#14811](https://codeberg.org/forgejo/forgejo/pulls/14811)).

---

## 2. O crux: enviado ao runner vs. alcançável pelo step

### 2.1 Caminho de um secret, do banco ao step

1. O servidor monta o `runnerv1.Task` com `Secrets: secrets`, saídos de `getSecretsOfTask` ([`services/actions/task.go` L61 e L86-93](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/task.go#L61-L93)). O `getSecretsOfTask` acrescenta `GITHUB_TOKEN`, `GITEA_TOKEN` e `FORGEJO_TOKEN` ([`secret.go` L18-24](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/secret.go#L18-L24)).
2. O runner copia `task.Secrets` para `runner.Config.Secrets` ([`runner.go` L358](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L345-L380)). Nada disso é gravado em disco: um grep por `os.WriteFile`/`os.Create` em `internal/` e `act/runner/` só acha o arquivo de registro `.runner` e a leitura de `action.yml`.
3. O único consumidor dos secrets é o avaliador de expressões: `getWorkflowSecrets` → `rc.Config.Secrets` ([`act/runner/expression.go` L513-537](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/runner/expression.go#L513-L537)), exposto como contexto `secrets` ([`act/exprparser/interpreter.go` L190](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/exprparser/interpreter.go#L190)). Os outros usos são o mascaramento de log ([`act/runner/logger.go` L185](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/runner/logger.go#L185)) e `configCopy.Secrets = nil` em composite actions ([`action_composite.go` L62](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/runner/action_composite.go#L62)).
4. **O que vai ao env de todo step**, sem referência no YAML:
   - `FORGEJO_TOKEN` e `GITHUB_TOKEN`, via `set("TOKEN", github.Token)` ([`act/runner/run_context.go` L1706-1731](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/runner/run_context.go#L1706-L1731)), com `preset.Token` = `task.Secrets["FORGEJO_TOKEN"]` ([`runner.go` L291-295](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L291-L295));
   - `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN` e `ACTIONS_ID_TOKEN_REQUEST_URL`. Os dois últimos ficam vazios quando o job não tem OIDC ([`runner.go` L301-309](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L301-L309); [`task.go` L198-204](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/task.go#L198-L204));
   - **toda variável de `runner.envs` e de `runner.env_file`** ([`runner.go` L60-89](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L60-L89), mescladas em `GetEnv`, [`run_context.go` L101-118](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/runner/run_context.go#L101-L118); config em [`config.example.yaml` L26-32](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/pkg/config/config.example.yaml#L26-L32)).

**Resposta (fonte diz + inferência):** um secret do Forgejo **só chega a um step se o YAML do job o interpolar.** Os únicos segredos "implícitos" são o token automático e o que o admin puser em `runner.envs`.

### 2.2 Vetores para código não confiável num job que não referencia secrets

| Vetor | Alcança os secrets do task? | Base |
|---|---|---|
| Interpolação no YAML | Só se quem controla o YAML quiser. Esse é o vetor real (seção 3) | 2.1 |
| Env do step / `/proc/self/environ` | Não. Lá só estão os tokens e `runner.envs` | 2.1 |
| Disco do container (workspace, event.json) | Não. O event.json é o payload do evento, não os secrets | 2.1; `EventJSON` em [`runner.go` L328-362](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L328-L362) |
| Memória do processo `forgejo-runner` com **executor `host`** | **Sim.** "step commands are executed as the same user as the Forgejo Runner"; "the runner token is then accessible to the running job" | [Securing Forgejo Actions Deployments, v17](https://forgejo.org/docs/v17.0/admin/actions/security/) |
| Container com `container.privileged: true` | **Sim.** "Mallory will be able to operate as `root` on the Forgejo Runner machine" | mesma página |
| Container com socket Docker montado (`docker_host: automount` ou URL) | **Sim, por inferência.** Com o socket, o job cria um container `--pid=host`/privilegiado e inspeciona o runner ou os containers de outros jobs | [`config.example.yaml` L217-223](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/pkg/config/config.example.yaml#L217-L223) (padrão `"-"`, que não monta) |
| Container com a config padrão (`docker_host: "-"`, `privileged: false`, rede própria por job) | **Não, salvo fuga de container.** "Container runners are generally safe, but they may be compromised if misconfigured." | [`config.example.yaml` L192-223](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/pkg/config/config.example.yaml#L192-L223); [Security, v17](https://forgejo.org/docs/v17.0/user/actions/security/) |
| Runner comprometido por um job anterior | **Sim, para jobs futuros** no mesmo runner: "any future workflows sent to this runner may also be compromised" | [Security, v17](https://forgejo.org/docs/v17.0/user/actions/security/) |

**Inferência:** o que o servidor envia a mais (todos os secrets) é um risco **de segunda ordem**. Só importa se o runner do build for comprometido. Mesmo assim, dá para zerar esse envio com o reusable workflow (2.3) ou com secrets fora do Forgejo (seção 6).

### 2.3 Como fazer o servidor **não enviar** secrets ao job de build

- **Fonte diz (código):**
  - um job com `uses: ./.forgejo/workflows/x.yml` e **sem `runs-on`** é expandido no servidor em jobs internos (`expandForJob` = `len(job.RunsOn()) == 0`, [`services/actions/reusable_workflows.go` L25-58](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/reusable_workflows.go#L25-L58));
  - para um job interno, `getSecretsOfJob` desvia para `getSecretsOfInnerWorkflowCall`. Esse método devolve tudo **só** com `secrets: inherit`. Caso contrário, devolve o resultado de `EvaluateWorkflowCallSecrets`, que só itera `modelJob.Secrets()`, o mapa `secrets:` do chamador ([`secret.go` L37-39 e L84-131](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/secret.go#L37-L131); [`act/jobparser/model.go` L576-621](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/jobparser/model.go#L576-L621));
  - sem `secrets:`, o mapa sai vazio e só os três tokens são acrescentados.
- **Fonte diz:** no `pull_request_target`, a expansão local lê da base (`WorkflowSourceCommit`), corrigido em 2026-08-20 ([#13984](https://codeberg.org/forgejo/forgejo/pulls/13984); [`notifier_helper.go` L385-441](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/notifier_helper.go#L385-L441)).
- **Portabilidade:** no GitHub, secrets também só passam a um reusable workflow via `secrets:` ou `inherit` ("Use the `secrets` keyword to pass named secrets"). Um `./` local vem "from the same commit as the caller workflow" ([Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)). O mesmo YAML vale nas duas forjas.
- **Não testado:**
  - se `needs: build` no job de deploy espera os jobs internos. O código sugere que sim: o jobparser propaga `needs` para os internos ([`act/jobparser/jobparser.go` ~L600-620](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/jobparser/jobparser.go#L600-L620));
  - se `upload-artifact` e `download-artifact` funcionam entre um job interno e um job irmão do chamador. Pela inferência, sim, porque é o mesmo `run_id`.

---

## 3. `pull_request` e `pull_request_target` no Forgejo

Os dados abaixo vêm do código v17.0.0. Nos dois eventos, o PR pode ser:
- **"mesmo repo"**: branch do próprio repositório;
- **fork ou AGit**: o Forgejo trata AGit como fork, com `IsForkPullRequest = true` ([`models/issues/pull.go` L478-488](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/issues/pull.go#L478-L488)).

| | `pull_request`, mesmo repo | `pull_request`, fork ou AGit | `pull_request_target`, mesmo repo | `pull_request_target`, fork ou AGit |
|---|---|---|---|---|
| Origem do YAML | head do PR | head, se o autor for confiável; base, se um usuário confiável disparar o evento; senão, head **com aprovação** | **branch base do PR** (qualquer branch, não só a default) | branch base do PR |
| Checkout padrão (`github.sha`/`ref`) | merge/head do PR | idem | base (`ref = refs/heads/<base>`, `sha = base.sha`) | base |
| Secrets do repo e da org | **todos** | nenhum | **todos** | **todos** |
| Token automático | escrita | leitura | escrita | leitura |
| OIDC (se pedido no YAML) | sim | **desligado** | sim | sim |
| Cache | escrita isolada em `refs/pull/…` | idem | **escrita sem isolamento** | **escrita sem isolamento** |
| Aprovação | nunca | se o autor não for confiável | **nunca** | **nunca** ([#13238](https://codeberg.org/forgejo/forgejo/issues/13238), aberta) |

Fontes por linha da tabela:
- **Origem do YAML:**
  - detecção em [`services/actions/notifier_helper.go` L257-310](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/notifier_helper.go#L257-L310). Os workflows `pull_request_target` vêm de `git.BranchPrefix + input.PullRequest.BaseBranch` e são acrescentados **antes** do laço de aprovação, que só marca os workflows do head (L289-295);
  - confiança em [`services/actions/trust.go` L69-100 e L203-227](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/trust.go#L69-L227). Um PR não-fork é "implicitly trusted". Em fork ou AGit, o autor é confiável se tiver escrita na unidade Actions ou trust explícito ("Approve always", que expira após 3 meses sem PR: [`models/actions/user.go` L90-97](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/actions/user.go#L90-L97)).
- **ref/sha:** [`services/actions/context.go` L28-44](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/context.go#L28-L44). A doc confirma: "the actions/checkout action will checkout the default branch instead of the content of the pull request" ([Reference, v17](https://forgejo.org/docs/v17.0/user/actions/reference/)).
- **Secrets:** [`secret.go` L41-46](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/secret.go#L41-L46).
- **Token:** [`repo_permission.go` L143-165](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/perm/access/repo_permission.go#L143-L165).
- **OIDC:** [`task.go` L179-204](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/task.go#L179-L204).
- **Cache:** [`runner.go` L194-230](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L194-L230). O cache interno é **um por processo de runner** (`artifactcache.StartHandler`, salvo `cache.external_server`) ([`runner.go` L91-150](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/run/runner.go#L91-L150); [`config.example.yaml` L79-133](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/pkg/config/config.example.yaml#L79-L133)).

Consequências (inferência):

1. **No mesmo repo, um `pull_request_target` com base controlada pelo machine user roda YAML dele.** Ele cria uma branch `x` com o workflow alterado e abre um PR com base `x`. O GitHub fixou o `pull_request_target` na branch default; o Forgejo não. Isso mostra que a proteção "YAML da base" só vale se **toda branch base possível** for confiável.
2. **Pushes feitos com o token automático não disparam workflows.** O `Notify` ignora doer `IsActions()`, exceto para recalcular schedules da branch default ([`notifier_helper.go` L135-150](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/notifier_helper.go#L135-L150)).
   - Porém o `POST …/actions/workflows/{file}/dispatches` exige só `reqRepoWriter(unit.TypeActions)` ([`routers/api/v1/api.go` L950-954](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/api/v1/api.go#L950-L954)), e o `Dispatch` não checa `IsActions` ([`services/actions/workflows.go` L147-163](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/workflows.go#L147-L163)).
   - **Inferência não testada:** um job de build com token de escrita (PR do mesmo repo) consegue disparar `workflow_dispatch` em qualquer ref.
3. **O token do job de deploy é só de leitura em PR AGit ou de fork,** mesmo no `pull_request_target`. Para comentar a URL do preview no PR, use uma **Authorized Integration** (v16+): ela troca o ID token por acesso à API em nome de um bot, com regras de claims (repo, arquivo de workflow, ref, evento) ([Authorized Integrations, v17](https://forgejo.org/docs/v17.0/user/api/authorized-integrations/); [`models/auth/authorized_integration.go`](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/auth/authorized_integration.go)). A alternativa é um token de bot guardado como secret.

---

## 4. Mecanismos candidatos: existem no Forgejo v16 e v17?

| Mecanismo | Existe? | Fonte / observação |
|---|---|---|
| Environments com regras de proteção e secrets por environment | **Não.** `environment:` é ignorado (seção 1) | jobparser; [Gitea comparison](https://docs.gitea.com/usage/actions/comparison/) |
| Secrets por workflow, branch ou job | **Não.** Os escopos são só dono e repo (`FetchActionSecrets`). A única forma de restringir por job é o mapeamento `secrets:` de reusable workflow (2.3) | [`models/secret/secret.go` L191-215](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/secret/secret.go#L191-L215) |
| `permissions:` para reduzir o token | **Não no Forgejo.** A Gitea tem: "`permissions` and `jobs.<job_id>.permissions` control the `GITEA_TOKEN` permissions" ([Gitea token permissions](https://docs.gitea.com/usage/actions/token-permissions/)). No Forgejo, pedido em [#13183](https://codeberg.org/forgejo/forgejo/issues/13183), aberta | seção 1 |
| Runner dedicado ao deploy, com credenciais locais (`runner.envs`, `env_file`, volume) | **Possível, mas o label é escolhido pelo YAML.** O servidor só filtra runner por escopo (instância, dono ou repo) e por labels (`ItRunsOn`). Não filtra por evento, ref ou workflow. O runner não tem filtro de tasks. Qualquer YAML que rode automaticamente com `runs-on: deploy` recebe as credenciais | [`models/actions/task.go` L310-354](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/actions/task.go#L310-L354); [`models/actions/run_job.go` L140-151](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/actions/run_job.go#L140-L151); grep no runner sem filtro de evento ou ref |
| Runner efêmero / `one-job --handle` | **Sim.** "Forgejo will assign a runner at most one job before removing it." O `forgejo-runner one-job --handle <h>` pega **só** o job com aquele handle (Forgejo ≥ 15) | [Securing…, v17](https://forgejo.org/docs/v17.0/admin/actions/security/); [`internal/app/cmd/cmd.go` L63-79](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/cmd/cmd.go#L63-L79); `IsRequestedByRunner` em [`run_job.go` L140-142](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/actions/run_job.go#L140-L142) |
| OIDC por job (`enable-openid-connect`) | **Sim** (ver detalhe abaixo da tabela) | — |
| Cloudflare ou Neon aceitam OIDC diretamente | **Não encontrado** (ver detalhe abaixo da tabela) | — |
| `container.network`, `privileged`, `docker_host`, `valid_volumes` | **Sim**, por runner (config do admin, não do YAML). O padrão é seguro: rede nova por job, sem socket, sem privileged | [`config.example.yaml` L192-223](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/pkg/config/config.example.yaml#L192-L223); [Securing…, v17](https://forgejo.org/docs/v17.0/admin/actions/security/) |
| "Require approval" para PRs do mesmo repo | **Não.** A aprovação só vale para fork e AGit sem confiança, e nunca para `pull_request_target` | [`trust.go` L203-212](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/trust.go#L203-L212); [Security of Pull Requests, v17](https://forgejo.org/docs/v17.0/user/actions/security-pull-request/) |
| Impedir o machine user de alterar `.forgejo/workflows/` (*protected file patterns*) | **Existe, mas inviável aqui** (ver detalhe abaixo da tabela) | — |
| Machine user só com leitura abrindo PRs via AGit | **Sim.** O pre-receive de `refs/for/*` exige só `CanRead(unit.TypePullRequests)`. A doc diz "no need for writing rights on the base repository" | [`hook_pre_receive.go` L114-133 e L539+](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/private/hook_pre_receive.go#L114-L133); [AGit, v17](https://forgejo.org/docs/v17.0/user/agit-support/) |
| `workflow_run` / artifacts entre runs | Não há `workflow_run`. A API REST de artifacts por run existe (`/actions/runs/{id}/artifacts`, `/actions/artifacts/{id}/zip`), mas o `download-artifact@v4` com `run-id` não funciona ([#8004](https://codeberg.org/forgejo/forgejo/issues/8004), aberta) | [`api.go` L926-948](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/api/v1/api.go#L926-L948) |

**Detalhe: OIDC por job (`enable-openid-connect`).**
- Por padrão, fica desligado (`evaluateEnableOpenIDConnect` → `false`, [`act/jobparser/jobparser.go` L325-338](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/jobparser/jobparser.go#L325-L338)).
- O escopo `generate_id_token:<run>:<job>` só entra no runtime token do job que pediu OIDC ([`services/actions/auth.go` L66-124](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/auth.go#L66-L124)). O endpoint recusa sem ele: "missing scp generate_id_token" ([`routers/api/actions/id_token.go` L104-109](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/api/actions/id_token.go#L104-L109)).
- **Inferência:** o job de build não consegue emitir um ID token do job de deploy.
- Endpoints:
  - issuer = `<AppURL>api/actions`;
  - JWKS = `<AppURL>api/actions/.well-known/keys`;
  - discovery em `/.well-known/openid-configuration` ([`routers/api/actions/oidc.go` L115-135](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/api/actions/oidc.go#L115-L135)).
- Validade padrão de 1 h (`ID_TOKEN_EXPIRATION_TIME`).
- Claims: `actor(_id)`, `base_ref`, `event_name`, `head_ref`, `ref`, `ref_protected` (sempre false), `ref_type`, `repository(_id)`, `repository_owner(_id)`, `run_*`, `sha`, `workflow`, `workflow_ref` = `owner/repo/<dir>/<arquivo>@<ref>`.
  - **Não há claim de job.**
  - `sub` = `repo:<owner>-<id>/<repo>-<id>:pull_request` ou `…:ref:<ref>` ([`auth.go` L33-52 e L164-173](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/auth.go#L33-L173); [`context.go` L44](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/context.go#L44); [Security OpenID Connect, v17](https://forgejo.org/docs/v17.0/user/actions/security-openid-connect/)).

**Detalhe: Cloudflare e Neon aceitam OIDC diretamente?**
- **Cloudflare:** não há federação OIDC para API tokens. A feature request da comunidade continua aberta em 2026 ([Community thread](https://community.cloudflare.com/t/openid-connect-authentication-for-cloudflare-api/492897)).
  - Um broker **de terceiros**, `cf-contrib/cf-oidc-auth` ("cloudflare-sts"), roda como Worker. Ele troca OIDC de "any issuer you list" por tokens Cloudflare com expiração. É "Pre-1.0" e **não** afiliado à Cloudflare; o Forgejo não é citado ([repo](https://github.com/cf-contrib/cf-oidc-auth), README v0.21.0, sem data).
  - Um broker próprio pode criar tokens via API com `expires_on`, `not_before` e `condition.request.ip`, usando um token pai com "Account > Account API Tokens > Edit" ([Create tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/), atualizada em 2026-09-28).
- **Neon:** a doc de API keys não menciona OIDC e diz "All keys remain valid until deliberately revoked". Não há campo de expiração ([Manage API keys](https://neon.com/docs/manage/api-keys)).

**Detalhe: por que *protected file patterns* é inviável aqui.**
- O pre-receive recusa push que altere arquivo protegido em branch casada por regra (`changedProtectedfiles` → "branch %s is protected from changing file %s"), inclusive para quem está na whitelist ([`routers/private/hook_pre_receive.go` L342-394](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/private/hook_pre_receive.go#L342-L394)).
- Na **criação** de branch, a comparação é com a árvore vazia ([`modules/git/diff.go` L406-416](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/modules/git/diff.go#L406-L416)). Criar uma branch via API também passa pelo hook, porque `CreateNewBranchFromCommit` faz `git.Push` com `PushingEnvironment` e não com o *internal*, e o hook só pula pushes internos ([`services/repository/branch.go` L343-358](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/repository/branch.go#L343-L358); [`cmd/hook.go` L175-178](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/cmd/hook.go#L175-L178)).
- **Inferência:** nenhuma branch protegida pode ser criada a partir de uma `main` que já contenha `.forgejo/workflows/*`. Branches fora da regra não têm proteção alguma. **Não testado.**

---

## 5. Orientação oficial e issues sobre o tema

- **Forgejo, admin:** a página "Securing Forgejo Actions Deployments" afirma:
  - "If Mallory can push directly to the repository, they can run arbitrary workflows";
  - os workflows `pull_request_target` "require careful engineering and review" e "do have access to secrets";
  - recomenda o registro mais restrito possível, runners efêmeros, a rede padrão isolada e evitar `privileged`.

  Não há recomendação explícita de separar runners confiáveis e não confiáveis ([v17](https://forgejo.org/docs/v17.0/admin/actions/security/)).
- **Forgejo, usuário:**
  - no `pull_request_target`, "Secrets that are used in action steps … may be available to environment inspection by untrusted code" e "The safest configuration is to not checkout the code of the pull request at all" ([Reference, v17](https://forgejo.org/docs/v17.0/user/actions/reference/));
  - "The safest option is to host your own runner, and use it only for your trusted repositories" ([Security, v17](https://forgejo.org/docs/v17.0/user/actions/security/)).
- **Issues relevantes:**
  - [#13238](https://codeberg.org/forgejo/forgejo/issues/13238), aberta: o `pull_request_target` roda sem aprovação;
  - [#13183](https://codeberg.org/forgejo/forgejo/issues/13183), aberta: não há como impedir o token de escrever;
  - [#7722](https://codeberg.org/forgejo/forgejo/issues/7722), aberta: `workflow_run`;
  - [#13769](https://codeberg.org/forgejo/forgejo/pulls/13769), fechado sem merge: `ref_protected`;
  - [#14864](https://codeberg.org/forgejo/forgejo/pulls/14864), merge em 2026-10-16: `CanAccessSecrets`;
  - [#13984](https://codeberg.org/forgejo/forgejo/pulls/13984), release de 2026-08-20: reusable workflow lido do head no `pull_request_target`;
  - [#14244](https://codeberg.org/forgejo/forgejo/issues/14244), fechada: só o **primeiro** diretório de workflows existente é lido, na ordem `.forgejo` > `.gitea` > `.github` ([`modules/actions/workflows.go` L62-86](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/modules/actions/workflows.go#L62-L86)).
- **Gitea (comparação, `main` `d0c35bc`):**
  - `GetSecretsOfTask` também entrega todos os secrets do dono e do repo. Só restringe em jobs chamados por reusable workflow (`getScopedSecretsForJob`) ([`models/secret/secret.go`](https://github.com/go-gitea/gitea/blob/d0c35bcd58b013e2fe40ee92e6d4f413dd438576/models/secret/secret.go));
  - tem `permissions:` ([docs](https://docs.gitea.com/usage/actions/token-permissions/)) e o evento `workflow_run` ([`modules/actions/github.go` L62](https://github.com/go-gitea/gitea/blob/d0c35bcd58b013e2fe40ee92e6d4f413dd438576/modules/actions/github.go#L62));
  - ignora `environment` ([comparison](https://docs.gitea.com/usage/actions/comparison/)).

  Ou seja, a Gitea resolve o token de escrita, mas não tem secrets por environment.

---

## 6. Desenhos propostos

Os três usam a mesma forma de YAML: **um `pull_request_target`, com um job `build` (código do PR, sem secrets) e um job `deploy` (só código da `main`)**. O Forgejo lê só `.forgejo/workflows` quando o diretório existe, e o GitHub ignora esse diretório. Então o template pode carregar `.github/workflows/pr-preview.yml` e `.forgejo/workflows/pr-preview.yml` com diferenças mínimas, só no job de deploy.

### Esboço comum (não testado)

```yaml
# .forgejo/workflows/pr-preview.yml — YAML sempre lido da branch base do PR
on:
  pull_request_target:
    types: [opened, synchronize, reopened]
jobs:
  build:
    # Reusable local, SEM runs-on e SEM `secrets:` → o servidor não envia secrets ao job interno (seção 2.3).
    uses: ./.forgejo/workflows/pr-build.yml
  deploy:
    needs: build
    if: github.base_ref == 'main'      # cosmético; quem garante é o broker ou o fato de não haver outras bases confiáveis
    runs-on: deploy                    # runner separado (ver cada desenho)
    enable-openid-connect: true        # só no desenho B/C
    steps:
      - uses: actions/checkout@v4      # sem ref → base (main)
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v3   # ou v4 com patch do Forgejo
        with: { name: preview-bundle, path: ${{ runner.temp }}/pr }
      - run: node scripts/preview-deploy.mjs "$RUNNER_TEMP/pr"   # script da main; NUNCA interpolar needs.build.outputs em run:
---
# .forgejo/workflows/pr-build.yml
on: workflow_call
jobs:
  build:
    runs-on: untrusted                 # runner sem credenciais, cache próprio ou desligado
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - run: pnpm install --frozen-lockfile && pnpm build && pnpm test   # código do PR
      - uses: actions/upload-artifact@v3
        with: { name: preview-bundle, path: out/ }
```

### Desenho A: AGit + reusable sem secrets + secrets do Forgejo só no deploy

Forgejo-nativo, sem broker.

- **Configurar:**
  1. **Machine user só com leitura** no repo, sem escrita nem unidade Actions em escrita. A Factory abre e atualiza PRs com `git push origin HEAD:refs/for/main/<topic> -o title=… -o description={base64}… -o force-push=true` ([AGit, v17](https://forgejo.org/docs/v17.0/user/agit-support/)). PR via fork do machine user também serve.
  2. **Confiança:** deixe o machine user **sem** "Approve always". Os `pull_request` do head ficam pendentes de aprovação humana e só o `pull_request_target`, com YAML da base, roda automaticamente. Com "Approve always", os workflows do head rodam sem secrets e com token de leitura, mas podem escolher `runs-on: deploy` (ver risco 3).
  3. **Secrets Cloudflare e Neon** como secrets do **repo**, referenciados só no job `deploy`. Nenhum secret no nível da org que o build não deva receber, embora pela seção 2.3 ele não receba nenhum.
  4. **Dois runners**, registrados **no repositório** (o escopo mais restrito):
     - `untrusted`: roda o build, com cache desligado (`cache.enabled: false`) ou isolado;
     - `deploy`: em outro host ou VM, de preferência efêmero (`one-job`), com `privileged: false` e `docker_host: "-"`.
  5. Proteger a `main` e **não manter outras branches de longa duração com workflows `pull_request_target`**: o machine user pode escolher qualquer branch como base.
- **Força:**
  - o machine user não consegue executar YAML próprio com secrets. Sem escrita, não há `push` nem `workflow_dispatch`, e o `pull_request` de AGit não recebe secrets ([`secret.go` L41-46](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/services/actions/secret.go#L41-L46); [`pull.go` L478-488](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/issues/pull.go#L478-L488));
  - o build recebe só o token de **leitura** e nenhum secret;
  - o cache que o build envenena fica no runner `untrusted`.
- **Riscos que sobram:**
  1. secrets de longa duração no Forgejo, legíveis por qualquer humano com escrita;
  2. uma branch base antiga com `pull_request_target` roda o YAML dela;
  3. se alguém aprovar ou confiar nos workflows do head, eles podem mirar `runs-on: deploy` e tentar escapar do container para espionar deploys futuros. Um runner efêmero mitiga isso;
  4. o token do deploy é só de leitura: comentar no PR exige Authorized Integration ou token de bot.
- **Não testado:**
  - o fluxo AGit na Factory;
  - `needs:` e artifacts entre o job interno do reusable e o `deploy`;
  - o comportamento do `actions/checkout` v7 do GitHub ao fazer checkout do head AGit em `pull_request_target`, que pode exigir `allow-unsafe-pr-checkout: true`;
  - se o pre-receive aceita, como esperado, push AGit de usuário com só leitura via HTTPS e SSH.

### Desenho B: A + credenciais fora do Forgejo, via OIDC e broker

O mais forte.

- **Configurar:** tudo do A, menos os secrets Cloudflare e Neon no Forgejo. Mais:
  1. `enable-openid-connect: true` **só** no job `deploy`. O step pede `"$ACTIONS_ID_TOKEN_REQUEST_URL&audience=<url-do-broker>"` com `Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN`.
  2. **Broker**, por exemplo um Worker próprio ou o `cf-oidc-auth` (de terceiros, pre-1.0, Forgejo não testado). Ele valida a assinatura via JWKS de `<forgejo>/api/actions/.well-known/keys` e os claims:
     - `iss` = `<forgejo>/api/actions`, `aud` = broker;
     - `repository_id` e `repository_owner_id`, porque IDs não mudam com renomeação;
     - `event_name == "pull_request_target"`, `ref == "refs/heads/main"`, `base_ref == "main"`;
     - `workflow_ref == "<owner>/<repo>/.forgejo/workflows/pr-preview.yml@refs/heads/main"`;
     - **não** confiar em `ref_protected`, que é sempre false.
  3. **O que o broker devolve:**
     - **Cloudflare:** um token criado na hora, com papel Editor só no Worker `app`, `expires_on` de ~15 min e, se possível, `condition.request.ip` = IP de saída do runner `deploy`. O broker guarda o token pai "Account API Tokens Edit", que é poderoso: proteger o Worker do broker.
     - **Neon:** não há token efêmero. O broker deve **executar ele mesmo** as operações (criar ou resetar o branch `preview/pr-N`, devolver a URL só desse branch, apagar ao fechar) com uma key project-scoped que nunca sai dele.
  4. **Portabilidade:** o mesmo broker aceita o issuer do GitHub, com o job de deploy usando `permissions: id-token: write`. Assim, as duas forjas guardam credenciais no mesmo lugar, o broker. Os claims do GitHub não foram verificados nesta pesquisa.
- **Força:**
  - nenhuma credencial de deploy existe no Forgejo ou nos runners;
  - o job de build não tem o escopo `generate_id_token`;
  - um YAML vindo de outra base, de `push` ou de `workflow_dispatch` produz claims rejeitados;
  - um runner comprometido rende no máximo um token de 15 min, e só durante um deploy legítimo.
- **Riscos que sobram:**
  - o broker vira o alvo;
  - qualquer step do job de deploy pode pedir ID tokens. Manter o job mínimo e com dependências da `main`.
- **Não testado:**
  - interoperabilidade do JWKS do Forgejo com o broker escolhido;
  - criação de token Cloudflare por Worker via API;
  - o fluxo inteiro.

### Desenho C: branches no mesmo repo (como hoje) + broker OIDC obrigatório

A menor mudança na Factory.

- **Configurar:** a Factory continua criando branches com escrita. Valem os passos do broker do desenho B, e **nenhum** secret de valor fica no Forgejo. O build continua no reusable sem secrets e em runner separado.
- **Por que o broker é obrigatório aqui:** com escrita, o machine user roda qualquer YAML com todos os secrets do Forgejo, seja por `on: push` numa branch nova, seja por `pull_request_target` contra uma base que ele criou. O broker barra porque `ref` e `workflow_ref` não batem com a `main`.
- **Riscos que sobram:**
  1. o job de build tem **token de escrita**. Ele pode empurrar para branches não protegidas, mexer em issues e releases e, por inferência, disparar `workflow_dispatch` ([`api.go` L952](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/api/v1/api.go#L952));
  2. o build em `pull_request_target` grava no cache sem isolamento. Use runners e caches separados e nenhum cache em workflows privilegiados;
  3. **qualquer outro secret** do repo ou da org, como chaves da própria Factory, fica legível pelo machine user;
  4. Authorized Integrations e qualquer automação baseada em claims precisam do mesmo cuidado com `ref`.
- **Não testado:** tudo o que vale para o B, mais o comportamento do token de escrita do build contra a `main` protegida. Pelo código, o usuário Actions não está na whitelist e não deveria conseguir push ([`models/git/protected_branch.go` L118-151](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/models/git/protected_branch.go#L118-L151)).

### Ranking

| Desenho | Simplicidade | Força | Infraestrutura nova | Mudança na Factory |
|---|---|---|---|---|
| **A** | Alta | Boa (equivale ao GitHub com environment) | 2 runners | Abrir PR via AGit ou fork |
| **B** | Média | **A maior** | 2 runners + broker | AGit ou fork |
| **C** | Média | Aceitável, com riscos residuais | 2 runners + broker | Nenhuma |

### Descartados

- **Só labels de runner com credenciais locais, no desenho atual:** qualquer workflow do machine user pode usar `runs-on: deploy` (seção 4).
- ***Protected file patterns***: bloqueiam a criação de branches (seção 4).
- **`permissions:` e `environment:`**: ignorados.
- **"Despachante" que inspeciona jobs pendentes via `GET /repos/{o}/{r}/actions/runners/jobs` e sobe um `forgejo-runner one-job --handle <h>` com credenciais só para jobs aprovados:** viável pelo código ([`api.go` L562-570](https://codeberg.org/forgejo/forgejo/src/tag/v17.0.0/routers/api/v1/api.go#L562-L570); [`cmd.go` L63-79](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/app/cmd/cmd.go#L63-L79)), mas valida por metadados de API em vez de assinatura. É mais complexo que o broker e não foi testado.

---

## Pontos incertos ou não testados

1. **Não rodei nada numa instância.** Todas as conclusões vêm de leitura de código (v16.0.6, v17.0.0 e runner v13.2.0) e da doc.
2. A "inalcançabilidade" dos secrets não referenciados num container padrão é **inferência**: não há envio ao env nem gravação em disco no código. Ela depende de não haver fuga de container nem config insegura (`host`, `privileged`, socket Docker).
3. O reusable workflow sem `secrets:` zerando os secrets do job interno está no código. Faltam testar `needs:` e os artifacts entre o job interno e o `deploy`, e a versão mínima (≥ v16.0.3, pela correção de 2026-08-20).
4. AGit com machine user só de leitura:
   - o push HTTPS/SSH e as opções `-o` com descrição em base64 precisam de teste;
   - o `actions/checkout` v7 do GitHub pode bloquear o checkout do head em `pull_request_target`.
5. Divergências entre doc e código:
   - **`ref_protected`**: sempre false no código; a doc diz o contrário;
   - **token do `pull_request`**: a doc diz leitura; o código dá escrita para PR do mesmo repo.
6. O disparo de `workflow_dispatch` com o token automático de escrita é inferência: a rota exige só escrita em Actions e não há checagem de doer Actions.
7. A criação de branch em regra com *protected file patterns* ser recusada por comparar com a árvore vazia é inferência, não testada.
8. **Cloudflare:**
   - não há OIDC nativo; o broker `cf-oidc-auth` é de terceiros, pre-1.0, e não cita o Forgejo;
   - o papel exigido por `wrangler preview` continua não documentado (ver pesquisa 19, 3.1).
9. **Neon:** não há OIDC nem key com expiração. O broker precisa executar as operações em vez de repassar a key.
10. A branch `v17.0/forgejo` (#14864) muda a regra de secrets para `CanAccessSecrets`. O efeito para este desenho é o mesmo, mas a release v17.0.1 ainda não saiu em 2026-10-18.
