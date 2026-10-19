# 10: Execução local da Factory

Spec: [../spec.md](../spec.md)

**What to build:** o usuário escreve uma issue em Markdown local, roda `pnpm factory local NN` e vê a Factory de verdade (Claude, Sandcastle, `factory:verify`) resolver a issue num container descartável, deixando um branch local e a review, a evidência e o resultado nos comentários do arquivo. É a primeira vez que o loop roda com os adaptadores reais, antes de qualquer forja.

**Blocked by:** 08, 02

**Status:** ready-for-human

- [x] `Tracker` Markdown local (`Status:` = label, `Blocked by:`, `## Comments`; desbloqueada quando todas estão `done`) e `CodeHost` local (branch local, review e Escalation no `## Comments`, prints numa pasta de evidência), com testes próprios (seam 1).
- [x] `Agent` real: Sandcastle fixado com `noSandbox()` num processo filho, env por allowlist (`PATH`, `HOME`, auth do Claude, `DATABASE_URL`, `CI`), com teste que prova que nada mais vaza.
- [x] `Verify` real chamando `pnpm factory:verify`.
- [x] Prompts em `.factory/prompts/` (`development`, `review`, `triage`, `pr-feedback`, `update-branch`), em inglês, chamando as skills pelo nome e repetindo as regras duras.
- [x] Imagem `ubuntu:24.04` + `setup.sh` (Node pelo `.node-version`, pnpm via corepack, Claude Code do `config.ts`, `git`, Chromium do Playwright), `useradd -u 1001`, `USER 1001`, sem `docker` CLI; tag pelo hash das versões; `factory local` tenta `docker pull` e só constrói se faltar.
- [x] Container do agente com o repo por `git clone` (nunca bind-mount), só a auth do Claude, Postgres num container irmão em rede privada, sem o socket do Docker; o `publish` roda no host.
- [x] `stream-json` de cada sessão guardado junto da evidência.
- [ ] Demonstração: uma issue de teste em Markdown sobre o `example` chega a `ready` localmente; a issue, o branch e a evidência de teste são apagados no fim.

## Comments

Versões conferidas no registro do npm em 2026-10-19: `@ai-hero/sandcastle` **0.12.0** (2026-06-29, ainda a `latest`; fixada no catalog), `@anthropic-ai/claude-code` **2.1.303** (`latest`, 2026-10-18; `stable` = 2.1.292), posta em `config.ts` como `claudeCode.version` (`FACTORY_CLAUDE_CODE_VERSION`). Imagem: `ubuntu:24.04`, Node 24.22.0 (`.node-version`, tarball do nodejs.org conferido pelo `SHASUMS256.txt`), pnpm 12.14.0 por corepack 0.36.0, Playwright 1.64.1 (lido do `pnpm-lock.yaml`, Chromium 1248), git 2.43.0. Imagem final de 2,44 GB.

Como rodar: `pnpm --filter @factory/harness test` (91 testes, 13 arquivos). Testes novos: `markdown-tracker`, `local-code-host`, `sandcastle-agent` (Sandcastle de verdade com um `claude` falso no `PATH`: argv, stdin, env, commits, uso, timeout), `factory-verify` (o `pnpm` de verdade), `prompts`, `local-docker` (hash da imagem, pull/build e o `docker` roteirizado: sem `-v`/`--mount`/socket, segredo fora do argv, Postgres sem porta publicada, limpeza mesmo na falha) e `local` (`pnpm factory local 7` com o `work` de verdade num "container" falso). `TURBO_FORCE=1 pnpm factory:verify` verde.

Conferido à mão com o Docker local (sem auth do Claude): imagem construída e inspecionada (`uid=1001`, Node, pnpm, `claude --version`, Chromium, sem `docker`); `docker pull` do `ghcr.io/lucasmsoares96/factory-template/factory:<hash>` recusado (`denied`) → build, como previsto; uma issue Markdown de teste numa cópia temporária do repo passou por `claim` → container (bundle clonado, `pnpm install --frozen-lockfile` em 15 s, Postgres alcançável pelo nome `postgres` na rede `--internal`, internet pela `bridge`, sem mounts e sem `/var/run/docker.sock`) → `work` → Sandcastle → `claude` "Not logged in" → sem `result.json` → `publish` no host com Escalation `infra` no `## Comments` e o stream-json em `evidence/99/sessions/`. Containers, rede, imagens de teste e a cópia temporária foram apagados.

Como funciona:
- `FACTORY_ADAPTERS=local` em `src/adapters/index.ts`: Tracker Markdown sobre `FACTORY_TRACKER_DIR`, CodeHost local (branch empurrado com `--force-with-lease` para `FACTORY_LOCAL_REMOTE`, padrão o próprio repo), Sandcastle com stream-json em `FACTORY_SESSIONS_DIR`, `pnpm factory:verify`.
- `pnpm factory local NN [--issues <dir>]`: acha `.scratch/*/issues/NN-*.md` (ou `--issues`), exige `CLAUDE_CODE_OAUTH_TOKEN` ou `ANTHROPIC_API_KEY` antes de mexer na issue, roda o `claim` no host, manda ao container um `git bundle` do branch base + cópia dos tickets e do spec, e só a auth do Claude + as variáveis `FACTORY_*` do `config.ts` (nunca `FACTORY_TOKEN`; passadas por `-e NOME`, sem valor no argv). O `publish` roda no host num clone temporário que empurra para o repo do usuário.
- Tracker Markdown: `Status:` é a única label (`done`/`wontfix` = fechada), `Blocked by:` lista os bloqueadores, o link `Spec:` é o pai (número 0). Comentários da Factory ficam em blocos `<!-- factory:comment id author -->`; o resto de `## Comments` é um comentário do humano local (`$USER`), que sempre tem `write` e é quem pôs o `Status`. Localmente o machine user é `factory` se `FACTORY_MACHINE_USER` não estiver definido.
- CodeHost local: o "PR" da issue N é o número N, um comentário único editado no ticket (`<!-- factory:pr {...} -->`, draft/ready/closed, labels); review anexada como comentário com os inline; comentário de evidência único com links relativos e prints copiados para `.scratch/<feature>/evidence/NN/<product>/`; stream-json e log do Sandcastle em `evidence/NN/sessions/`. Sem threads; `dispatch` recusa.
- Agent: `SandcastleAgent` cria um processo filho Node (`src/adapters/sandcastle/session.ts`) com env = allowlist, que chama `run()` com `claudeCode(model, { captureSessions: false })`, `noSandbox()`, `branchStrategy: head`, `idleTimeoutSeconds` = timeout do Stage. Grupo de processos próprio: o timeout mata o agente e os filhos (Sandcastle #766). Saída e uso vêm do evento `result` do stream-json; tokens de entrada somam cache de escrita e leitura (a estimativa de custo erra para cima). Falha do Claude (auth, rede) lança erro → `work` sem `result.json` → Escalation `infra`.
- Imagem: `.factory/image/{Dockerfile,setup.sh}`; tag = 16 hex do sha256 de (versões, Dockerfile, setup.sh) em `src/local/image.ts`; nome padrão `ghcr.io/<owner>/<repo>/factory` pelo `origin` (sobrescrevível por `FACTORY_IMAGE_NAME`). `factory local` usa a imagem local, senão `docker pull`, senão `docker build`.
- Prompts: `.factory/prompts/{development,review,triage,pr-feedback,update-branch}.md` + `rules.md` (regras duras, incluído em todos por `{{RULES}}`); `src/prompts.ts` renderiza e recusa placeholder sem valor. `triage`, `pr-feedback` e `update-branch` já têm template e função, ligados nos tickets 17 e 18.

Desvios e notas:
- Allowlist exatamente `PATH`, `HOME`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `CI`. Como `COREPACK_HOME` e `PLAYWRIGHT_BROWSERS_PATH` não chegam ao agente, o `setup.sh` liga `~/.cache/node/corepack` e `~/.cache/ms-playwright` às instalações compartilhadas. No Actions o `HOME` vira `/github/home`: o ticket 16 precisa repetir esses links (ou acrescentar as duas variáveis à allowlist).
- pnpm 12 baixa o binário nativo no primeiro uso: o `setup.sh` roda `pnpm --version` como root para que ele fique em `/opt/corepack` (senão o uid 1001 falha com `EACCES`).
- O guard exige `## Acceptance criteria` no corpo: os tickets da base usam uma lista sem esse título, então uma issue para `factory local` precisa do título.
- O container recebe só o branch base **commitado** (bundle); mudanças não commitadas do host não entram. Enquanto a `main` não tiver a base, use `FACTORY_BASE_BRANCH=factory-base`.
- Triage local (`factory local` para `agent:explore`) fica para o ticket 17, que cria o comando `triage`.
- O cache do BuildKit da imagem não foi apagado (é compartilhado com os outros worktrees); as tags foram.

Pending (human): demonstração com o Claude de verdade, que precisa de `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) ou `ANTHROPIC_API_KEY`. Na raiz do repo, com Docker rodando:

```bash
mkdir -p .scratch/factory-demo/issues
printf '# Spec: demo\n\n## Testing Decisions\n\n1. Playwright E2E of the example Product, with an `@evidence` print.\n' > .scratch/factory-demo/spec.md
cat > .scratch/factory-demo/issues/01-demo-footer.md <<'EOF'
# 01: Footer on the example home page

Spec: [../spec.md](../spec.md)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## What to build

The example Product's home page shows a footer with the text "Built by the Factory".

## Acceptance criteria

- [ ] The home page of `apps/example` shows "Built by the Factory" in a footer.
- [ ] An `@evidence` Playwright test saves a print of the home page with the footer.
EOF
export CLAUDE_CODE_OAUTH_TOKEN=...   # from `claude setup-token`
FACTORY_BASE_BRANCH=factory-base pnpm factory local 1 --issues .scratch/factory-demo/issues
# Expect the last line: {"issue":1,"outcome":"ready",...}; check `git log factory-base..factory/issue-1`,
# the review/evidence in .scratch/factory-demo/issues/01-demo-footer.md and .scratch/factory-demo/evidence/01/.
# Clean up:
rm -rf .scratch/factory-demo && git branch -D factory/issue-1
```
