# Escolha do motor da Factory

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

Com base nas pesquisas de Sandcastle em runner hospedado, dynamic workflow headless e gatilho/agendador, qual será o motor da Factory: Sandcastle, dynamic workflow (paralelismo = 1), ou outra alternativa oficial (ex.: `claude-code-action` com prompt orquestrador e subagents)? A decisão deve cobrir custo, confiabilidade, observabilidade, isolamento e esforço de manutenção para um template público.

Também decide a **identidade da Factory no GitHub**, que as pesquisas ligaram ao motor:
- PR criado com `GITHUB_TOKEN` deixa o CI esperando aprovação (pesquisas 01 e 03).
- O token da Claude App só vem de graça via `claude-code-action`, mas a pesquisa 02 diz que o Workflow não roda pela action, só via `claude -p`.
- `gh --attach` (prints nativos) recusa tokens de App e exige PAT/OAuth de usuário (pesquisa 04).
- O token da Claude App não consegue fazer push em `.github/workflows/` (pesquisa 03).

Opções: GitHub App própria (prints via branch órfão), PAT de machine user (prints via `--attach`), ou Claude App via action (se o motor rodar dentro dela).

## Progresso do grilling (rodada 1)

- Motor: **Sandcastle**, versão fixada. Sem fallback com Agent SDK (o usuário recusou). Provider de sandbox em discussão.
- Portabilidade confirmada como (a) mesmo com o Forgejo do usuário: implementar só GitHub; adaptador Forgejo vira o primeiro esforço pós-mapa.
- Auth do Claude no CI: aceitar `ANTHROPIC_API_KEY` **ou** `CLAUDE_CODE_OAUTH_TOKEN`; o wizard pergunta.
- Injeção de prompt: (1) o guard só aceita `ready-for-agent` aplicada por quem tem `write`+; (2) o job do agente não recebe secrets de nuvem (só a auth do Claude e o token da identidade). `docker()` com rede restrita → fora de escopo.
- E2E Stage e prints: stack local dentro do job (`createTestHarness`, Postgres em container, MSW); o smoke no preview roda depois, como CI do PR.
- Identidade: **machine user + access token** (`FACTORY_TOKEN`), escolhido por ser portável entre forjas (GitHub App não existe no Forgejo).
- Portabilidade: **projetado para migrar, implementado só para GitHub**. Toda operação de forja passa por um único módulo adaptador; o suporte real a Forgejo fica fora de escopo. A interface é validada pela pesquisa 14.
- Prints: **anexo nativo** por trás de `postEvidence(pr, files)` no adaptador. No GitHub, `gh pr comment --attach` com o token do machine user; no Forgejo, REST `/issues/{n}/assets`. Branch órfão fica como fallback documentado.
- Contexto: o usuário já tem um Forgejo auto-hospedado.

## Answer

- **Motor: Sandcastle**, com versão fixada (pré-1.0), provider **`noSandbox()`** em `ubuntu-latest`. A VM efêmera do runner é o sandbox; é o único caminho comprovado em CI e deixa o E2E usar o Docker do runner direto. Sem motor alternativo: Agent SDK e Workflow descartados.
- **Loop**: Stages, limite de 5 voltas e Escalation são código nosso (TS) em volta do Sandcastle.
- **Auth do Claude no CI**: `ANTHROPIC_API_KEY` **ou** `CLAUDE_CODE_OAUTH_TOKEN`, o que estiver configurado; o wizard pergunta.
- **Identidade na forja**: **machine user + access token** (`FACTORY_TOKEN`). Funciona em qualquer forja e preserva o Merge Gate (o humano não é o autor do PR). O `claude-code-action` sai do caminho da Factory.
- **Portabilidade**: toda operação de forja passa por um único **adaptador**; o template implementa só o GitHub; a interface cabe no Forgejo (pesquisa 14). O adaptador Forgejo é o primeiro esforço pós-mapa (o usuário tem um Forgejo auto-hospedado). Num runner próprio, trocar para `docker()`.
- **Prints**: anexo nativo via `postEvidence(pr, files)` no adaptador (GitHub: `gh pr comment --attach`; Forgejo: REST `/assets`). Branch órfão como fallback documentado.
- **Segurança**: (1) o guard só aceita `ready-for-agent` aplicada por quem tem `write`+; (2) o processo do agente não recebe secrets de nuvem nem o `FACTORY_TOKEN`; push e PR rodam num step separado, depois do Sandcastle. Rede restrita via `docker()` fica fora de escopo.
- **E2E Stage e prints**: stack local dentro do job (`createTestHarness`, Postgres em container, MSW). O smoke contra o preview roda depois, como CI do PR.

## Revisão

"Push e PR rodam num step separado" não isola o `FACTORY_TOKEN`: com `noSandbox()`, os steps de um job dividem VM e usuário. O `FACTORY_TOKEN` agora só existe num **job** separado (`publish`), em VM nova, que roda o harness da `main`. Decidido em [Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md).
