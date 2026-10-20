# 04: Retro de volta ao Template

Spec: [../spec.md](../spec.md)

**What to build:** um mantenedor roda `/retro` sobre uma Escalation ou sobre um PR em que achou algo no Merge Gate, e a skill encontra sozinha as fontes primárias do run. A skill `retro` volta vendorada do Matt sem alteração, e um doc em `docs/agents/` diz onde estão os logs de cada run e sobre quais runs rodar.

**Blocked by:** None (can start immediately). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md) e do [ticket 22 da base](../../factory-base/issues/22-forgejo-install-prompt.md), que leva as skills.

**Status:** done

Os caminhos são protegidos pelo `.claude/settings.json`, mas o usuário autorizou (2026-10-20) o agente a reinstalar a skill, como fez com os workflows do ticket 12 da base.

- [x] `retro` instalado das skills do Matt, no `skills-lock.json`, em `.agents/skills/` e com o link em `.claude/skills/`.
- [x] A lista de skills do Matt no teste de arquivos do harness inclui `retro` (seam 2).
- [x] A seção de skills do `AGENTS.md` lista `retro` entre as skills para humanos.
- [x] Doc em `docs/agents/`: o artifact `stream-json` do workflow run linkado no comentário de Escalation ou no PR, baixado com `gh run download`; num run local, os `.jsonl` do diretório de sessões; as threads e reviews do PR, onde ficam os achados humanos; rodar sobre Escalations e sobre PRs com achado humano no Merge Gate.
- [x] Teste de arquivos do harness: o doc existe (seam 2).
- [x] `pnpm factory:verify` verde.

## Comments

Feito em 2026-10-20. `retro` instalado com `npx skills@1.7.2 add mattpocock/skills --skill retro -a claude-code -y` (copiado para `.agents/skills/retro`, symlink em `.claude/skills/retro`, entrada no `skills-lock.json`); igual byte a byte à cópia que o repo tinha em `c64e819`. `skills experimental_install` a partir do lock restaura sem diferença e `node .factory/src/ci/skills.ts` confere os links. Doc: `docs/agents/retro-sources.md`.

Não rodei o `pnpm factory:verify` completo (máquina sobrecarregada; ordem do coordenador). Rodei só `vitest run test/harness-files.test.ts` (114 passam) e `pnpm --filter @factory/harness typecheck` (verde). O orquestrador roda o verify completo no merge; se verde, a Status passa a `done`.


Merge (2026-10-20): `TURBO_FORCE=1 pnpm factory:verify` verde na `factory-base` (12/12); `node .factory/src/ci/skills.ts` confere os symlinks, incluindo `.claude/skills/retro`.
