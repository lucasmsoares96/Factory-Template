# Dynamic workflow headless no GitHub Actions

Type: research
Status: resolved

## Question

Um script do **Workflow** do Claude Code (dynamic workflow: `export const meta`, `agent()`, `pipeline()`, `phase()`) pode rodar de forma não interativa no GitHub Actions, via `anthropics/claude-code-action` ou `claude -p`? Como forçar paralelismo = 1, como passar a issue como `args`, como expressar o loop Exploration → Development → E2E → Review com retorno a Development e limite de 5 voltas, quais permissões/opt-in são necessários (a ferramenta exige opt-in explícito do usuário), e quais são as alternativas oficiais se não rodar headless (subagents em `.claude/agents`, Agent SDK, `claude-code-action` com prompt orquestrador)?

## Answer

Sim, roda headless via `claude -p` (ou Agent SDK) num step do Actions. Pelo `claude-code-action@v1` (v1.0.252) não roda: a action sai na primeira `result` message, que é a do turno de lançamento do workflow em background.
- Opt-in: a keyword `ultracode` não vale em `-p`. Vale o pedido explícito ("run the saved workflow factory-issue with args {...}"), somado à allow rule `Workflow(factory-issue)`. Workflows vêm ligados com API key (no plano Pro, desligados).
- Paralelismo = 1: `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=1` (CLI ≥ 2.1.269) e `await` sequencial no script. A issue entra como `args` JSON. O loop de 5 voltas é um `while` em JS com `agent(..., {schema: {passed, feedback}})`.
- Cuidados: `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, não usar `--bare`, CLI fixado, resume só na mesma sessão, limite de 6 h por job.
- Recomendação: Workflow via `claude -p` como motor, condicionado a um spike curto. O fallback é um orquestrador determinístico em TypeScript com o Agent SDK.

[pesquisa](../research/02-dynamic-workflow-headless.md)
