# Escolha do motor da Factory

Type: grilling
Status: claimed
Blocked by: 01, 02, 03

## Question

Com base nas pesquisas de Sandcastle em runner hospedado, dynamic workflow headless e gatilho/agendador, qual será o motor da Factory: Sandcastle, dynamic workflow (paralelismo = 1), ou outra alternativa oficial (ex.: `claude-code-action` com prompt orquestrador e subagents)? A decisão deve cobrir custo, confiabilidade, observabilidade, isolamento e esforço de manutenção para um template público.

Também decide a **identidade da Factory no GitHub**, que as pesquisas ligaram ao motor:
- PR criado com `GITHUB_TOKEN` deixa o CI esperando aprovação (pesquisas 01 e 03).
- O token da Claude App só vem de graça via `claude-code-action`, mas a pesquisa 02 diz que o Workflow não roda pela action, só via `claude -p`.
- `gh --attach` (prints nativos) recusa tokens de App e exige PAT/OAuth de usuário (pesquisa 04).
- O token da Claude App não consegue fazer push em `.github/workflows/` (pesquisa 03).

Opções: GitHub App própria (prints via branch órfão), PAT de machine user (prints via `--attach`), ou Claude App via action (se o motor rodar dentro dela).
