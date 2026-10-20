# 04: Retro de volta ao Template

Spec: [../spec.md](../spec.md)

**What to build:** um mantenedor roda `/retro` sobre uma Escalation ou sobre um PR em que achou algo no Merge Gate, e a skill encontra sozinha as fontes primárias do run. A skill `retro` volta vendorada do Matt sem alteração, e um doc em `docs/agents/` diz onde estão os logs de cada run e sobre quais runs rodar.

**Blocked by:** None (can start immediately). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md) e do [ticket 22 da base](../../factory-base/issues/22-forgejo-install-prompt.md), que leva as skills.

**Status:** ready-for-agent

Os caminhos são protegidos pelo `.claude/settings.json`, mas o usuário autorizou (2026-10-20) o agente a reinstalar a skill, como fez com os workflows do ticket 12 da base.

- [ ] `retro` instalado das skills do Matt, no `skills-lock.json`, em `.agents/skills/` e com o link em `.claude/skills/`.
- [ ] A lista de skills do Matt no teste de arquivos do harness inclui `retro` (seam 2).
- [ ] A seção de skills do `AGENTS.md` lista `retro` entre as skills para humanos.
- [ ] Doc em `docs/agents/`: o artifact `stream-json` do workflow run linkado no comentário de Escalation ou no PR, baixado com `gh run download`; num run local, os `.jsonl` do diretório de sessões; as threads e reviews do PR, onde ficam os achados humanos; rodar sobre Escalations e sobre PRs com achado humano no Merge Gate.
- [ ] Teste de arquivos do harness: o doc existe (seam 2).
- [ ] `pnpm factory:verify` verde.
