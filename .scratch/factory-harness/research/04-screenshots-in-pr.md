# Pesquisa 04 — Prints anexados ao PR

Ticket: [04-screenshots-in-pr](../issues/04-screenshots-in-pr.md) · Pesquisado em 2026-10-17 · Fontes primárias: GitHub Docs (repo `github/docs`), GitHub Changelog, código-fonte do `cli/cli` v2.102.0, issues do `cli/cli` com resposta de staff, README do `actions/upload-artifact` v7.0.2, docs da Cloudflare R2 e fonte das docs do Playwright v1.64.1.

## Resposta

**A premissa do ticket mudou em setembro de 2026.** Ainda não existe endpoint **documentado** na REST API para anexos, mas o **GitHub CLI v2.99.0 (2026-09-01)** ganhou `--attach` em `gh pr create|edit|comment` e `gh issue create|edit|comment`. Ele sobe a imagem para o mesmo armazenamento do drag-and-drop do navegador (`github.com/user-attachments/assets/...`), e a imagem herda a visibilidade do repo: num repo privado, só quem tem acesso vê. **Porém ele recusa o `GITHUB_TOKEN` e qualquer token de instalação de GitHub App (`ghs_`)**: só aceita token OAuth (`gho_`), PAT clássico (`ghp_`), PAT fine-grained (`github_pat_`) e token user-to-server (`ghu_`), com permissão de escrita no repo. O staff do `cli/cli` disse que isso é "intended behavior for now".

**Recomendação para a Factory:**

1. **Padrão: branch órfão de assets + link relativo `?raw=true`.** O job do E2E commita os PNGs em um branch órfão (ex.: `factory-assets`, caminho `pr-<N>/<run>/<nome>.png`) usando o próprio `GITHUB_TOKEN` com `contents: write`. O comentário do PR referencia `../blob/<sha>/pr-<N>/.../x.png?raw=true`. É a forma **documentada** pelo GitHub para imagens do repo em issues, PRs e comentários. Em repo privado, funciona para quem tem acesso de leitura. Funciona com **qualquer** identidade (GITHUB_TOKEN, App ou PAT), não exige secret novo nem serviço externo, e o push feito com `GITHUB_TOKEN` não dispara workflows, então não cria loop.
2. **Upgrade opcional: `gh pr comment --attach`**, se a identidade da Factory for um token de usuário (PAT/OAuth de uma machine user). Não incha o repo e usa o armazenamento nativo de anexos. A troca é local: o mesmo script de "publicar evidência" muda de backend. A decisão depende da identidade escolhida nos tickets 03/12. Esses tickets provavelmente vão exigir App ou PAT de qualquer jeito, porque PRs criados com `GITHUB_TOKEN` só rodam CI depois de aprovação manual.
3. **Não usar** R2 público, gists ou ações da comunidade baseadas em cookie como padrão. R2 e gists **tornam pública** a imagem de um repo privado. O cookie de sessão dá acesso total à conta.
4. **Actions artifacts** servem só como **link** complementar (relatório HTML do Playwright, trace). Eles não renderizam inline.

Geração: Playwright (v1.64.1) roda contra a URL do preview do PR (`baseURL`). Os testes do E2E marcados como evidência chamam `page.screenshot({ fullPage: true, animations: 'disabled', scale: 'css', mask: [...] })` + `testInfo.attach()`. O reporter JSON lista os caminhos, e um script publica e monta o comentário. As capturas seguem uma regra fixa: estados por critério de aceitação da issue, mais um conjunto fixo de smoke, em desktop e mobile (detalhes na seção F).

## Comparação das opções

| Opção | Renderiza inline? | Repo público | Repo privado | Credencial no Actions | Custos / contras |
|---|---|---|---|---|---|
| **`gh ... --attach`** (gh ≥ 2.99.0) | Sim (imagem e vídeo) | Imagem acessível sem auth | Só quem tem acesso ao repo vê | **Não** aceita `GITHUB_TOKEN`/`ghs_`; exige PAT/OAuth/`ghu_` com WRITE | PAT de longa duração atrelado a uma conta; limite de 10 MB por imagem; não funciona em GHES; endpoint `uploads.github.com/user-attachments/assets` não documentado na REST API (só o CLI é suportado) |
| **Branch órfão + `../blob/<sha>/...?raw=true`** | Sim | Público | Viewer precisa de read (documentado) | `GITHUB_TOKEN` com `contents: write` basta | Incha o `.git` (recomendação: < 1 GB, < 5 GB forte; limite de 10 GB no disco); `git clone` sem `--single-branch` baixa o branch; reescrever o branch para limpar quebra imagens antigas; rulesets podem bloquear criação de branch |
| **Commit no próprio branch do PR** | Sim | Público | Igual ao anterior | `GITHUB_TOKEN` | Polui o diff do PR e vai para a `main` no merge; cada commit dispara `synchronize` (loop de CI). **Descartado.** |
| **Cloudflare R2 público (domínio próprio)** | Sim (via Camo) | OK | **Imagem fica pública** (URL não adivinhável é só obscuridade) | Token de API R2 (secret) | Camo não autentica, então a imagem precisa ser pública; `r2.dev` tem rate limit e é "non-production"; exige zona no Cloudflare; free tier 10 GB-mês; lifecycle rule apaga por prefixo/dias |
| **R2 com presigned URL** | Até expirar | — | — | — | Expira em no máx. 7 dias, não funciona com domínio próprio, e a URL vira bearer token. **Inviável** para PR. |
| **Actions artifacts** (`upload-artifact@v7`, `archive: false`) | **Não** | Link para download | Link (exige login) | `GITHUB_TOKEN` | `artifact-url` "users must be logged-in"; abre no navegador, mas não há suporte documentado para embutir em Markdown; expira com a retenção |
| **Gist secreto** | Sim (público) | OK | **Vaza**: "secret gists aren't private" | `GITHUB_TOKEN` não tem permissão de gist; precisa de PAT com escopo `gist` | API só aceita `content` string (texto), então binário exige `git push` no gist |
| **`drogers0/gh-image`** (v1.4.0, 277★) | Sim | OK | OK (anexo nativo) | Cookie `user_session` de uma conta bot | O próprio README avisa: o cookie "grant full account access"; é engenharia reversa do fluxo web, frágil e com risco de ToS |
| **`buildinternet/uploads`** (uploads-v0.58.0, 19★) | Sim | OK | Links "non-guessable", mas públicos | Conta no serviço ou self-host em R2 | Terceiro jovem; mesma limitação de privacidade do R2 |

## Achados detalhados

### A. Não há API REST documentada para anexos; o caminho oficial novo é o GitHub CLI

- A página "Attaching files" (última mudança em 2026-09-01, commit "Document attaching files with GitHub CLI (#62914)") diz que dá para anexar pelo navegador e "from the command line with GitHub CLI". Ela não menciona API REST. Também diz: "For public repositories, uploaded files can be accessed without authentication. In the case of private and internal repositories, only people with access to the repository can view the uploaded files." Limites: 10 MB para imagens/gifs; vídeo 10 MB (plano free) ou 100 MB (pago). — [docs: attaching-files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files) (fonte: `github/docs/content/get-started/writing-on-github/working-with-advanced-formatting/attaching-files.md`)
- A página "Attaching files with GitHub CLI" diz que `--attach` existe em `gh issue create|edit|comment` e `gh pr create|edit|comment`, e que o CLI "writes the resulting URL into the body ... so it renders inline". Também diz: "You need push access to the repository to attach files." Se o Markdown do body já referencia o caminho local, o CLI **reescreve a referência no lugar**; arquivos não referenciados vão para o fim. Alt text via `caminho#ALT`. Só aceita imagem e mídia. — [docs: attaching-files-with-github-cli](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)
- Changelog de 2026-09-01: GA "across all plans", formatos PNG, JPEG, GIF, WebP, SVG, MP4, MOV e WebM. Diz que "GitHub Enterprise Server is not supported" e que os tokens são "the OAuth token from `gh auth login` or a classic personal access token". O post **não fala** de Actions nem de `GITHUB_TOKEN`. — [GitHub Changelog 2026-09-01](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/); roadmap [github/roadmap#1324](https://github.com/github/roadmap/issues/1324)
- Versões do gh: o recurso entrou na **v2.99.0 (2026-09-01)**; a mais recente é a **v2.102.0 (2026-09-30)**. A v2.99.0 também limitou lotes a 50 arquivos (#14289). — [release v2.99.0](https://github.com/cli/cli/releases/tag/v2.99.0)
- Código (`internal/attachments/client.go`, v2.102.0):
  - o upload é `POST https://uploads.github.com/user-attachments/assets?name=…&content_type=…&repository_id=<id numérico>`;
  - allowlist de token: `gho_`, `ghp_`, `github_pat_`, `ghu_`;
  - permissões aceitas: `ADMIN`, `MAINTAIN`, `WRITE` ("READ and TRIAGE get a 404");
  - GHES é recusado.

  Os prefixos estão em `internal/gh/gh.go`, e `ghs_` = server-to-server fica de fora. — [cli/cli@v2.102.0 internal/attachments/client.go](https://github.com/cli/cli/blob/v2.102.0/internal/attachments/client.go), [PR #14180](https://github.com/cli/cli/pull/14180)
- Sobre `GITHUB_TOKEN`/App: a issue [cli/cli#14309](https://github.com/cli/cli/issues/14309) (2026-09-01) reproduz o problema. Com `GITHUB_TOKEN` e `contents: write`, o endpoint responde **404**. Com `gho_` no mesmo repo, funciona. Resposta de @BagToad (MEMBER, mantenedor do gh): "This is intended behavior for now, but we may re-evaluate in the future based on demand." A issue segue aberta, com label `blocked`.
- O `GITHUB_TOKEN` é "a GitHub App installation access token", portanto `ghs_`. — [docs: GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
- O endpoint `user-attachments` **não aparece** na descrição OpenAPI da REST API (`github/rest-api-description`, busca em 2026-10-17). O suporte oficial existe só via CLI. Antes disso, a discussão da comunidade [#28219](https://github.com/orgs/community/discussions/28219) registrava a ausência de API.
- **Lacuna:** nenhuma fonte primária diz quais **permissões de PAT fine-grained** o endpoint exige. O código só verifica `viewerPermission` = WRITE. O changelog cita apenas OAuth e PAT clássico, enquanto o código também aceita `github_pat_`. Validar empiricamente antes de adotar.

### B. Imagens do próprio repo (branch órfão), em repo público e privado

- As docs de Markdown dizem: "GitHub supports embedding images into your issues, pull requests, discussions, comments and `.md` files". Para imagens do repositório, a orientação é "use relative links". Para o contexto "In issues, pull requests and comments of the repository", o exemplo é `../blob/main/assets/images/electrocat.png?raw=true`. Sobre repo privado: os links entre repositórios "will work for images in a private repository only if the viewer has at least read access". (Arquivo alterado pela última vez em 2026-07-08.) — [docs: basic writing and formatting syntax § Images](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images)
- Inferência: o padrão `blob/<ref>/<path>?raw=true` aceita qualquer ref, então dá para usar um SHA do branch órfão e evitar links que mudam. As docs mostram só `main`; usar SHA ou outro branch **não está explicitamente documentado**, mas segue a mesma rota. Validar num spike, inclusive em repo privado e com URL absoluta `https://github.com/OWNER/REPO/blob/<sha>/...?raw=true`.
- Pushes feitos com `GITHUB_TOKEN` "will not create a new workflow run". Commitar no branch de assets não dispara CI. — [docs reusable: actions-do-not-trigger-workflows](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs)
- Tamanho: "We recommend repositories remain small, ideally less than 1 GB, and less than 5 GB is strongly recommended"; limite de "On-disk size: 10 GB" e push de 2 GB. Prints com `scale: 'css'` têm tipicamente centenas de KB (estimativa, não medida). Mesmo assim, uma Factory ativa acumula volume. — [docs: about large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [docs: repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
- Um usuário relata em [cli/cli#14309](https://github.com/cli/cli/issues/14309) (2026-10-09) usar exatamente esse workaround: branch `assets` nunca mergeado e `?raw=true`. Outro usuário diz que, **para vídeo**, aparece só um link de download. Por isso o branch órfão serve para **imagens**; vídeo inline exige `--attach`.

### C. Cloudflare R2

- Bucket público via domínio próprio (a zona precisa estar na mesma conta) ou `r2.dev`. A doc diz que "Public access through `r2.dev` subdomains is rate-limited and should only be used for development purposes". WAF, cache e Access só existem com domínio próprio. (Atualizada em 2026-09-25.) — [R2: public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- Presigned URLs têm "Timeout from 1 second to 7 days" e "cannot be used with custom domains". A doc pede para tratar como bearer token. (Atualizada em 2026-08-22.) — [R2: presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- Imagens externas em Markdown passam pelo proxy Camo. Uma imagem "behind a login can't be viewed by GitHub", e a doc diz que "Anyone who receives your anonymized URL ... may view your image". Ou seja: **para renderizar, a imagem no R2 precisa ser pública**, o que vaza prints de repos privados. — [docs: about anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)
- Free tier: 10 GB-mês, 1 milhão de operações Classe A e 10 milhões de Classe B; egress grátis (atualizado em 2026-10-01). Lifecycle por prefixo/dias via `wrangler r2 bucket lifecycle add` (atualizado em 2026-04-21). Upload via `wrangler r2 object put <bucket>/<key> --file --content-type --remote`. — [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [wrangler r2](https://developers.cloudflare.com/workers/wrangler/commands/r2/)

### D. GitHub Actions artifacts

- `actions/upload-artifact` **v7.0.2** (2026-10-07) com `archive: false` sobe um arquivo único sem zip. O output `artifact-url` vem com a ressalva: "Users must be logged-in in order for this URL to work". — [README upload-artifact@v7.0.2](https://github.com/actions/upload-artifact/tree/v7.0.2)
- Changelog de 2026-02-26: com `archive: false`, se o navegador suporta o tipo, "you can view files directly in your browser". O post **não diz** que dá para embutir em Markdown. Como o Camo não autentica, a conclusão é que **não renderiza inline** (inferência; não testado). — [GitHub Changelog 2026-02-26](https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/)
- Uso na Factory: anexar o relatório HTML/trace do Playwright como artifact e linkar no comentário, como complemento.

### E. Gists

- A REST API `POST /gists` recebe `files.<nome>.content` como **string**, ou seja, não há upload binário pela API. Também exige o escopo OAuth `gist`. — [REST: create a gist](https://docs.github.com/en/rest/gists/gists#create-a-gist)
- O `GITHUB_TOKEN` não tem permissão de gist: a lista de `permissions` não inclui gists. — [workflow syntax § permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- A doc de gists diz: "Secret gists aren't private. If you send the URL of a secret gist to a friend, they'll be able to see it." — [docs: creating gists](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists)

### F. Gerar os prints com Playwright contra o preview

- Versão atual: **Playwright v1.64.1 (2026-10-14)**. — [releases](https://github.com/microsoft/playwright/releases/tag/v1.64.1)
- Opções úteis de `page.screenshot()`, conforme `docs/src/api/params.md` @v1.64.1:
  - `fullPage` (página rolável inteira);
  - `animations: 'disabled'` (anima finitas até o fim e cancela as infinitas);
  - `caret: 'hide'` (padrão);
  - `mask: Locator[]` + `maskColor` (cobre dados dinâmicos);
  - `style`/`stylePath` (CSS só para o print);
  - `scale: 'css'` (arquivos menores em high-DPI).

  `locator.screenshot()` captura um elemento. — [Playwright screenshots](https://playwright.dev/docs/screenshots), [params.md@v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/api/params.md)
- `testInfo.attach(name, { path | body, contentType })` (desde v1.10) copia o arquivo para onde os reporters o encontram. O reporter `json` (`outputFile`) gera o resultado completo da execução, e o script de publicação lê os anexos dali. `use.screenshot: 'on' | 'only-on-failure'` captura automaticamente no fim de cada teste. — [testInfo.attach](https://playwright.dev/docs/api/class-testinfo#test-info-attach), [reporters](https://playwright.dev/docs/test-reporters), [test use options](https://playwright.dev/docs/test-use-options)
- Emulação via `projects` com `devices['Desktop Chrome']` e `devices['iPhone 13']`, além de `colorScheme`. — [emulation](https://playwright.dev/docs/emulation)
- **Proposta de quais páginas e estados capturar** (decisão de design, não vem de fonte):
  1. **Por critério de aceitação da issue**: o Stage de E2E escreve um teste por critério e marca com a tag `@evidence`. Cada teste captura o estado **antes** da ação, o estado **depois** (sucesso) e o **erro/validação** quando o critério envolve formulário.
  2. **Estados de dados**: vazio (lista sem itens), com dados (seed), carregando só se for relevante.
  3. **Smoke fixo do Skeleton** (sempre): tela de login/cadastro e home pós-login da Company. Isso garante que todo PR mostra que o app sobe.
  4. **Viewports**: desktop e um mobile, ambos com `fullPage: true`, `animations: 'disabled'` e `scale: 'css'`. Mascarar timestamps, IDs e e-mails gerados.
  5. **Limite**: no máximo cerca de 20 imagens por PR (o gh limita lotes a 50, e o GitHub limita imagens a 10 MB). Agrupar o resultado em `<details>` por critério.
  6. **Atualização**: um único comentário "Factory evidence" por PR, editado a cada volta de Development → E2E, em vez de um comentário novo a cada volta.
- O alvo é a URL do preview (`baseURL` vinda do evento de deploy). Se o preview estiver protegido (ex.: Cloudflare Access), o Playwright precisa de `extraHTTPHeaders` com service token. Isso depende do ticket 05.

## Riscos em aberto

- **Identidade da Factory** (tickets 03/12): com GitHub App, o `--attach` está fora até o GitHub mudar a política ([cli/cli#14309](https://github.com/cli/cli/issues/14309)). Com PAT de machine user, ele funciona, mas é credencial de longa duração. Além disso, PRs criados com `GITHUB_TOKEN` deixam o CI em "approval-required", então a Factory provavelmente precisará de App ou PAT de qualquer forma.
- **Endpoint não documentado**: o `--attach` usa `uploads.github.com/user-attachments/assets`, que não está na REST API pública. Só o CLI é suportado oficialmente, então convém fixar uma versão mínima do gh (≥ 2.99.0) no runner.
- **PAT fine-grained**: as permissões exigidas não estão documentadas (o changelog cita só PAT clássico/OAuth). Validar em spike.
- **Branch órfão**: falta validar empiricamente `blob/<sha>/...?raw=true` com SHA de branch não-default em repo **privado**, tanto no corpo quanto em comentário de PR, e no app mobile do GitHub. Também falta política de limpeza: reescrever o branch quebra as imagens de PRs antigos. Uma alternativa é deletar `pr-<N>/` após o merge, mas o blob continua acessível pelo SHA até o GC; o comportamento exato não está documentado.
- **E-mail de notificação** de repo privado: clientes de e-mail não têm sessão do GitHub, então as imagens do branch órfão provavelmente não aparecem no e-mail. As fontes não tratam disso.
- **Rulesets/branch protection** da cópia do usuário podem impedir a criação do branch `factory-assets` pelo `GITHUB_TOKEN`. O bootstrap deve criá-lo.
- **Vídeo**: o branch órfão não gera player inline (relato de usuário em #14309); só o `--attach` faz isso.
