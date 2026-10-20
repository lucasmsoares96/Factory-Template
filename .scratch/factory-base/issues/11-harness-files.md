# 11: Arquivos de harness

Spec: [../spec.md](../spec.md)

**What to build:** um agente que abre o repo (o Claude Code local ou a Factory) encontra as instruções, as skills e as travas certas: `AGENTS.md` em cada nível, só as skills que o Template usa, MCPs sem segredo e um `.claude/settings.json` que bloqueia os caminhos protegidos e os comandos git perigosos.

**Blocked by:** 07, 10

**Status:** done

- [x] `AGENTS.md` (inglês, < 200 linhas) na raiz, no Skeleton, no molde do Product e em `.factory/`, com o conteúdo da spec; nenhum `CLAUDE.md`; sem nome de repo fixo.
- [x] Skills em `.agents/skills` com `.claude/skills/<x>` por symlink: as 19 do Matt da lista decidida (a spec e este ticket diziam 18 por erro de contagem; a lista nominal do ticket 25 do wayfinder, `issues/25-harness-files.md`, nomeia 19), `playwright-cli` e `workers-best-practices` fixadas no `skills-lock.json`; as outras saem.
- [x] Skills próprias `skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-add-feature` e `skeleton-evidence-test` (com a regra de localizar por role + chave do i18n), fora do lock.
- [x] `.mcp.json` com `cloudflare-docs` e `shadcn`; `cloudflare-api` e `neon` read-only documentados como `claude mcp add --scope local`.
- [x] `.claude/settings.json` com `deny` de `Edit`/`Write` nos caminhos protegidos e de `Bash(pnpm bootstrap destroy:*)`, e hook `PreToolUse` do `git-guardrails`; sem `allow`, `env` ou subagents.
- [x] `docs/agents/issue-tracker.md` sem repo fixo; `triage-labels.md` com a tabela "Factory labels" (`in-progress`, `agent:explore`, `harness-change`, `preview`, `product:<id>`).
- [x] Testes estáticos: tabelas de labels iguais ao `config.ts`, `deny` presente (seam 2).

## Comments

Implementado em 2026-10-19. Nenhuma dependência nova no catalog. Conferido: CLI `skills` **1.7.2** (a `latest` 1.7.4 saiu hoje; a pesquisa 25 usou 1.7.2 e `experimental_install` é experimental, então fica fixada em 1.7.2 para o `skills-check` do ticket 12), `shadcn` **4.22.1** (igual ao catalog; fixado no `.mcp.json` em vez de `@latest`), docs do Claude Code sobre `permissions` (regras de caminho) e dos MCPs da Cloudflare e da Neon, todas lidas em 2026-10-19.

**As skills do Matt.** A spec e este ticket dizem "18", mas a lista decidida no ticket 25 do wayfinder (`issues/25-harness-files.md`, linhas "Skills do Matt no template", e `research`/mapa) nomeia **19** (7 usadas pela Factory + 12 de planejamento humano) e diz "as outras 19 saem" (38 no lock, 38 - 19 = 19). Mantive os 19 nomes, porque a lista nominal manda e o "18" é erro de contagem: `tdd`, `code-review`, `triage`, `implement`, `diagnosing-bugs`, `codebase-design`, `domain-modeling`, `grilling`, `wayfinder`, `research`, `prototype`, `to-spec`, `to-tickets`, `setup-matt-pocock-skills`, `wizard`, `pr`, `writing-for-agents`, `handoff`, `git-guardrails-claude-code`. Saíram as outras 19 (`ask-matt`, `chief-of-staff`, `claude-handoff`, `grill-me`, `grill-with-docs`, `implement-spec`, `improve-codebase-architecture`, `loop-me`, `migrate-to-shoehorn`, `retro`, `scaffold-exercises`, `setup-pre-commit`, `setup-ts-deep-modules`, `teach`, `to-questionnaire`, `wait-what`, `writing-beats`, `writing-fragments`, `writing-shape`). Se o usuário quiser 18, tire uma da lista no teste (`MATT` em `.factory/test/harness-files.test.ts`), no `skills-lock.json` e em `.agents/skills`.

**Skills.** `.claude/skills/<x>` eram cópias; agora são symlinks `../../.agents/skills/<x>` (21 no lock + 4 `skeleton-*` fora do lock = 25 pastas). `playwright-cli` veio de `microsoft/playwright-cli` e `workers-best-practices` de `cloudflare/skills`, instaladas com `npx skills@1.7.2 add <fonte> --skill <nome> -a claude-code -y` (o CLI copiou para `.claude/skills/`; movi para `.agents/skills/` e fiz o symlink). `npx skills@1.7.2 experimental_install` numa pasta vazia com só o `skills-lock.json` reproduz as 21 sem diferença (o que o `skills-check` do ticket 12 vai rodar; ele não cria os symlinks, o `git diff` os cobre). As `skeleton-*` descrevem a `Feature`, o `createRoute` do `me/api.ts`, o `db:generate` e o `evidence()` do E2E como estão no código. Limite achado: `defineE2EConfig` só roda os specs de `packages/skeleton/e2e/specs/`; não há diretório de specs por Product. A skill `skeleton-evidence-test` diz isso (crescer o `defineE2EConfig` num ticket à parte ou `needs-human`).

**`.mcp.json`.** `cloudflare-docs` (`https://docs.mcp.cloudflare.com/mcp`) e `shadcn` (`npx shadcn@4.22.1 mcp`), sem segredo. `cloudflare-api` (token só de leitura em `Authorization: Bearer`) e `neon` (`https://mcp.neon.tech/mcp?readonly=true`) estão em `docs/agents/mcp.md` como `claude mcp add --scope local`.

**`.claude/settings.json`.** Só `permissions.deny` e `hooks.PreToolUse`; sem `allow`, `env` nem subagents. Desvios:
- `deny` usa só `Edit(...)`: pelas docs do Claude Code, só regras `Edit`/`Read` são consultadas para caminhos, e `Edit(path)` vale para `Write` também; uma regra `Write(path)` é aceita mas ignorada e gera aviso na partida. Os caminhos são ancorados na raiz do projeto (`/path`), certo em worktree.
- `Edit(/.claude/**)` cobre `settings.json`, `skills/` e `hooks/`. Por isso `.claude/hooks` entrou em `PROTECTED_PATHS` (`.factory/src/paths.ts`), no `rules.md` do prompt e nos `AGENTS.md`: trocar o hook enfraqueceria a trava, é o mesmo risco do settings. O teste exige que cada entrada de `PROTECTED_PATHS` tenha uma regra `Edit` que a cubra.
- O hook é Node (`.claude/hooks/block-dangerous-git.mjs`, executável, chamado por `node "$CLAUDE_PROJECT_DIR/..."`), não o `.sh` com `jq` da skill: a imagem da Factory não tem `jq`. Ele lê o comando como shell (aspas, `$()`, crases, heredoc, `bash -c`, `eval`, `env`/`sudo`/`xargs`), então `git commit -m "... git push ..."` não é bloqueado, e `cd x && git push` é. Se o `node` faltar, o hook falha com código diferente de 2 e a trava some (aceito: o repo exige Node 24). Alias de git (`git -c alias.p=push p`) não é visto.
- Decisão sobre restaurar arquivos: `git checkout [<tree>] -- <caminho>` e `git restore <caminho>` **são permitidos** (desfazer a própria edição, por exemplo recolocar uma migration publicada, é seguro e preciso); `git checkout -- .`, `git checkout .`, `git restore .` (e `*`, `:/`) continuam bloqueados. `git checkout <nome>` sem `--` é tratado como troca de branch e bloqueado. `git branch -d`, `git branch <nome>`, `git worktree add/remove/list`, `merge`, `commit`, `add`, `status`, `log`, `diff` passam.

**Bloqueado para quem trabalha com o settings carregado (ticket 12, leia).**
- Tool `Edit`, `Write` e `NotebookEdit` (e `sed -i`, `tee`, redirecionamento `>` que o Claude Code reconhece no Bash) nestes caminhos: `.github/workflows/**` (inclui criar um arquivo novo lá), `.agents/skills/**`, `.claude/**`, `skills-lock.json`, `.mcp.json`. Isso inclui `.github/workflows/claude.yml`, `claude-code-review.yml` e os `factory-*.yml` novos do ticket 12.
- `Bash(pnpm bootstrap destroy ...)`.
- Bash: `git push`, `reset --hard`, `clean`, `branch -D/-f/-M`, `checkout`/`switch` para outro branch, `checkout -- .`, `restore .`.
- Não bloqueado: `Bash` que escreve arquivo sem nome reconhecido (`python`, `node -e`, `cp`, `mv`, `rm`, `git rm`, `git apply`), então o `deny` não é a garantia (a checagem do diff no `publish` é). Mesmo assim, o ticket 12 **não deve** contar com isso de dentro de uma sessão do Claude Code com o settings carregado.
- Como contornar no ticket 12: o orquestrador roda o ticket 12 sem o `.claude/settings.json` (por exemplo, o worktree do ticket 12 parte de `factory-base` antes do merge deste ticket, ou o implementador roda com `--settings` próprio), ou um humano aplica a mudança em `.github/workflows/`. Os testes de seam 2 do ticket 12 podem ler os YAML normalmente.

Testes: `harness-files.test.ts` (112 casos: `AGENTS.md` < 200 linhas e sem nome de repo, sem `CLAUDE.md` em lugar nenhum, o `AGENTS.md` do `example` igual à saída do molde, tabelas de labels iguais ao `config.ts`, 25 skills + symlinks + lock, `.mcp.json` sem credencial, `deny` cobrindo cada `PROTECTED_PATHS` e o `destroy`, `settings` sem `allow`/`env`, e o hook com 42 comandos bloqueados e 39 permitidos pelo stdin como o Claude Code manda). `TURBO_FORCE=1 pnpm factory:verify` verde.

Pending (human): nenhum item deste ticket. Para o usuário decidir: 18 ou 19 skills do Matt (acima); o Windows precisa de `core.symlinks=true` para os symlinks de `.claude/skills`.
