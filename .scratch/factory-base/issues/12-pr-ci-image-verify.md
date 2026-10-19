# 12: CI do PR: imagem e `verify` por Product afetado

Spec: [../spec.md](../spec.md)

**What to build:** todo PR roda o `verify` só dos Products afetados, dentro da imagem publicada no GHCR, sem nenhum secret, e o check `verify` fica verde ou vermelho no PR. O CI também confere as skills e cria um Product descartável para provar que o molde continua verde.

**Blocked by:** 10, 11

**Status:** ready-for-human

- [ ] Job reaproveitável `image` (`packages: write`): calcula o hash, confere a tag no GHCR, constrói e publica só se faltar, devolve a tag. O PR que sobe uma versão testa com a imagem nova.
- [ ] Job `build` em `container:` da imagem, `contents: read`, `packages: read`, `persist-credentials: false`, sem cache e sem secrets, Postgres por `services:`, `runs-on` aceita `vars.FACTORY_RUNNER`.
- [ ] Checkout com `--filter=blob:none`; `turbo query affected --packages` monta a matrix (`fail-fast: false`); arquivos da raiz em `globalDependencies`; mudanças só em `.factory/` ou `.github/` rodam os testes do harness.
- [ ] Job `skills-check` com o CLI `skills` fixado: restaura do lock, `git diff --exit-code`, confere symlinks.
- [ ] Job `ci-probe`: `new-product ci-probe` numa cópia temporária + `verify`, sem deploy, cópia apagada no fim.
- [ ] Saem `claude.yml` e `claude-code-review.yml`.
- [x] Testes estáticos do YAML: `build` só em `container:` e só ele (com o `work`, depois) aceita `vars.FACTORY_RUNNER` (seam 2).
- [ ] Critérios medidos e registrados aqui: "Initialize containers" com a imagem × `setup.sh` direto na VM (se não for mais rápido, reabrir a escolha); `actions/checkout` no container com `USER 1001`; visibilidade com que o pacote do GHCR nasce num repo público e leitura com `packages: read`.

## Comments

Implementado em 2026-10-19. **Versões:** `yaml` **2.9.1** (catalog; só para os testes estáticos; publicada em 2026-09-11) e ações fixadas por SHA, lidas com `gh api` em 2026-10-19: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `docker/login-action` v4.6.0, `docker/build-push-action` v7.4.0, `docker/setup-buildx-action` v4.4.1; CLI `skills` 1.7.2 (decisão do ticket 11). `turbo query affected --packages --base --head` conferido em turbo 2.11.9 (devolve também o pacote raiz `//`, que o script descarta).

**Feito fora dos caminhos protegidos** (`.factory/test/ci.test.ts` e `ci-workflows.test.ts`; `TURBO_FORCE=1 pnpm factory:verify` verde):
- `.factory/src/ci/image.ts`: hash e referência da imagem para o job `image`, reaproveitando `local/image.ts` (a mesma tag que `pnpm factory local` puxa); nome `ghcr.io/<owner>/<repo>/factory` a partir de `GITHUB_REPOSITORY`.
- `.factory/src/ci/matrix.ts`: a matrix dos pacotes afetados; `.github/` ou `.factory/` mudados selecionam `@factory/harness`.
- `.factory/src/ci/skills.ts`: confere os symlinks de `.claude/skills`. `skills@1.7.2 experimental_install` numa cópia só com `skills-lock.json`, `.agents` e `.claude/skills` não deixou diff nem arquivo novo.
- `turbo.json`: `scripts/verify.ts` entrou em `globalDependencies` (os outros arquivos da raiz já estavam).
- Testes estáticos (seam 2) sobre `WORKFLOWS_DIR`, uma constante só em `ci-workflows.test.ts`.

**Os workflows estão em `.scratch/factory-base/pending/ticket-12/`** (`factory-image.yml`, `factory-pr.yml`, `README.md`), porque o `deny` do ticket 11 bloqueia `.github/workflows/**`; não contornei. Os testes leem esse diretório e passam; depois de instalar, troque a constante por `.github/workflows`. Os critérios dos jobs e do checkout/matrix ficam desmarcados até a instalação e o primeiro PR verde (o script e os testes deles estão prontos).

**Decisões:**
- `verify` é um job agregador (`needs` de todos, `if: always()`): o check obrigatório da `main` precisa de nome fixo e a matrix de `build` gera um check por pacote. Um `build` pulado (nenhum pacote afetado) conta como verde.
- `pull_request_target` carrega o workflow reaproveitável da base. O `image` usa o commit do head só em PR do próprio repo; PR de fork usa a imagem do commit base, para o `setup.sh` de um fork nunca rodar com `packages: write`.
- `plan` roda no container (precisa do turbo); `skills-check` na VM, só com `setup-node`; `ci-probe` na imagem (precisa do Chromium do e2e), com Postgres por `services:`.
- O container autentica no GHCR com `github.token` (não é secret).

Pending (human): 1. Instalar os workflows e remover os dois antigos: os três comandos em `.scratch/factory-base/pending/ticket-12/README.md`, depois trocar `WORKFLOWS_DIR` para `.github/workflows` no teste. Fecha os critérios de `image`, `build`, checkout/matrix, `skills-check`, `ci-probe` e a saída de `claude.yml`/`claude-code-review.yml`.
Pending (human): 2. Medir "Initialize containers" com a imagem × `setup.sh` direto na VM: num PR de teste, ler a duração do passo "Initialize containers" do job `build`; num job de teste na VM, cronometrar `bash .factory/image/setup.sh` (com as quatro variáveis). Se o pull não for mais rápido, reabrir a escolha da imagem. Apagar o PR de teste.
Pending (human): 3. `actions/checkout` no container com `USER 1001`: ver se o checkout do `build` passa sem `options: --user` e sem erro de `safe.directory` ou de permissão no workspace.
Pending (human): 4. Visibilidade do pacote no GHCR: depois do primeiro `image`, ver em Packages se o pacote nasceu público ou privado num repo público, se está ligado ao repo (label `org.opencontainers.image.source`) e se o `build` com `packages: read` puxa a imagem. Se não ligar, "Manage Actions access".
Pending (human): 5. Ruleset da `main` exigindo o check `verify`, depois do primeiro PR verde.
