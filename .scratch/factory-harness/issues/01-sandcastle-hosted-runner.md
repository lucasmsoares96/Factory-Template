# Sandcastle em runner hospedado do GitHub

Type: research
Status: resolved

## Question

O Sandcastle do Matt Pocock consegue ser o motor da Factory rodando em um runner **hospedado** do GitHub Actions (`ubuntu-latest`), sem self-hosted runner? O que ele exige (Docker/containers, Claude Code dentro do sandbox, autenticação por `CLAUDE_CODE_OAUTH_TOKEN` ou API key), como ele expressa um loop de etapas (Exploration → Development → E2E → Review, com retorno a Development e limite de 5 voltas), como ele cria branch/commit/PR, e quais são os limites práticos (tempo máximo de job de 6h, disco, rede, custo)? Existe exemplo oficial de uso em CI?

## Answer

Sim. O próprio repositório do Sandcastle (`@ai-hero/sandcastle` 0.12.0) roda seus agentes em `ubuntu-latest` hospedado. Ele usa `noSandbox()` (a VM é o sandbox), instala o Claude Code no runner e autentica com `CLAUDE_CODE_OAUTH_TOKEN` (token de 1 ano via `claude setup-token`) ou `ANTHROPIC_API_KEY`. Docker 28 e Podman 4.9 estão na imagem, mas não há exemplo oficial de `docker()` em CI.
O Sandcastle é uma biblioteca, não um motor completo. Ele dá worktree/branch, `run()` headless, `createSandbox()` reutilizável, `sandbox.exec()` como gate e `Output.object` para vereditos. Stages, o limite de 5 voltas e a Escalation são um `for` em TS escrito por nós. Push, PR e labels ficam em passos `gh` do workflow (é o padrão do repositório).
Limites: job de 6 h; 14 GB de SSD; 4 CPU/16 GB em repositório público (grátis) ou 2 CPU/8 GB em privado (US$ 0,006/min); PR criado com `GITHUB_TOKEN` não dispara workflows sem aprovação (precisa de App/PAT).
Riscos: o agente roda com `--dangerously-skip-permissions` e secrets no ambiente, o que abre risco de injeção de prompt; há contradição entre ADR e código; a biblioteca é pré-1.0.
Detalhes e fontes: [pesquisa](../research/01-sandcastle-hosted-runner.md)
