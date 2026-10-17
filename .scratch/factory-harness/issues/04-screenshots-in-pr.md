# Prints anexados ao PR

Type: research
Status: resolved

## Question

Como um job do GitHub Actions pode anexar **imagens visíveis inline** no corpo ou em comentário de um PR, dado que a API do GitHub não tem endpoint de upload de anexos? Compare as opções com prós/contras (commit das imagens no próprio branch ou em branch órfão e link raw/blob, upload para Cloudflare R2 com URL pública, GitHub Actions artifacts — que não renderizam inline —, gists, ações da comunidade) considerando repositórios **privados** (renderização de imagem com autenticação) e públicos. Como gerar os prints com Playwright contra o preview do PR, e quais páginas/estados capturar automaticamente?

## Answer

- Desde o gh v2.99.0 (2026-09-01), `gh pr create|edit|comment --attach` sobe imagens nativas (`user-attachments`) que herdam a visibilidade do repo. Mas o comando **recusa `GITHUB_TOKEN` e tokens de GitHub App (`ghs_`)**: exige PAT ou OAuth com WRITE. O staff do gh diz que é "intended behavior for now".
- **Recomendação padrão:** commitar os prints num **branch órfão** (`factory-assets`) com `GITHUB_TOKEN` e referenciar via `../blob/<sha>/...?raw=true`. É o formato documentado pelo GitHub e, em repo privado, funciona para quem tem read. Não exige secret extra.
- **Upgrade:** usar `--attach` se a identidade da Factory for um token de usuário (decisão dos tickets 03/12). Não incha o repo e suporta vídeo inline.
- Descartados: R2/gist/serviços de terceiros, porque a imagem fica pública (o Camo não autentica). Artifacts não renderizam inline e servem só como link.
- Prints: Playwright v1.64.1 contra o preview, nos testes `@evidence` por critério de aceitação + smoke fixo, desktop e mobile, com `animations: 'disabled'`, `mask` e `scale: 'css'`, e um único comentário de evidência editado a cada volta.

[pesquisa](../research/04-screenshots-in-pr.md)
