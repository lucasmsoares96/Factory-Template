# Runner próprio no repo privado

Type: research
Status: resolved

## Question

Em [Vários produtos num repo só](30-multi-product-repo.md) ficou decidido que o template aceita um runner próprio por variável (`runs-on: ${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}`), com o hospedado como padrão, para fugir do teto de 2.000 min/mês do GitHub Free num repo privado ([Limites gratuitos com vários produtos](31-multi-product-free-limits.md)). Na documentação oficial mais recente (outubro de 2026), com versão e data:

- **Cobrança**: runner próprio num repo privado de conta Free gasta os 2.000 min ou é grátis? O estado atual da cobrança por minuto de plataforma para self-hosted anunciada pelo GitHub (valor, data de início, se foi adiada ou cancelada, se vale para o Free).
- **Segurança**: o que a documentação recomenda para runner próprio em repo privado (runner efêmero com `--ephemeral`, container, JIT config, um job por runner). O que muda para os jobs da Factory, que rodam código gerado por agente: o `work` sem token de forja e o `publish` com `FACTORY_TOKEN` ([Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md)), e o `build` do PR em `pull_request_target` ([Segurança do CI do PR com código da Factory](19-pr-ci-security.md)). Por que o GitHub desaconselha runner próprio em repo público, e o que isso significa para o template público, que fica no hospedado.
- **Compatibilidade**: o que a Factory usa no `ubuntu-latest` e falta num runner próprio (Docker para o Postgres de teste e para a imagem `ubuntu:24.04` do `work`, `container:` no job, cache, GHCR com `packages: read`, uid 1001 de [Lista final de arquivos de harness](25-harness-files.md)). Labels do runner e como `runs-on` aceita expressão com fallback.
- **Forma mínima**: o jeito mais simples e oficial de manter um runner efêmero numa máquina própria (script do `actions/runner` em loop, imagem oficial em container, ARC exige Kubernetes), e quantos jobs simultâneos ele aguenta. Paralelo com o runner do Forgejo que o usuário já tem ([Portabilidade GitHub → Forgejo](14-forgejo-portability.md)).

Resultado: se o runner próprio é de fato gratuito, os requisitos mínimos de segurança e de software para a Factory e o CI rodarem nele, e o que entra na spec da base.

## Answer

- **Hoje o runner próprio é grátis e não gasta os 2.000 min do Free** ("free for self-hosted runners"). A taxa de US$ 0,002/min para self-hosted em repo privado, anunciada para 2026-03-01 e válida também para o Free, foi adiada em dezembro de 2025. Não há data nova até 2026-10-19. Está adiada, não cancelada.
- **Risco principal: o job em `container:` recebe o `/var/run/docker.sock` do host** (código do `actions/runner`). Numa máquina persistente, quem controla o Docker vira root no host e alcança os jobs seguintes. A doc pede runner efêmero (um job, `--ephemeral` ou JIT) e máquina limpa a cada job, e diz que efêmero sozinho não basta.
- **Só vão para o runner próprio os jobs dentro da imagem e sem token de forja ou de nuvem:** o `work` (Factory e Triage) e o `build` do PR. `claim`, `publish`, `apply`, `deploy` e `image` ficam fixos no `ubuntu-latest`, para o `FACTORY_TOKEN` nunca passar por uma máquina onde rodou um `work`. O runner liga `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true`, que recusa job sem `container:`. Um teste do harness confere isso no YAML.
- **Requisitos da máquina:** VM dedicada, Linux x64, Docker Engine, sem segredos e sem acesso à rede local. Usuário `runner` com uid 1001, porque o `_work` do host vira `/__w` e a imagem roda como 1001. Runner ≥ v2.329.0, atualizado em até 30 dias. Saída 443 para GitHub e ghcr.io. Cache e artifacts continuam no GitHub (10 GB, 500 MB). O `postgres` do Docker Hub passa a ter limite de 100 pulls/6 h por IP: usar login ou espelhar no GHCR.
- **`runs-on: ${{ vars.FACTORY_RUNNER || 'ubuntu-latest' }}` funciona:** `vars` é aceito em `runs-on`, variável ausente vale `''`, e `''` é falso. O runner ganha a label `factory`. A forma documentada equivalente é `case(...)` (2026-01-29). Runner desligado = job na fila até 24 h, depois a Escalation "infra".
- **Forma mínima:** não há script oficial de loop efêmero. O mais simples é o runner no host da VM, em loop com JIT config (PAT fine-grained com Administration: write, guardado fora dos jobs), `./run.sh --jitconfig` e limpeza do `_work` e do Docker a cada job. Um runner atende um job por vez, então N jobs simultâneos pedem N runners. O ARC exige Kubernetes e `dind` privilegiado. No Forgejo, o equivalente é `capacity` + `--ephemeral` com `one-job`. Melhor não dividir a VM com o runner do Forgejo.
- **Template público fica no hospedado:** a doc diz que self-hosted "should almost never be used for public repositories", e o hospedado padrão é grátis em repo público. O template nunca define a variável, e o bootstrap não cria runner. Entra na spec um doc do runner próprio para o humano e um critério de aceite: rodar `work` e `build` num runner efêmero com uid 1001.

[pesquisa](../research/32-self-hosted-runner.md)
