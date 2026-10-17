# Convenções de arquivos de harness

Type: research
Status: resolved

## Question

Quais são as convenções oficiais atuais para os arquivos de harness de agentes: `AGENTS.md` na raiz e em subdiretórios (spec agents.md, como Claude Code e Codex leem e combinam; Claude Code lê `AGENTS.md` nativamente ou precisa de `CLAUDE.md` com import?), skills (`.claude/skills` vs `.agents/skills`, formato SKILL.md), subagents (`.claude/agents`), `.mcp.json` de projeto, `.claude/settings.json` (permissões, hooks) e como tudo isso é carregado pelo `claude-code-action` no CI? Quais **MCPs oficiais** ajudam a Factory a desenvolver nesta stack (Cloudflare docs/bindings/observability, Neon, Playwright, shadcn, Context7 etc.), com URLs, autenticação e se funcionam headless no CI?

## Answer

- Claude Code (v2.1.277+; a `claude-code-action` v1.0.252 instala a 2.1.302) lê `AGENTS.md` nativamente **só se não houver nenhum `CLAUDE.md`/`CLAUDE.local.md`**. Os de subdiretório carregam sob demanda, quando o Claude usa a ferramenta Read. Logo: nenhum CLAUDE.md, `AGENTS.md` na raiz e por pacote. O Codex só lê AGENTS.md da raiz até o cwd.
- Skills: o Claude lê só `.claude/skills`, e o Codex só `.agents/skills`. É preciso manter as duas (já é assim, via `npx skills`). Subagents (`.claude/agents`) e hooks são só do Claude.
- No CI (`-p`/SDK, pasta nunca trusted), o `permissions.allow` do `.claude/settings.json` é ignorado. Hooks, `deny` e `.mcp.json` valem. A allowlist vai no input `settings:` (vira user settings) ou em `--allowedTools`.
- MCP com OAuth não roda headless. No CI, use Bearer token via `${VAR}`.
- MCPs recomendados: Cloudflare Docs (sem auth), Context7, shadcn (stdio), Cloudflare API `mcp.cloudflare.com` (token read-only) e Neon (`readonly` + `projectId`). Bindings e Observability da Cloudflare estão depreciados. Para o E2E, prefira Playwright CLI + skill em vez do MCP.
- Risco principal: a action restaura `.claude/`, `.mcp.json` e `CLAUDE.md` da base em PRs, mas **não** o `AGENTS.md`. Também falta testar no CI que o AGENTS.md carregou.

[pesquisa](../research/09-harness-conventions.md)
