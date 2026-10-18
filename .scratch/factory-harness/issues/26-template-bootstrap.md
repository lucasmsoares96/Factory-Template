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
