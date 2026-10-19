# Bootstrap do template público

Type: grilling
Status: open
Blocked by: 21

## Question

Como alguém que copia o template chega a uma Factory e um Skeleton funcionando, sem nada fixo no código? Usar a skill `wizard`. Pontos a fechar:

- **Contas e o que o humano faz na mão**: machine user + `FACTORY_TOKEN` ([Escolha do motor da Factory](12-factory-engine-choice.md)), auth do Claude (API key ou OAuth token), conta Cloudflare (token do deploy), Neon, Resend, domínio opcional.
- **O que o bootstrap cria sozinho**:
  - Cloudflare: Worker, KV `OAUTH_KV`, KV do bloco `previews` (o R2 dos anexos é da Reference App, ver [Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md));
  - Neon: projeto de produção e projeto `<app>-preview` com o branch `base` e as duas API keys ([Segurança do CI do PR com código da Factory](19-pr-ci-security.md));
  - GitHub: labels (triage e `in-progress`), secrets e variáveis, environments, proteção de branch.
- **Forma**: um script interativo (`pnpm bootstrap`), uma checklist, ou os dois; idempotente e reexecutável; onde guarda o estado.
- **Verificação**: como o bootstrap prova que acabou (primeiro deploy, preview de um PR de teste, uma issue de exemplo que a Factory resolve).
- **Renomear o produto**: nome do Worker, do banco e do pacote, a partir de uma variável só.
- **Novos pontos de [Lista final de arquivos de harness](25-harness-files.md)**:
  - labels da tabela "Factory labels" de `docs/agents/triage-labels.md` (`in-progress`, `agent:explore`, `harness-change`), além das de triage;
  - pacote da imagem no GHCR: o primeiro push cria o pacote; conferir se ele fica ligado ao repo e com a visibilidade do repo, e se os jobs leem com `packages: read`;
  - `.mcp.json` sem segredo, então o bootstrap não cria token de MCP;
  - remover a nota "Issues live in `lucasmsoares96/Factory-Template`": o `AGENTS.md` e o `issue-tracker.md` já saem genéricos.
