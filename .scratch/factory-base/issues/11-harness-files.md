# 11: Arquivos de harness

Spec: [../spec.md](../spec.md)

**What to build:** um agente que abre o repo (o Claude Code local ou a Factory) encontra as instruções, as skills e as travas certas: `AGENTS.md` em cada nível, só as skills que o Template usa, MCPs sem segredo e um `.claude/settings.json` que bloqueia os caminhos protegidos e os comandos git perigosos.

**Blocked by:** 07, 10

**Status:** ready-for-agent

- [ ] `AGENTS.md` (inglês, < 200 linhas) na raiz, no Skeleton, no molde do Product e em `.factory/`, com o conteúdo da spec; nenhum `CLAUDE.md`; sem nome de repo fixo.
- [ ] Skills em `.agents/skills` com `.claude/skills/<x>` por symlink: as 18 do Matt da lista decidida, `playwright-cli` e `workers-best-practices` fixadas no `skills-lock.json`; as outras saem.
- [ ] Skills próprias `skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-add-feature` e `skeleton-evidence-test` (com a regra de localizar por role + chave do i18n), fora do lock.
- [ ] `.mcp.json` com `cloudflare-docs` e `shadcn`; `cloudflare-api` e `neon` read-only documentados como `claude mcp add --scope local`.
- [ ] `.claude/settings.json` com `deny` de `Edit`/`Write` nos caminhos protegidos e de `Bash(pnpm bootstrap destroy:*)`, e hook `PreToolUse` do `git-guardrails`; sem `allow`, `env` ou subagents.
- [ ] `docs/agents/issue-tracker.md` sem repo fixo; `triage-labels.md` com a tabela "Factory labels" (`in-progress`, `agent:explore`, `harness-change`, `preview`, `product:<id>`).
- [ ] Testes estáticos: tabelas de labels iguais ao `config.ts`, `deny` presente (seam 2).
