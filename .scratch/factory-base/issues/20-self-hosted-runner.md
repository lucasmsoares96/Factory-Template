# 20: Runner próprio

Spec: [../spec.md](../spec.md)

**What to build:** o dono de um repo privado monta um runner próprio seguindo um doc, aponta `vars.FACTORY_RUNNER` para ele, e o `work` da Factory e o `build` do PR passam a rodar lá sem tocar em nenhum token de forja ou de nuvem.

**Blocked by:** 16

**Status:** ready-for-agent

- [x] Doc para o humano: VM dedicada Linux x64 com Docker Engine, sem segredos e sem acesso à rede local; usuário `runner` uid 1001; runner ≥ v2.329.0; loop efêmero por JIT config com limpeza do `_work` e do Docker; `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true`; label `factory`; login ou espelho para a imagem `postgres`; um runner por job simultâneo.
- [x] O template público nunca define a variável, e o bootstrap não cria runner.
- [ ] Critério medido e registrado aqui: `work` e `build` rodando num runner efêmero com uid 1001. A VM e o runner de teste são desmontados no fim, se não forem ficar.

## Comments

- Doc: `docs/self-hosted-runner.md`, linked from `AGENTS.md`; tests: `.factory/test/self-hosted-runner.test.ts` (no value for the variable besides the `|| 'ubuntu-latest'` fallback, no runner in bootstrap/scripts, doc names the settings) plus the existing takers test in `ci-workflows.test.ts` (only `work` and the two `build` jobs). No triage/pr-feedback/update-branch workflow exists on factory-base yet.
- Versions checked 2026-10-20: actions/runner v2.338.0 (2026-10-06, `actions-runner-linux-x64-2.338.0.tar.gz`); minimum registrable v2.329.0; JIT REST `POST /repos/{o}/{r}/actions/runners/generate-jitconfig` (name, runner_group_id, labels required; API version 2026-03-10; needs repo admin, no fine-grained permission listed). `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER` is documented only in the ARC page (Kubernetes mode, as `false` to disable); its use on a plain Linux runner rests on the runner source (`JobExtension.ValidateJobContainer`, research 32).
- Deviation: JIT config is minted on a trusted machine and piped over SSH, so the VM holds no token. The loop and `run-one.sh` in the doc are untested on a real VM.
- Pending (human): measured criterion. Provision a Linux x64 VM per the doc, start the loop, set `FACTORY_RUNNER=factory`, run one Factory issue and one PR, confirm `id -u` is 1001 in `work` and `build`, the runner is removed, `docker ps -a` and `_work` are empty, and `claim`/`publish`/`deploy` ran on `ubuntu-latest`; then record here and tear the VM down if not kept.


Merge (2026-10-21): na `factory-base`; `verify` completo verde duas vezes. Falta a medição numa VM real.
