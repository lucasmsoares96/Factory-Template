# 16: Factory no Actions

Spec: [../spec.md](../spec.md)

**What to build:** com o módulo Factory configurado, uma issue do GitHub marcada `ready-for-agent` por quem tem `write`+ vira um PR do machine user, com review, evidência dos Products afetados e preview, sem o `FACTORY_TOKEN` jamais dividir a máquina com o agente.

**Blocked by:** 09, 10, 15

**Status:** ready-for-agent

- [ ] Módulo Factory: machine user com PAT clássico `repo` sem `workflow`, convite `write` aceito pelo wizard, conferência por `X-OAuth-Scopes` e recusa do mesmo login do dono; auth do Claude (`CLAUDE_CODE_OAUTH_TOKEN` recomendado ou `ANTHROPIC_API_KEY`, aviso se houver os dois); `FACTORY_ENABLED` ligado depois do `doctor`.
- [ ] Adaptadores GitHub de `Tracker` e `CodeHost` (REST por `fetch` + Zod; `gh` só no `--attach`; `done` = `closed`+`completed`).
- [ ] `factory-issue.yml` (`issues: labeled` + `workflow_dispatch`): `claim` (`GITHUB_TOKEN`) → `work` (imagem, `contents: read`, só a auth do Claude, `runs-on` aceita `vars.FACTORY_RUNNER`) → `publish` (VM nova, `FACTORY_TOKEN`, harness da `main`, `if: always()`), ligados por `git bundle` + `result.json` + prints; grupo `factory-N` com `cancel-in-progress: false`; `timeout-minutes: 350`.
- [ ] Evidência agrupada por Product no comentário único; `stream-json` como artifact por 14 dias; resumo no `$GITHUB_STEP_SUMMARY`.
- [ ] Testes estáticos do YAML: `work` sem `FACTORY_TOKEN` e só em `container:`; `claim` e `publish` não aceitam `vars.FACTORY_RUNNER` (seam 2).
- [ ] Testes do módulo contra os falsos: PAT do mesmo login recusado, aviso de duas auths (seam 8).
- [ ] Issue de exemplo opcional (padrão "não"); quando usada, ela, o PR, o branch e o preview são apagados no fim.
