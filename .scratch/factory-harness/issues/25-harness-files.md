# Lista final de arquivos de harness

Type: grilling
Status: resolved
Blocked by: 21

## Question

Quais arquivos de harness o template entrega, onde fica cada um e o que diz? As convenções já estão em [Convenções de arquivos de harness](09-harness-conventions.md): sem `CLAUDE.md`, `AGENTS.md` na raiz e por pacote, skills em `.agents/skills` e `.claude/skills`, allowlist no CI por `settings:`/`--allowedTools`, MCPs headless e Playwright CLI + skill. O código da Factory (`.factory/`, workflows `factory-*`) está em [Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md). Pontos a fechar:

- **`AGENTS.md`**: quais diretórios ganham um (segundo o layout de [Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md)) e o conteúdo de cada um, incluindo a convenção para apps construídas sobre o Skeleton ([Skeleton primeiro, Reference App em repo privado](27-skeleton-first-private-app.md)).
- **Skills próprias da stack** (por exemplo, criar endpoint Hono + OpenAPI + Kubb, criar migration, teste `@evidence`; as tools do MCP saem da OpenAPI, ver [Ferramentas do MCP do Skeleton](23-reference-app-mcp-tools.md)) × skills do Matt já presentes; quais das skills em `.agents/skills` hoje ficam no template público.
- **Subagents**, `.mcp.json` (local e CI), `.claude/settings.json` e hooks (por exemplo, `git-guardrails`).
- **Imagem do container** de execução local (`pnpm factory local NN`): base, ferramentas e como fica em dia com o `ubuntu-latest`.
- **Como cada arquivo é mantido**: o que a Factory pode editar sozinha e o que exige humano.

## Progresso do grilling (rodada 1)

Todas as recomendações aceitas pelo usuário em 2026-10-18.

- **`AGENTS.md` em três lugares**: raiz, `app/` e `.factory/`. A raiz manda ler o do pacote antes de editar ali. Nenhum por feature.
- **`AGENTS.md` da raiz** (inglês, < 200 linhas): o que é o repo, com link para o `GLOSSARY.md`; mapa dos diretórios; comandos (`pnpm install`, `pnpm dev`, `pnpm generate`, `pnpm factory:verify`); regras (inglês, Conventional Commits com `#N`, nunca criar `CLAUDE.md`, não tocar em `.github/workflows/`, nunca alterar migration publicada); "Building a product on the Skeleton" (`features/<app>/`, registro, `routes.<app>.ts`, `no-restricted-imports`, `pnpm sync-upstream`); a seção "Agent skills".
- **Idioma da UI do Skeleton**: i18n mínimo. As strings do Skeleton ficam num arquivo de mensagens por idioma (`en` e `pt-BR`), com o idioma escolhido por config e sem troca em tempo de execução. Assim um produto em português não briga com o `upstream`. A regra vai para o `app/AGENTS.md`. Revê a nota "UI da Reference App em português, sem i18n" do mapa.
- **Skills do Matt no template**: ficam `tdd`, `code-review`, `triage`, `implement`, `diagnosing-bugs`, `codebase-design`, `domain-modeling` (usadas pela Factory) e `grilling`, `wayfinder`, `research`, `prototype`, `to-spec`, `to-tickets`, `setup-matt-pocock-skills`, `wizard`, `pr`, `writing-for-agents`, `handoff`, `git-guardrails-claude-code` (planejamento humano). As outras 19 saem.
- **Skills próprias da stack**, com prefixo `skeleton-`: `skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-add-feature`, `skeleton-evidence-test`. As regras curtas ficam no `app/AGENTS.md`; as receitas, nas skills. O usuário as escreve junto com a base, antes da primeira issue da Factory.
- **Skills de fornecedor**: `playwright-cli` e `workers-best-practices`, pelo `npx skills`, com hash no `skills-lock.json`. Neon, shadcn e ctx7 ficam fora.
- **`.mcp.json`**: só servidores sem segredo: `cloudflare-docs`, `context7` (se funcionar sem key; ver pesquisa) e `shadcn` (stdio). `cloudflare-api` e `neon` read-only ficam documentados no `AGENTS.md` como `claude mcp add --scope local`. Sem `.codex/config.toml`.
- **Subagents**: nenhum. O loop em TS já isola cada Stage.
- **Workflows `claude.yml` e `claude-code-review.yml`**: saem.
- **`docs/agents/`**: `issue-tracker.md` e o `AGENTS.md` raiz sem nome de repo fixo ("infer the repo from `git remote`"). O `triage-labels.md` ganha a tabela "Factory labels" (`in-progress`, `agent:explore`), da qual o bootstrap cria as labels.
- **O que a Factory pode editar**:
  - `AGENTS.md`, `docs/agents/` e `.factory/`: liberado, mas o `publish` põe a label `harness-change` e um aviso no topo do PR;
  - `.agents/skills`, `.claude/skills`, `skills-lock.json`, `.claude/settings.json` e `.mcp.json`: como `.github/workflows/`, Escalation sem PR, com o patch no comentário.

## Progresso do grilling (rodada 2)

Pesquisa: [research/25-harness-files.md](../research/25-harness-files.md). Aceito pelo usuário em 2026-10-18, salvo onde indicado.

- **`app/AGENTS.md`**: layout e interface `Feature`; regras de API (`operationId`/`summary`/`description`, `limit` padrão 50 + cursor, `x-mcp: false`, Better Auth fora); banco só acrescenta, `drizzle-kit check`; código gerado (Kubb e `openapi.json` fora do git, `routeTree.gen.ts` commitado, snapshot do `tools/list` no mesmo commit); o que cada camada de teste cobre e a tag `@evidence`; i18n; versões fixadas da stack; links para as skills `skeleton-*`. Uma ou duas linhas por item.
- **Documentação oficial** (substitui o Context7, a pedido do usuário): o `AGENTS.md` da raiz manda sempre consultar a documentação oficial atual antes de usar uma API (pelo MCP `cloudflare-docs` ou por WebFetch no site oficial), e nunca confiar na memória. O Context7 sai do `.mcp.json`, que fica com `cloudflare-docs` e `shadcn`.
- **`.factory/AGENTS.md`**: os quatro seams e "toda mudança de comportamento vem com teste contra o adaptador falso"; os invariantes de segurança (o `work` sem token de forja e com env por allowlist, o `publish` com o harness da `main`, estado atual e não o evento, `--force-with-lease`, caminhos protegidos); o contrato com o produto; onde ficam prompts e `config.ts`. Um teste do harness falha se o job `work` do YAML receber `FACTORY_TOKEN`.
- **i18n mínimo**: `app/src/platform/i18n/en.ts` e `pt-BR.ts` com objeto tipado (o `tsc` pega a chave que faltar), idioma por variável de build `APP_LOCALE`, sem biblioteca; emails usam o mesmo arquivo; a API devolve código de erro estável + mensagem em inglês, a SPA traduz pelo código, o MCP recebe o inglês; cada feature de produto traz o seu `messages.ts`.
- **Prompts** em `.factory/prompts/` (`development`, `review`, `triage`, `pr-feedback`, `update-branch`): inglês, templates com placeholders, chamam as skills pelo nome em vez de copiar o texto, repetem as regras duras (caminhos protegidos, nada de seams novos, `needs-human` + pergunta ao travar). O texto final é implementação.
- **`GLOSSARY.md` e `docs/adr/`**: no grupo "liberado com `harness-change`". O Development pode acrescentar termos ao glossário, mas não cria ADR: termina com `needs-human`. A label `harness-change` entra na tabela "Factory labels".
- **`.claude/settings.json`**: `permissions.deny` para `Edit`/`Write` em `.github/workflows/**`, `.claude/**`, `.mcp.json`, `.agents/skills/**` e `skills-lock.json`; hook `PreToolUse` do `git-guardrails` em `.claude/hooks/` (bloqueia `push`, `reset --hard`, `clean`, `branch -D`, `checkout` de outra branch); sem `allow` e sem `env`. Fato: no modo bypass, `deny` e hooks valem, `allow` não faz nada. A checagem do diff no `publish` continua sendo a garantia (um `sed -i` escapa do `deny`).
- **Sem settings só do CI**: o `claude-settings.ci.json` sai (o `allow` não faz nada no bypass, e o Sandcastle 0.12.0 não deixa passar `--settings`).
- **Env do agente por allowlist**: o `noSandbox()` repassa o `process.env` inteiro, então o adaptador `Agent` roda o Sandcastle num processo filho só com `PATH`, `HOME`, a auth do Claude, `DATABASE_URL` e `CI`, com teste.
- **Skills por symlink**: `.claude/skills/<x>` → `../../.agents/skills/<x>` (padrão do CLI `skills` 1.7.2), aviso de `core.symlinks` no Windows; a fonte do Matt fixada por SHA no `skills-lock.json`; job `skills-check` com o CLI fixado: restaura do lock, `git diff --exit-code` e confere os symlinks. As `skeleton-*` ficam fora do lock.
- **Em aberto**: imagem do container local (o usuário perguntou por que partir da imagem do Playwright e não de um Ubuntu puro) e, por consequência, a Q18 (o `work` do CI usar a mesma imagem).

## Progresso do grilling (rodada 3)

- **Imagem do container (Q17')**: `.factory/docker/Dockerfile` com `FROM ubuntu:24.04`, que roda o script compartilhado `.factory/setup.sh`: Node pelo `.node-version` (tarball oficial), pnpm via corepack, Claude Code na versão do `config.ts` e `npx playwright@<versão do lockfile> install --with-deps chromium`. Usuário não-root com uid 1001 (o do runner), sem `IS_SANDBOX=1`. Tag = hash das versões, passadas como `--build-arg`; só reconstrói quando uma versão muda. Partir da imagem do Playwright foi descartado: traz três navegadores (~2 GB) e exigia teste de drift da tag.
- **Job `work` do CI (Q18')**: o usuário quer uma **imagem pronta num registry**, para não gastar minutos do Actions configurando a máquina em cada execução. Em aberto: registry, visibilidade e custo (pesquisa), quando reconstruir e quais jobs usam a imagem.

## Progresso do grilling (rodada 4)

Aceito pelo usuário em 2026-10-18.

- **Build da imagem**: job reaproveitável `image` (`workflow_call`) antes de todo job que usa a imagem. Calcula o hash (`.node-version`, Playwright do lockfile, Claude Code do `config.ts`, `Dockerfile`, `setup.sh`) a partir do branch, confere a tag no registry (`docker manifest inspect`), constrói e publica se faltar, e devolve a tag em `needs.image.outputs.tag`. O PR que sobe uma versão já testa com a imagem nova.
- **Quem usa a imagem**: o `work` da Factory e da Triage e o `build` do CI do PR (rodam `verify`/Playwright). `claim`, `publish`, `unblock`, `update-branches`, `deploy`, `smoke` e `skills-check` usam `setup-node` com cache do pnpm.
- **Modo local**: `pnpm factory local` calcula o mesmo hash, tenta `docker pull` e só constrói localmente se a tag não existir.
- **`container:` no job**: `--user 1001` (dono do workspace montado), Postgres por `services:` com `DATABASE_URL`, `defaults.run.shell: bash`, sem `docker` CLI na imagem. Ressalva em verificação: com `USER 1001` no Dockerfile, o `--user` pode ser dispensável nas duas forjas (o Forgejo não aceita `--user`). O fato vai para o doc de migração.
- **Em aberto**: qual registry, visibilidade e custo (pesquisa em andamento).

## Progresso do grilling (rodada 5)

Adendo da pesquisa: [research/25-harness-files.md](../research/25-harness-files.md#adendo-imagem-num-registry-rodada-3).

- **Registry (Q28, opção a)**: cada repo publica a própria imagem no GHCR, com a visibilidade do repo. No produto privado, isso vale enquanto storage e banda do GHCR forem "currently free" (aviso de 1 mês antes de mudar; acima de 500 MB no Free, o uso é bloqueado, não cobrado). O job `image` pede `packages: write`, e quem usa a imagem pede `packages: read`, porque o runner sempre faz login no ghcr.io com o token do job. Sem `actions/attest`.
- Fato: o pacote nasce **privado** mesmo num repo público, e tornar público não tem volta.
- Em aberto: Q29 (medir o pull contra o `setup.sh`), Q30 (`USER 1001` no Dockerfile, sem `--user`), visibilidade no template, plano B se o GHCR bloquear, limpeza de versões antigas.

## Progresso do grilling (rodada 5)

Pesquisa: adendo de [research/25-harness-files.md](../research/25-harness-files.md).

- **Registry (Q28)**: o usuário escolheu (a). Cada repo publica a própria imagem no GHCR, com a visibilidade do repo. Risco aceito: imagem privada só é gratuita pela exceção "currently free" do GHCR (aviso de um mês antes de mudar); acabando, uma imagem de ~0,8–1 GB estoura os 500 MB do Free e o uso fica bloqueado. Saída nesse caso: tornar o pacote público ou rodar o `setup.sh` direto na VM.
- **Economia de minutos (Q29)**: critério de aceite da base: medir o "Initialize containers" com a imagem contra o `setup.sh` direto na VM. Se o pull não for mais rápido, a Q18' é reaberta.
- **Usuário da imagem (Q30)**: `useradd -u 1001` explícito, `USER 1001` no Dockerfile, `git` na imagem, sem `options: --user` no job. Rodar o `actions/checkout` v7 no container entra no mesmo critério de aceite.

## Answer

Decidido em 2026-10-18 com o usuário. Fatos em [research/25-harness-files.md](../research/25-harness-files.md).

**`AGENTS.md`** (inglês, < 200 linhas cada), só em três lugares:
- **raiz**: o que é o repo, com link para o `GLOSSARY.md`; mapa dos diretórios e "leia o `AGENTS.md` do pacote antes de editar ali"; comandos (`pnpm install`, `pnpm dev`, `pnpm generate`, `pnpm factory:verify`); regras (inglês, Conventional Commits com `#N`, nunca criar `CLAUDE.md`, não tocar em `.github/workflows/`, nunca alterar migration publicada, **sempre consultar a documentação oficial atual antes de usar uma API**, pelo `cloudflare-docs` ou por WebFetch, nunca a memória); "Building a product on the Skeleton" (`features/<app>/`, registro, `routes.<app>.ts`, `no-restricted-imports`, `pnpm sync-upstream`); "Agent skills". Sem nome de repo fixo: "infer the repo from `git remote`".
- **`app/`**: layout e interface `Feature`; regras de API (`operationId`/`summary`/`description`, `limit` padrão 50 + cursor, `x-mcp: false`, Better Auth fora); banco só acrescenta, `drizzle-kit check`; código gerado (Kubb e `openapi.json` fora do git, `routeTree.gen.ts` commitado, snapshot do `tools/list` no mesmo commit); o que cada camada de teste cobre e a tag `@evidence`; i18n; versões fixadas da stack; links para as skills `skeleton-*`.
- **`.factory/`**: os quatro seams e "toda mudança de comportamento vem com teste contra o adaptador falso"; os invariantes de segurança (o `work` sem token de forja e com env por allowlist; o `publish` com o harness da `main`; estado atual e não o evento; `--force-with-lease`; caminhos protegidos); o contrato com o produto; onde ficam prompts e `config.ts`. Um teste do harness falha se o job `work` do YAML receber `FACTORY_TOKEN`.

**i18n mínimo da UI do Skeleton** (revê "sem i18n" do mapa): `app/src/platform/i18n/en.ts` e `pt-BR.ts`, objeto tipado (o `tsc` pega a chave que faltar), idioma por variável de build `APP_LOCALE`, sem biblioteca. Emails usam o mesmo arquivo. A API devolve código de erro estável + mensagem em inglês; a SPA traduz pelo código; o MCP recebe o inglês. Cada feature de produto traz o seu `messages.ts`.

**Skills** (`.agents/skills`, com `.claude/skills/<x>` → `../../.agents/skills/<x>` por symlink; aviso de `core.symlinks` no Windows):
- do Matt, fixadas por SHA no `skills-lock.json`: `tdd`, `code-review`, `triage`, `implement`, `diagnosing-bugs`, `codebase-design`, `domain-modeling` (Factory) e `grilling`, `wayfinder`, `research`, `prototype`, `to-spec`, `to-tickets`, `setup-matt-pocock-skills`, `wizard`, `pr`, `writing-for-agents`, `handoff`, `git-guardrails-claude-code` (planejamento humano). As outras 19 saem.
- de fornecedor: `playwright-cli` e `workers-best-practices`.
- próprias, escritas pelo usuário com a base: `skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-add-feature`, `skeleton-evidence-test` (fora do lock).
- job `skills-check` no CI, com o CLI `skills` fixado: restaura do lock, `git diff --exit-code` e confere os symlinks (o `skills check` do CLI 1.7.2 altera arquivos).

**Claude Code**:
- `.mcp.json`: só `cloudflare-docs` e `shadcn` (stdio), sem segredo. Context7 fora. `cloudflare-api` e `neon` read-only documentados no `AGENTS.md` como `claude mcp add --scope local`. Sem `.codex/config.toml`.
- `.claude/settings.json`: `permissions.deny` para `Edit`/`Write` em `.github/workflows/**`, `.claude/**`, `.mcp.json`, `.agents/skills/**` e `skills-lock.json`; hook `PreToolUse` do `git-guardrails` em `.claude/hooks/`; sem `allow` e sem `env`. No modo bypass, `deny` e hooks valem e `allow` não faz nada; a checagem do diff no `publish` continua sendo a garantia.
- Sem subagents, sem settings só do CI (o Sandcastle 0.12.0 não deixa passar `--settings`).
- O adaptador `Agent` roda o Sandcastle num processo filho com env por allowlist (`PATH`, `HOME`, auth do Claude, `DATABASE_URL`, `CI`), porque o `noSandbox()` repassa o `process.env` inteiro. Com teste.

**Prompts** em `.factory/prompts/` (`development`, `review`, `triage`, `pr-feedback`, `update-branch`): inglês, templates com placeholders, chamam as skills pelo nome, repetem as regras duras (caminhos protegidos, nada de seams novos, `needs-human` + pergunta ao travar). O Development pode acrescentar ao `GLOSSARY.md`, mas não cria ADR (termina com `needs-human`).

**Workflows que saem**: `claude.yml` e `claude-code-review.yml`.

**`docs/agents/`**: `issue-tracker.md` sem repo fixo; `triage-labels.md` ganha a tabela "Factory labels" (`in-progress`, `agent:explore`, `harness-change`), da qual o bootstrap cria as labels.

**O que a Factory pode editar**:
- liberado, com label `harness-change` e aviso no topo do PR: `AGENTS.md`, `docs/agents/`, `GLOSSARY.md`, `docs/adr/`, `.factory/`;
- Escalation sem PR, com o patch no comentário: `.github/workflows/`, `.agents/skills`, `.claude/skills`, `skills-lock.json`, `.claude/settings.json`, `.mcp.json`. Esses só mudam por humano.

**Imagem de execução** (local e CI):
- `.factory/docker/Dockerfile`: `FROM ubuntu:24.04`, roda `.factory/setup.sh` (Node pelo `.node-version`, tarball oficial; pnpm via corepack; Claude Code na versão do `config.ts`; `git`; `npx playwright@<versão do lockfile> install --with-deps chromium`). `useradd -u 1001` e `USER 1001` (uid do `runner` no `ubuntu-latest`, dono do `/__w`); sem `docker` CLI. A imagem do Playwright foi descartada (três navegadores, ~2 GB, drift da tag).
- Tag = hash de `.node-version`, Playwright do lockfile, Claude Code do `config.ts`, `Dockerfile` e `setup.sh`.
- Job reaproveitável `image` (`workflow_call`, `packages: write`) antes de todo job que usa a imagem: calcula o hash no branch, confere a tag (`docker manifest inspect`), constrói e publica se faltar, devolve `needs.image.outputs.tag`. O PR que sobe uma versão testa com a imagem nova.
- Registry: GHCR do próprio repo, com a visibilidade do repo. Risco aceito: no privado, depende do "currently free" do GHCR; se acabar, pacote público ou `setup.sh` direto na VM. Sem `actions/attest` (no Free, só em repo público). Os jobs que usam a imagem pedem `packages: read`, porque o runner sempre faz login no ghcr.io com o token do job.
- Usam a imagem: o `work` da Factory e da Triage e o `build` do CI do PR, via `container: image: ${{ needs.image.outputs.tag }}`, Postgres por `services:` com `DATABASE_URL`, `defaults.run.shell: bash`, sem `options: --user`. Os outros jobs usam `setup-node` com cache do pnpm.
- Modo local: `pnpm factory local` calcula o mesmo hash, tenta `docker pull` e só constrói se a tag não existir.
- Forgejo (doc de migração): registry da instância; o token automático não lê pacotes, então imagem privada exige PAT em secret; o runner respeita o `USER` da imagem e nunca baixa de novo uma tag que já tem.

**Critérios de aceite da base**: medir o "Initialize containers" com a imagem contra o `setup.sh` direto na VM (se o pull não for mais rápido, a escolha da imagem é reaberta); rodar o `actions/checkout` v7 dentro do container com `USER 1001`.

## Revisão

O `AGENTS.md` de `app/` se divide em dois: o de `packages/skeleton/` e o que o molde do `new-product` gera em cada `apps/<id>/`. A skill `skeleton-*` de testes ganha a regra de localizar elementos por role + chave do i18n, nunca pelo texto. `runs-on` do `work` e do `build` aceita `vars.FACTORY_RUNNER`. Decidido em [Vários produtos num repo só](30-multi-product-repo.md).
