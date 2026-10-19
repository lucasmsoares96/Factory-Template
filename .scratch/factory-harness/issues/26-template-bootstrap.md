# Bootstrap do template público

Type: grilling
Status: resolved
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

## Answer

Decidido em 2026-10-19 com o usuário. Fatos em [GitHub](../research/26-github-bootstrap.md) e [Cloudflare, Neon e Resend](../research/26-cloud-bootstrap.md).

**Cópia**: pelo botão "Use this template". O `sync-upstream` deixa de existir (revisão em [Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md) e [Puxar o Skeleton upstream num produto privado](28-upstream-skeleton-sync.md)); o bootstrap não configura `upstream`.

**Forma**
- Wizard em TS com `@clack/prompts`, em `.factory/bootstrap/`, chamado por `pnpm bootstrap`. É o único script em TS: `setup.sh`, hooks e linhas `run:` continuam em bash.
- Pré-requisito: `gh` (grava secrets já criptografados). `wrangler` e `neonctl` são devDependencies. As chamadas ao `gh` ficam num módulo só (`bootstrap/forge/github.ts`), para o Forgejo ganhar o dele depois.
- Sem estado local: cada etapa consulta o estado atual e pula o que já está feito; `--redo <etapa>` refaz uma. Nenhum segredo é gravado em disco.
- O dev local (`pnpm dev`, `factory:verify`, `factory local`) não precisa de bootstrap; o `factory local` usa o login do Claude Code da máquina.

**Três módulos**, escolhidos no wizard
- **Produção** (obrigatório), também para quem usa a Factory só localmente:
  - `APP_NAME` e `APP_TITLE` (variáveis do repo);
  - token da Cloudflare pela URL do template "Edit Cloudflare Workers" (o token só nasce no dashboard) + `CLOUDFLARE_ACCOUNT_ID`; registra o subdomínio `workers.dev` pela API se faltar; o KV `OAUTH_KV` da produção é criado pelo próprio `wrangler deploy` (provisionamento automático, GA na 4.113);
  - projeto Neon `$APP_NAME` (procura pelo nome antes de criar) com key restrita ao projeto, depois de `neon login`;
  - Resend: o domínio próprio é obrigatório para mandar email a terceiros na produção (sem domínio, o Resend só entrega ao dono da conta). É a única exceção paga da regra 100% gratuito. A etapa é adiável; ela cria o domínio no Resend e mostra os registros DNS;
  - deploy de teste da `main` pelo Actions. O deploy é sempre pelo Actions, nunca da máquina do dev.
- **Previews** (depende do Produção, usa o mesmo token da Cloudflare):
  - projeto `$APP_NAME-preview`, cujo branch padrão vira o `base` (até 9 previews simultâneos, limite no `config.ts`; acima dele o CI comenta "preview skipped: limit reached"), com key restrita a ele. Se a key do preview apagar o `base`, o deploy da `main` o recria;
  - KV do preview criado pelo bootstrap (o `wrangler preview` não provisiona), id em `PREVIEW_OAUTH_KV_ID`;
  - PR de teste: preview sobe, passa no smoke e é limpo (Worker Preview e branch Neon apagados).
- **Factory no Actions**:
  - machine user com PAT clássico (`repo`, sem `workflow`; o fine-grained não alcança repo de outra conta pessoal). O wizard convida como colaborador `write`, aceita o convite com o token da máquina e confere pelo `X-OAuth-Scopes` e pelo login (diferente do dono). O README avisa que os Termos permitem uma conta de máquina gratuita, então o token alcança todos os repos onde ela colabora;
  - auth do Claude: `CLAUDE_CODE_OAUTH_TOKEN` recomendado, `ANTHROPIC_API_KEY` como alternativa; fica só um dos dois, e o `doctor` avisa se achar os dois;
  - labels a partir do `.factory/config.ts` (nome, cor, descrição), com `gh label create --force`; um teste falha se as tabelas de `docs/agents/triage-labels.md` divergirem do config.
- Cada workflow só roda com a variável do seu módulo ligada (`DEPLOY_ENABLED`, `PREVIEWS_ENABLED`, `FACTORY_ENABLED`); sem ela, o job aparece como pulado, sem falha. O bootstrap liga cada uma depois do `doctor` do módulo passar.

**Nome do produto**: `wrangler.jsonc` e `package.json` não mudam (`name: "skeleton"` para o dev local). O `deploy` (código da `main`) gera `app/wrangler.ci.jsonc` com o `APP_NAME` e os ids e roda `deploy --name` / `preview --worker-name`.

**Proteções do GitHub**: o bootstrap tenta criar os environments `preview` e `production`, ambos restritos à `main` (token da Cloudflare nos dois; key Neon do preview só no `preview`; key Neon da produção e Resend só no `production`), e um ruleset na `main` (PR obrigatório, sem force-push nem exclusão, check `verify`). O que fica ligado depende da resposta da API, não do plano nem da visibilidade: público, Pro e Team aceitam; privado no Free recusa. Se recusar, os secrets vão para o nível do repo, `FACTORY_USE_ENVIRONMENTS` fica `false` e o `doctor` mostra o que ficou desligado. Rodar de novo depois de trocar de plano liga o que passou a estar disponível. Aprovador obrigatório não é usado.

**Verificação**: `doctor` só leitura (também `pnpm bootstrap doctor`) confere secrets, variáveis, labels, recursos e permissões; depois o deploy de teste e o PR de teste. Uma issue de exemplo para a Factory é opcional, com "não" como padrão.

**`destroy`**: `pnpm bootstrap destroy [módulo]`; sem argumento, apaga tudo.
- Apaga: Worker e Previews, KVs, projetos Neon, domínio no Resend, secrets, variáveis, environments, ruleset e o colaborador.
- Não apaga: o repo, as issues, as labels e as contas nos serviços.
- Mostra antes tudo o que vai sumir, com o banco de produção em destaque, e exige digitar o `APP_NAME`.
- Agentes não executam: o comando recusa sem TTY ou com `CI` definido (com teste); `deny` em `Bash(pnpm bootstrap destroy:*)` no `.claude/settings.json`; regra no `AGENTS.md` da raiz.

**Critérios de aceite da base** (só testáveis na conta):
- quais permissões do token da Cloudflare criam um Worker Preview (workers-sdk#15797);
- com que visibilidade o pacote do GHCR nasce num repo público (a documentação se contradiz);
- o que a API devolve ao criar environment e ruleset num repo privado no Free.

## Revisão

`APP_NAME`/`APP_TITLE` saem: a identidade de cada Product fica em `apps/<id>/product.config.ts`. O bootstrap se divide em parte comum (Cloudflare, machine user, token do Claude, labels, incluindo `product:<id>`) e `pnpm bootstrap product <id>` (Produção e Previews), com `doctor` e `destroy` por Product, secrets do Product com prefixo `<ID>_`, environments `<id>-production`/`<id>-preview` e `DEPLOY_PRODUCTS`/`PREVIEW_PRODUCTS` como listas. Decidido em [Vários produtos num repo só](30-multi-product-repo.md).
