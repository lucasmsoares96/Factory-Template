# 20: Runner próprio

Spec: [../spec.md](../spec.md)

**What to build:** o dono de um repo privado monta um runner próprio seguindo um doc, aponta `vars.FACTORY_RUNNER` para ele, e o `work` da Factory e o `build` do PR passam a rodar lá sem tocar em nenhum token de forja ou de nuvem.

**Blocked by:** 16

**Status:** ready-for-agent

- [ ] Doc para o humano: VM dedicada Linux x64 com Docker Engine, sem segredos e sem acesso à rede local; usuário `runner` uid 1001; runner ≥ v2.329.0; loop efêmero por JIT config com limpeza do `_work` e do Docker; `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER=true`; label `factory`; login ou espelho para a imagem `postgres`; um runner por job simultâneo.
- [ ] O template público nunca define a variável, e o bootstrap não cria runner.
- [ ] Critério medido e registrado aqui: `work` e `build` rodando num runner efêmero com uid 1001. A VM e o runner de teste são desmontados no fim, se não forem ficar.
