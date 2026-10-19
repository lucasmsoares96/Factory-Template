# Runner próprio no repo privado

Ticket: [32-self-hosted-runner](../issues/32-self-hosted-runner.md)
Pesquisado em: 2026-10-19

Versões e datas consultadas:
- GitHub Docs (páginas sem data, lidas em 2026-10-19): [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Self-hosted runners (conceito)](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners), [Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners), [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use), [Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners), [Configuring the application as a service](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application), [Apply labels](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/apply-labels), [Run scripts](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts), [Choose the runner for a job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job), [Run jobs in a container](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container), [Contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts), [Expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions), [Use variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables), [Dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching), [Actions limits](https://docs.github.com/en/actions/reference/limits), [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [ARC (conceito)](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller), [Deploy runner scale sets](https://docs.github.com/en/actions/tutorials/use-actions-runner-controller/deploy-runner-scale-sets), [Managing Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).
- REST: [Self-hosted runners](https://docs.github.com/en/rest/actions/self-hosted-runners) (`X-GitHub-Api-Version: 2026-03-10`) e [Permissions for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
- Changelog/blog: [Update to GitHub Actions pricing](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/) (2025-12-16, com nota de adiamento sem data), [Pricing changes for GitHub Actions](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) (2025-12-15), [roadmap#1197](https://github.com/github/roadmap/issues/1197) (fechada em 2025-12-19), [Reduced pricing for GitHub-hosted runners](https://github.blog/changelog/2026-01-01-reduced-pricing-for-github-hosted-runners-usage/) (2026-01-01), [Função `case`](https://github.blog/changelog/2026-01-29-github-actions-smarter-editing-clearer-debugging-and-a-new-case-function/) (2026-01-29), [Minimum version enforcement extended](https://github.blog/changelog/2026-02-05-github-actions-self-hosted-runner-minimum-version-enforcement-extended/) (2026-02-05, nota de 2026-02-20), [Version enforcement date has moved](https://github.blog/changelog/2026-09-28-self-hosted-runner-version-enforcement-date-has-moved/) (2026-09-28).
- Código: `actions/runner` **v2.338.0** (2026-10-06; lido em `main`, push de 2026-10-19): `images/Dockerfile`, `docs/automate.md`, `docs/adrs/2494-runner-image-tags.md`, `src/Runner.Worker/Container/ContainerInfo.cs`, `src/Runner.Worker/ContainerOperationProvider.cs`, `src/Runner.Worker/JobExtension.cs`, `src/Runner.Listener/Runner.cs`. ARC **gha-runner-scale-set-0.15.0** (2026-10-01). `actions/runner-images`: Ubuntu 24.04 image **20261012.334.1**.
- Docker: [Docker Engine security](https://docs.docker.com/engine/security/) e [Docker Hub usage](https://docs.docker.com/docker-hub/usage/) (sem data).
- Forgejo **v17.0** docs: [Runner installation](https://forgejo.org/docs/latest/admin/actions/runner-installation/), [Configuration](https://forgejo.org/docs/latest/admin/actions/configuration/), [Security](https://forgejo.org/docs/latest/admin/actions/security/).

## Resposta

1. **Hoje o runner próprio é grátis e não gasta os 2.000 min do Free.** A cobrança de US$ 0,002/min para self-hosted em repo privado foi anunciada para 2026-03-01, adiada em dezembro de 2025 e nunca entrou em vigor. Não há data nova. Ela não foi cancelada formalmente, então pode voltar.
2. **Segurança:** a doc manda usar runner efêmero (um job por runner) e avisa que isso sozinho não basta: a máquina precisa voltar limpa. O ponto que pesa para a Factory é outro. **O job em `container:` recebe o `/var/run/docker.sock` do host** (código do runner). Numa máquina persistente, quem fala com esse socket vira root no host e alcança os jobs seguintes, inclusive o que tiver `FACTORY_TOKEN`.
3. **Consequência:** só os jobs que rodam dentro da imagem e não têm token de forja nem de nuvem vão para o runner próprio: o `work` (Factory e Triage) e o `build` do PR. `claim`, `publish`, `apply`, `deploy` e `image` ficam sempre no `ubuntu-latest`. O runner liga `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true`, que recusa job sem `container:`.
4. **Software mínimo:** Linux x64, Docker Engine, usuário `runner` com uid 1001 (igual ao hospedado e à imagem oficial), saída HTTPS 443 para os domínios do GitHub e do ghcr.io. Cache e artifacts continuam no GitHub, nos mesmos 10 GB e 500 MB. Pull do Docker Hub (o `postgres` do `services:`) passa a ter limite de 100 pulls/6 h por IP.
5. **`runs-on: ${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}` funciona:** `vars` é aceito em `runs-on`, variável ausente vale `''`, e `''` é falso. O runner ganha uma label própria (ex.: `factory`). A doc também tem a função `case` para o mesmo fim.
6. **Forma mínima:** a doc oficial não traz um script de loop efêmero. O caminho mais simples com Docker é uma VM dedicada com o runner no host, em loop com JIT config (`run.sh --jitconfig`) e limpeza a cada job. Um runner atende um job por vez, então N jobs simultâneos pedem N runners. O ARC exige Kubernetes e modo `dind` privilegiado.
7. **Template público:** fica no hospedado. A doc diz que self-hosted "should almost never be used for public repositories", e o hospedado padrão é grátis em repo público.

## Achados detalhados

### 1. Cobrança

**Estado atual (docs de billing):**
- "GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners" ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- A cota do plano é "a quota of free minutes, artifact storage, and cache storage for use with GitHub-hosted runners". Free: 2.000 min, 500 MB, 10 GB ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- A página conceitual repete: self-hosted runners "Are free to use with GitHub Actions, but you are responsible for the cost of maintaining your runner machines" ([Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)).
- A página de billing não cita nenhuma taxa de plataforma para self-hosted.

**A taxa anunciada e adiada:**
- Anúncio de 2025-12-16: "On March 1, 2026, GitHub will introduce a new $0.002 per minute GitHub Actions cloud platform charge" para "self-hosted runner usage". "Any usage subject to this charge will count toward the minutes included in your plan." Valeria para "Jobs that run in private repositories". "Runner usage in public repositories will remain free" ([changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)).
- Valeria para todos os planos, inclusive Free. O FAQ estimava que, entre pessoas físicas no Free e no Pro, "only 0.09% would end up with a price increase" ([changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/), [Pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)).
- Nota no topo do mesmo post, sem data: "We're postponing the announced billing change for self-hosted GitHub Actions to take time to re-evaluate our approach." A redução do hospedado seguiu ([changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)).
- A issue [roadmap#1197](https://github.com/github/roadmap/issues/1197) ("Self-hosted runner price increase") foi fechada como "not planned" em 2025-12-19, com a mesma frase de adiamento.
- O FAQ da página [Pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) ainda descreve a taxa de 1º de março como se valesse. Está desatualizado em relação à nota de adiamento no topo.
- A redução do hospedado entrou em 2026-01-01 ([changelog](https://github.blog/changelog/2026-01-01-reduced-pricing-for-github-hosted-runners-usage/)). Linux 2-core: US$ 0,006/min ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- **Não documentado:** nenhuma entrada do changelog até 2026-10-19 traz data nova para a taxa. Ela está adiada, não revogada. **Inferência:** a spec deve tratar o runner próprio como "grátis hoje", e o doc do runner deve citar o risco.

**Outros limites para self-hosted** ([Actions limits](https://docs.github.com/en/actions/reference/limits)):
- Job: "up to 5 days of execution time" (o hospedado tem 6 h).
- Fila: "A job can be in the queue for 24 hours before it is automatically cancelled."
- Os 20 jobs simultâneos aparecem só na tabela do hospedado. **Não documentado:** se valem para self-hosted.
- Registro: "1500 runners / 5 minutes"; 10.000 runners por grupo.

### 2. Segurança

**O que a doc recomenda** ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)):
- Self-hosted "can be persistently compromised by untrusted code in a workflow". O hospedado não, porque roda em VMs "ephemeral and clean isolated".
- Repo público: "self-hosted runners should almost never be used for public repositories on GitHub", porque qualquer um abre PR. A página de setup diz o mesmo: "We recommend that you only use self-hosted runners with private repositories" ([Add runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)).
- Repo privado: o risco vem de "anyone who can fork the repository and open a pull request (generally those with read access to the repository)". Essas pessoas podem chegar aos secrets e ao `GITHUB_TOKEN`.
- Ambiente: verificar o que há na máquina ("private SSH keys, API access tokens") e o que ela alcança na rede (serviços de metadados de nuvem). "any user capable of invoking workflows has access to this environment".
- Destruir o runner após o job "might not be as effective as intended", porque "there is no way to guarantee that a self-hosted runner only runs one job". Secrets em linha de comando aparecem para outro job no mesmo runner (`ps x -w`).
- Jobs podem se comprometer "interacting with the Docker socket and inspecting other running containers and executing commands in them".
- JIT: runners criados pela REST API "perform at most one job before being automatically removed". Mas "Re-using hardware to host JIT runners can risk exposing information from the environment"; a doc pede automação que garanta ambiente limpo.

**Efêmero** ([Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)):
- "GitHub recommends implementing autoscaling with ephemeral self-hosted runners"; "autoscaling with persistent self-hosted runners is not recommended".
- `./config.sh --url ... --token ... --ephemeral`. O GitHub vai "automatically de-register the runner after it has processed one job". A limpeza da máquina é automação sua.
- Os logs do runner efêmero "must be forwarded to an external log storage solution".
- No código, `--once` está a caminho da remoção: "Warning: '--once' is going to be deprecated in the future, please consider using '--ephemeral'" (`src/Runner.Listener/Runner.cs`, v2.338.0).

**Achado no código do runner: o job em container recebe o socket do Docker.**
- Em Linux, todo job container ganha `MountVolume("/var/run/docker.sock", "/var/run/docker.sock")` (`src/Runner.Worker/Container/ContainerInfo.cs`, `if (this.IsJobContainer)`). Container actions também (`ContainerActionHandler.cs`).
- A doc do Docker: "only trusted users should be allowed to control your Docker daemon"; o daemon "requires `root` privileges unless you opt-in to Rootless mode"; um container pode montar `/` do host e "alter your host filesystem without any restriction" ([Docker Engine security](https://docs.docker.com/engine/security/)).
- **Inferência:** com `USER 1001` na imagem e sem o grupo do socket dentro do container, o processo do agente não abre o socket (o socket do Docker costuma ser `root:docker` com modo 660). Isso depende de permissões do host, não de garantia documentada. Um job sem `container:` roda direto no host como o usuário do runner, que precisa do Docker, então tem o daemon na mão.
- Isso vale também no `ubuntu-latest`. Lá a VM é descartada no fim do job, e o `work` não tem token de forja ([Anatomia do job](../issues/16-factory-job-anatomy.md)). Numa máquina persistente, o efeito passa para os jobs seguintes.
- Mitigação documentada só no código e na doc do ARC: a variável `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER`. Com ela ligada, o runner recusa "Jobs without a job container are forbidden on this runner" (`src/Runner.Worker/JobExtension.cs`, `ValidateJobContainer`; [Deploy runner scale sets](https://docs.github.com/en/actions/tutorials/use-actions-runner-controller/deploy-runner-scale-sets)).

**Fork PRs em repo privado** ([Managing Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)):
- Há quatro opções em "Fork pull request workflows": rodar workflows de fork ("read-only permission, and with no access to secrets"), mandar token de escrita, mandar secrets, e exigir aprovação.
- **Não documentado:** o valor padrão. **Inferência:** num repo privado de conta pessoal, só colaboradores convidados conseguem fazer fork, então o risco "read access" da doc se resume a eles.

**O que muda para os jobs da Factory** (**Inferência**, a partir dos fatos acima e dos tickets [16](../issues/16-factory-job-anatomy.md), [19](../issues/19-pr-ci-security.md) e [25](../issues/25-harness-files.md)):
- O `work` roda código gerado por agente. No runner próprio, ele só é aceitável dentro do container da imagem, num runner efêmero e numa máquina sem nada sensível.
- O `publish` (com `FACTORY_TOKEN`) não pode cair numa máquina por onde passou um `work`. Do contrário, um `work` que plantou algo no host (ou no Docker do host) lê o token no job seguinte. A separação em três jobs do ticket 16 só vale se a máquina do `publish` for nova. Por isso `claim`, `publish`, `apply`, `deploy` e o job `image` (`packages: write`) ficam fixos no `ubuntu-latest`. São curtos e gastam poucos minutos.
- O `build` do PR em `pull_request_target` já roda sem secrets, com `contents: read` ([19](../issues/19-pr-ci-security.md)). No runner próprio, vale a mesma regra do `work`.
- A regra "diff que toca `.github/workflows/` → Escalation" ([16](../issues/16-factory-job-anatomy.md)) passa a proteger também a máquina. Um workflow num branch poderia pedir `runs-on: factory` e rodar no host. O `FACTORY_TOKEN` sem a permissão `workflows` impede isso.
- Um runner registrado no repo privado não atende o template público. Ele pertence só àquele repo ([Add runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)).

### 3. Compatibilidade

**O que o `ubuntu-latest` traz e o runner próprio não traz:**
- `ubuntu-latest` = Ubuntu 24.04, imagem 20261012.334.1, com Docker Client/Server 28.0.4, Docker Compose 2.38.2, Buildx 0.38.0, Git 2.55.0, Node 22.23.3 e PostgreSQL 16.15 (desligado) (`actions/runner-images`, `Ubuntu2404-Readme.md`).
- Hardware em repo privado: 2 CPU, 8 GB de RAM, 14 GB de SSD. O usuário tem `sudo` sem senha ([GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).
- No runner próprio: "you are responsible for updating the operating system and all other software" ([Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)).

**Requisitos da máquina** ([Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)):
- Linux: Ubuntu 20.04+, Debian 10+, RHEL 8+ e outros. Arquiteturas `x64`, `ARM64` (preview) e `ARM32`.
- `container:`, `services:` e container actions: "you must use a Linux machine and Docker must be installed."
- Rede: "outbound HTTPS connections over port 443", pelo menos 70 kbit/s. Domínios essenciais: `github.com`, `api.github.com`, `*.actions.githubusercontent.com`. Logs, artifacts e caches: `results-receiver.actions.githubusercontent.com` e `*.blob.core.windows.net`. Packages: `*.pkg.github.com`, `pkg-containers.githubusercontent.com`, `ghcr.io`.
- Atualização: com auto-update desligado, "you will be required to update your runner version within 30 days"; sem isso, o GitHub "will not queue jobs to your runner".
- Registro: versões abaixo de v2.329.0 não registram no GitHub.com ([changelog 2026-02-05](https://github.blog/changelog/2026-02-05-github-actions-self-hosted-runner-minimum-version-enforcement-extended/)). O post de [2026-09-28](https://github.blog/changelog/2026-09-28-self-hosted-runner-version-enforcement-date-has-moved/) fala de enforcement no "GitHub Enterprise Cloud" e de um mínimo de execução maior, sem número. **Não documentado:** se a contagem desse post vale para contas Free. A última versão é v2.338.0 (2026-10-06).

**Item a item da Factory:**
- **Docker para `services: postgres` e `container: image`:** Docker Engine no host é obrigatório (acima). O runner cria uma rede por job, "to avoid port conflict when multiple runners run on same machine" (`ContainerOperationProvider.cs`), então dois jobs na mesma máquina não brigam pela porta do Postgres.
- **Pull a cada job:** o runner faz `docker pull` da imagem do job e dos services toda vez, com 3 tentativas (`ContainerOperationProvider.cs`).
  - Docker Hub: "Docker Hub normally imposes rate limits [...] which will affect jobs on self-hosted runners", e o hospedado está isento ([Run jobs in a container](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container)).
  - Limite: 100 pulls por 6 h por IPv4 sem login, 200 com conta Personal ([Docker Hub usage](https://docs.docker.com/docker-hub/usage/)).
  - **Inferência:** com vários jobs por hora, o `postgres` do Docker Hub pode bater no limite. Saídas: `credentials:` no service com uma conta do Docker Hub, ou espelhar a imagem do Postgres no GHCR do repo.
- **GHCR com `packages: read`:** o runner gera um login temporário com as `credentials` antes do pull e o remove depois (`ContainerOperationProvider.cs`). Só precisa alcançar `ghcr.io` e `pkg-containers.githubusercontent.com`. Nada muda no YAML do ticket 25.
- **uid 1001:**
  - O hospedado roda como `runner` uid 1001, dono do `/__w` ([25](../issues/25-harness-files.md)).
  - A imagem oficial do runner faz `adduser --disabled-password --gecos "" --uid 1001 runner` (`images/Dockerfile`).
  - O runner monta o `_work` do host em `/__w` dentro do job container (`ContainerInfo.cs`).
  - **Inferência:** se o usuário do runner no host tiver outro uid (o primeiro usuário do Ubuntu costuma ser 1000), o `USER 1001` da imagem não escreve em `/__w`. O doc do runner deve exigir o usuário `runner` com uid 1001 no host.
- **Cache e artifacts:** o tráfego de "logs, artifacts and caches" vai para `results-receiver.actions.githubusercontent.com` ([reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)). A página de cache não fala de self-hosted ([Dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)). **Inferência:** o cache e os artifacts continuam no GitHub e somam nos mesmos 10 GB e 500 MB do Free.
- **`setup-node` nos outros jobs:** não importa, porque esses jobs ficam no hospedado (seção 2).
- **Timeout:** o `timeout-minutes: 350` do ticket 16 cabe nos 5 dias do self-hosted. **Inferência:** manter igual, para o mesmo YAML rodar nos dois.
- **Fila:** sem runner livre com a label, o job "will remain queued until the 24 hour timeout period expires" ([reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)). **Inferência:** com o runner desligado, o `work` espera até 24 h, falha, e o `publish` (`if: always()`) abre a Escalation "infra".

**Labels e `runs-on` com expressão:**
- `runs-on` aceita "A single variable containing a string", arrays e `group`/`labels` ([Choose the runner](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)).
- A doc tem exemplo com variável de repo: `runs-on: ${{ vars.RUNNER }}` ([Use variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables)).
- Contextos aceitos em `jobs.<job_id>.runs-on`: `github, needs, strategy, matrix, vars, inputs`. Variável não definida: "the return value of a context referencing the variable will be an empty string" ([Contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)).
- `''` é falso: "falsy values (`false`, `0`, `-0`, `""`, `''`, `null`) are coerced to `false`" ([Expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)).
- **Não documentado:** a página de expressões não diz que `||` devolve o operando (e não um booleano). **Inferência:** `${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}` funciona, é o padrão de uso comum. A forma documentada é a função `case`, de 2026-01-29: `${{ case(vars.FACTORY_RUNNER != '', vars.FACTORY_RUNNER, 'ubuntu-latest') }}` ([Expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions), [changelog](https://github.blog/changelog/2026-01-29-github-actions-smarter-editing-clearer-debugging-and-a-new-case-function/)).
- Labels:
  - O runner recebe `self-hosted` por padrão; `--no-default-labels` tira ([Choose the runner](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)).
  - Label própria: `./config.sh ... --labels gpu`; "Labels are case-insensitive" ([Apply labels](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/apply-labels)).
  - Com array, o job vai para runners "that have all the labels that you specify".
  - **Inferência:** uma label única como `factory` cabe numa variável de string só. O runner com essa label pega o job, e nenhum runner hospedado tem esse nome.
- Grupos de runner são de organização. Numa conta pessoal, o runner é do repo e só o dono registra ("you must be the repository owner") ([Add runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)).

### 4. Forma mínima

**Opções oficiais, da mais simples à mais pesada:**

| Forma | Fonte | Efêmero | Docker para `container:`/`services:` | Observação |
| --- | --- | --- | --- | --- |
| Runner no host como serviço (`sudo ./svc.sh install && sudo ./svc.sh start`) | [Configure the application](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application), `docs/automate.md` | Não | Docker do host | Mais simples. Persistente, o que a doc desaconselha para código não confiável |
| Runner no host com `--ephemeral` ou JIT, em loop seu | [reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners), [Secure use](https://docs.github.com/en/actions/reference/security/secure-use) | Sim | Docker do host | A doc só diz "create your own automation that wipes the runner". Não há script oficial de loop |
| Imagem oficial `ghcr.io/actions/actions-runner:<versão>` num container | `images/Dockerfile`, ADR 2494, [ARC](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller) | Sim, um container por job | Precisa de DinD privilegiado ou do socket do host | Feita para o ARC. Uso fora do ARC não documentado |
| ARC (`gha-runner-scale-set` 0.15.0) | [ARC](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller), [Deploy runner scale sets](https://docs.github.com/en/actions/tutorials/use-actions-runner-controller/deploy-runner-scale-sets) | Sim, JIT | Modo `dind` (privilegiado) ou `kubernetes` (exige PVs) | Exige Kubernetes e Helm. Não aceita a label `self-hosted` |

**Detalhes:**
- `docs/automate.md` do `actions/runner` traz o script `create-latest-svc.sh` (baixa a última versão, pega token, configura e instala como serviço systemd). Ele exige um PAT em `RUNNER_CFG_PAT` e não roda em container: "Docker does not support `systemd` for service configuration on a container."
- **Token de registro:** `POST /repos/{owner}/{repo}/actions/runners/registration-token`, que "expires after one hour". **JIT:** `POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig` com `name`, `runner_group_id`, `labels` (1 a 100) e `work_folder`, devolve `encoded_jit_config`. Os dois exigem admin no repo ([REST](https://docs.github.com/en/rest/actions/self-hosted-runners)). Num PAT fine-grained: "Administration" com **write** ([permissões](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)).
- Uso: `./run.sh --jitconfig ${encoded_jit_config}` ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)). O runner efêmero sai sozinho após o job (`Runner.cs`).
- **Não documentado:** o `runner_group_id` de um repo de conta pessoal. **Inferência:** o grupo padrão, id 1.
- Hooks: `ACTIONS_RUNNER_HOOK_JOB_STARTED` e `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` rodam scripts antes e depois de cada job, por exemplo "cleaning out directories". O hook de fim roda antes do job terminar, então é "unsuitable for use cases that may interrupt a runner, such as deleting the runner machine" ([Run scripts](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts)).
- Em container efêmero, o auto-update baixa o runner de novo a cada versão. A doc sugere `--disableupdate` e atualizar a imagem por conta própria, dentro de 30 dias ([reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)).

**Quantos jobs simultâneos:**
- **Não documentado como regra geral.** A doc diz, para o efêmero, que "GitHub only assigns one job to a runner" ([reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)). O código prevê "multiple runners run on same machine" (`ContainerOperationProvider.cs`).
- **Inferência:** um processo de runner atende um job por vez. N jobs simultâneos pedem N runners (N diretórios e N registros) na mesma máquina ou em várias. Pelo tamanho do hospedado privado (2 CPU, 8 GB por job), uma máquina de 8 CPU e 32 GB comporta 3 ou 4 `work` ao mesmo tempo.
- A Factory não tem teto global de execuções ([16](../issues/16-factory-job-anatomy.md)). Com poucos runners, os jobs esperam na fila, e a fila tem limite de 24 h.

**Paralelo com o Forgejo Runner** (docs v17.0):
- Concorrência: `capacity`, padrão 1, no mesmo daemon ("With the defaults (3h timeout, capacity of 1)") ([Security](https://forgejo.org/docs/latest/admin/actions/security/)). No GitHub, cada job simultâneo é um processo de runner.
- Efêmero: `--ephemeral` no registro, "enforced by Forgejo and cannot be disabled", e só com `forgejo-runner one-job`. O `daemon` sai quando recebe o modo efêmero ([Security](https://forgejo.org/docs/latest/admin/actions/security/)). É o equivalente do `--ephemeral`/JIT do GitHub.
- Labels: `<label-name>:<label-type>://<default-image>`, tipos `docker`, `lxc` e `host`. O `host` não tem "isolation at all and a single job can permanently destroy the host" ([Configuration](https://forgejo.org/docs/latest/admin/actions/configuration/)). No GitHub, a label é só um nome; o isolamento vem do `container:` no YAML.
- Aviso geral: "Forgejo Runner performs remote code execution" ([Runner installation](https://forgejo.org/docs/latest/admin/actions/runner-installation/)).
- **Inferência:** a mesma VM pode hospedar o Forgejo Runner do usuário e os runners do GitHub, com Docker compartilhado. Isso mistura dois níveis de confiança no mesmo daemon. Melhor uma VM para cada, ou ao menos runners efêmeros nos dois.

## Recomendação para a spec da base

Tudo aqui é **Inferência** a partir dos achados acima.

**No template (público e privado):**
- `runs-on: ${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}` só nos jobs com `container:` da imagem e sem token de forja ou de nuvem: o `work` da Factory, o `work` da Triage e o `build` do CI do PR. Os demais jobs ficam com `ubuntu-latest` fixo.
- Um teste do harness falha se um job com `FACTORY_RUNNER` não tiver `container:` ou receber secret fora da allowlist (só a auth do Claude no `work`). Estende o teste do `FACTORY_TOKEN` do ticket 25.
- O template público nunca define a variável. O bootstrap não cria runner.

**Doc do runner próprio** (para o humano, no repo):
- Máquina ou VM dedicada, Linux x64, sem chaves, tokens ou montagens sensíveis, e sem acesso à rede local.
- Docker Engine; usuário `runner` com uid 1001; runner na versão atual (≥ v2.329.0 para registrar; atualizar em até 30 dias).
- `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true` no `.env` do runner.
- Label `factory` e `FACTORY_RUNNER=factory` nas variáveis do repo.
- Efêmero: loop que pede JIT config com um PAT fine-grained (Administration: write, só aquele repo, guardado fora dos jobs), roda `./run.sh --jitconfig`, e depois limpa o `_work` e os containers, volumes e redes do Docker. Restaurar um snapshot da VM é o mais seguro.
- Um runner por job simultâneo.
- `postgres` com login no Docker Hub ou espelhado no GHCR.
- Logs do runner enviados para fora da máquina.
- Aviso: a taxa de US$ 0,002/min está só adiada.

**Critério de aceite da base:** rodar o `work` e o `build` num runner próprio efêmero com uid 1001 e conferir checkout, Postgres por `services:` e o pull do GHCR.

## Lacunas

- Se e quando a taxa de plataforma para self-hosted volta. O GitHub não deu data nova.
- Se o limite de 20 jobs simultâneos do Free vale para self-hosted.
- O valor padrão das opções de "Fork pull request workflows" em repo privado de conta pessoal.
- Se o `||` em expressões devolve o operando. Funciona na prática, mas a página não diz. A `case` é a forma documentada.
- O `runner_group_id` para JIT num repo de conta pessoal.
- Se o enforcement de versão do post de 2026-09-28 (escrito para Enterprise Cloud) já vale para contas Free.
- O uso da imagem `ghcr.io/actions/actions-runner` fora do ARC, com jobs em container. Não há doc oficial.
