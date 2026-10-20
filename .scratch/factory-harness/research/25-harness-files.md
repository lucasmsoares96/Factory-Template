# Imagem do container, permissões do Claude Code e ferramentas do harness

Ticket: [25-harness-files](../issues/25-harness-files.md)
Pesquisado em: 2026-10-18

Versões consultadas:
- Imagem `mcr.microsoft.com/playwright:v1.64.1` (= `v1.64.1-noble`, digest `sha256:7852dc5a…`, criada em 2026-10-14). `@playwright/test` **1.64.1** foi publicado no npm em 2026-10-14. Os Dockerfiles foram lidos na tag `v1.64.1` de `microsoft/playwright`.
- Claude Code **2.1.303** (`latest` no npm em 2026-10-18; `stable` = 2.1.292). Lidos o binário `@anthropic-ai/claude-code-linux-x64@2.1.303` e as docs de code.claude.com em 2026-10-18. As páginas não trazem data de revisão.
- `@ai-hero/sandcastle` **0.12.0** (npm, 2026-06-29). A `main` estava no commit `703dcf1` (2026-10-18), ainda com `version: 0.12.0`.
- `actions/runner` **v2.338.0** (2026-10-06), `actions/upload-artifact` **v7.0.2** (2026-10-07). Docs do GitHub lidas em 2026-10-18.
- `forgejo-runner` **v13.2.0** (2026-09-18). Docs `forgejo.org/docs/next` lidas em 2026-10-18.
- Context7: servidor `https://mcp.context7.com/mcp` testado em 2026-10-18. README em `upstash/context7` (release mais recente `ctx7@0.8.0`, 2026-10-16).
- CLI `skills` (vercel-labs/skills) **1.7.2** (npm e GitHub, 2026-10-09). A `main` está 2 commits à frente.

Legenda: **Fonte diz** = afirmação da fonte primária ou verificada direto no código ou artefato. **Inferência** = conclusão minha. **Desconhecido** = não achei fonte.

## 1. Imagem oficial do Playwright (`mcr.microsoft.com/playwright`)

**Fonte diz:**
- **Tag estável mais recente: `v1.64.1`**, com as variantes `-noble`, `-jammy` e `-resolute`, cada uma também com sufixos `-amd64` e `-arm64`. Fonte: [lista de tags do MCR](https://mcr.microsoft.com/v2/playwright/tags/list), consultada em 2026-10-18. A tag `v1.64.1` do GitHub foi publicada em 2026-10-14 ([release](https://github.com/microsoft/playwright/releases/tag/v1.64.1)).
- **A tag sem sufixo é Ubuntu 24.04 (noble).** O `publish_docker.sh` só acrescenta `${VERSION_TAG}` sem sufixo à lista do noble, e só no canal stable. Existem também `-jammy` (22.04) e **`-resolute` (26.04)**. Fontes: [publish_docker.sh@v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/publish_docker.sh) e [docker.md, Image tags](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/docker.md#image-tags). Conferi que `v1.64.1` e `v1.64.1-noble` têm o mesmo digest no registry.
- **`latest` está congelada.** A tag `latest` ainda existe, mas aponta para uma imagem jammy criada em **2024-08-16**. O script de publicação atual não empurra mais `latest`. Fonte: config da imagem lida pela API do registry (`/v2/playwright/manifests/latest`) e o mesmo `publish_docker.sh`.
- **As tags seguem a versão do pacote npm.** `VERSION_TAG="v${PW_VERSION}"` vem da versão do workspace, e o canal stable recusa versões com `-`. A doc manda fixar: "It is recommended to always pin your Docker image to a specific version… If the Playwright version in your Docker image does not match the version in your project/tests, Playwright will be unable to locate browser executables." A imagem **não traz** o pacote `@playwright/test`, só os browsers em `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`). Fontes: [publish_docker.sh](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/publish_docker.sh) e [docker.md](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/docker.md).
- **O Node vem do NodeSource, `NODE_VERSION=24`.** O Dockerfile também instala `git openssh-client zstd` ("Feature-parity with node.js base images. zstd is used by actions/cache"), `yarn` global e cria `adduser pwuser`. Ele **não tem diretiva `USER`**. Fonte: [Dockerfile.noble@v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/Dockerfile.noble).
- **Verificado rodando a imagem** (`docker run mcr.microsoft.com/playwright:v1.64.1-noble`, 2026-10-18):
  - `uid=0(root)`;
  - Ubuntu 24.04.5 LTS;
  - Node **v24.21.0**, npm 11.19.0;
  - **`corepack` 0.36.0 presente** em `/usr/bin/corepack`;
  - git 2.43.0;
  - `pwuser` com **uid/gid 1001**;
  - browsers chromium-1248, firefox-1555 e webkit-2370.

  **Não há** `sudo`, `gh`, `psql` nem `docker` na imagem.
- **O usuário padrão é root.** A doc diz: "By default, the Docker image will use the `root` user to run the browsers. This will disable the Chromium sandbox… If you run trusted code (e.g. End-to-end tests)… the root user may be fine." Para código não confiável, ela recomenda `--user pwuser` mais `seccomp_profile.json`. Recomenda também `--init` e `--ipc=host`. Fonte: [docker.md](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/docker.md).
- O exemplo oficial de GitHub Actions usa `container: image: mcr.microsoft.com/playwright:v<ver>-noble` com `options: --user 1001`. Fonte: [ci.md, Via Containers](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/ci.md).
- O Node 24 ainda distribui o corepack, que só deixa de vir junto a partir do Node 25. Fonte: [doc/api/corepack.md na branch v24.x](https://github.com/nodejs/node/blob/v24.x/doc/api/corepack.md).

**Inferência:**
- O uid 1001 do `pwuser` coincide com o usuário `runner` do `ubuntu-latest`. É por isso que o exemplo oficial usa `--user 1001`: os arquivos do workspace montado ficam com o mesmo dono.
- O runner hospedado vem com Node 22 por padrão ([ver pesquisa 01](01-sandcastle-hosted-runner.md)), e a imagem traz Node 24. Para manter local e CI iguais, a versão de Node deve vir de um lugar só, por exemplo `engines` ou `.node-version`, com `setup-node` no CI.
- Para "ficar em dia", o natural é ter uma única fonte de versão: a versão de `@playwright/test` no lockfile define a tag `v<ver>-noble`. Um check no CI compara as duas.

## 2. Claude Code: `--dangerously-skip-permissions` como root

**Fonte diz:**
- A doc diz: "On Linux and macOS, Claude Code refuses to start in `bypassPermissions` mode when running as root or under `sudo`… The check is skipped automatically inside a recognized sandbox. To run autonomously in a container, use the dev container configuration, which runs Claude Code as a non-root user." Fonte: [permission-modes, Skip all checks](https://code.claude.com/docs/en/permission-modes#skip-all-checks-with-bypasspermissions-mode). A página de dev container também diz: "The CLI rejects this flag when launched as root" ([devcontainer](https://code.claude.com/docs/en/devcontainer)).
- **No código da 2.1.303**, a condição é `process.getuid()===0 && process.env.IS_SANDBOX!=="1" && !CLAUDE_CODE_BUBBLEWRAP`. Quando ela vale, o CLI imprime a mensagem e faz `process.exit(1)`. Há um segundo caminho, `isRootOutsideDeliberateSandbox()`, que testa `platform!=="win32" && getuid()===0 && !isSandboxEnvSet() && !isBubblewrapEnvSet()`. Fonte: strings do binário `@anthropic-ai/claude-code-linux-x64@2.1.303`, na [página npm](https://www.npmjs.com/package/@anthropic-ai/claude-code).
- **Verificado na imagem do Playwright** com Claude Code 2.1.303:
  - como root, sem variável: `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`;
  - como root com `IS_SANDBOX=1`: passa da checagem e para em `Not logged in`;
  - como `pwuser`: também passa da checagem.

**Desconhecido:**
- **`IS_SANDBOX` não aparece na doc pública** ([env-vars](https://code.claude.com/docs/en/env-vars) não o lista). A doc fala só em "recognized sandbox". É um comportamento não documentado e pode mudar. O caminho documentado é rodar como usuário não-root.

## 3. Claude Code: o que ainda vale em `bypassPermissions`

**Fonte diz:**
- **Regras `deny` continuam valendo:** "Deny rules block in every mode, including `bypassPermissions`… Allow rules have no effect in `bypassPermissions`." Fonte: [permission-modes](https://code.claude.com/docs/en/permission-modes).
- **Hooks PreToolUse:**
  - Eles rodam "before the permission prompt, for every tool except EndConversation". Fonte: [permissions, Extend permissions with hooks](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks).
  - Exit code 2 em `PreToolUse` "Blocks the tool call", e "A hook that blocks by exiting 2 routes the same way as `\"deny\"`". Fonte: [hooks, Exit code 2](https://code.claude.com/docs/en/hooks#exit-code-2-behavior-per-event) e [PreToolUse decision control](https://code.claude.com/docs/en/hooks#pretooluse-decision-control).
  - O input do hook traz `permission_mode` com o valor `"bypassPermissions"`. Fonte: [hooks, input comum](https://code.claude.com/docs/en/hooks).
- **Sob `-p`:** "Without `--bare`, a `-p` session runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted." `--bare` pula hooks, skills, plugins e MCP. Fonte: [headless](https://code.claude.com/docs/en/headless). O Sandcastle não passa `--bare` (seção 4).
- **`--settings <arquivo|json>` combina com qualquer flag de modo.** Ele entra acima de user, project e local e abaixo de managed. "Lists merge instead of overriding", ou seja, um `permissions.deny` vindo de `--settings` **soma** ao do `.claude/settings.json`. Fontes: [cli-reference](https://code.claude.com/docs/en/cli-reference#cli-flags) e [settings, precedence e Lists merge](https://code.claude.com/docs/en/settings#settings-precedence).
- Também continuam valendo em bypass:
  - as "actions no mode auto-approves";
  - `rm` em critical paths (em `-p`, isso vira negação);
  - `permissions.blockReadsOutsideWorkingDirectories`.

  Fonte: [permission-modes](https://code.claude.com/docs/en/permission-modes#actions-no-mode-auto-approves).
- `permissions.defaultMode: "bypassPermissions"` **não tem efeito** em `.claude/settings.json` nem em `settings.local.json`. Só vale em user, `--settings` ou managed settings. Fonte: [permission-modes](https://code.claude.com/docs/en/permission-modes).

**Inferência:** em `bypassPermissions`, `deny` em `.claude/settings.json` e hooks PreToolUse (por exemplo, `git-guardrails`) são as travas que sobram. Uma allowlist (`allow`) **não** restringe nada nesse modo. Para restringir por allowlist, troque o modo: `permissionMode: "dontAsk"` ou `"auto"` no `claudeCode()`.

## 4. Sandcastle

**Fonte diz:**
- A versão é **0.12.0** (npm, 2026-06-29). A `main` em `703dcf1` (2026-10-18) continua com 0.12.0. Fonte: `npm view @ai-hero/sandcastle` e [package.json](https://github.com/mattpocock/sandcastle/blob/main/package.json).
- **Dockerfile padrão** do `init` para Claude Code, igual na v0.12.0 e na `main`:
  - `FROM node:22-bookworm`;
  - `apt-get install git curl jq`;
  - `gh` via apt da GitHub;
  - renomeia o usuário `node` para **`agent`**, com `AGENT_UID`/`AGENT_GID` (padrão 1000, que o `sandcastle docker build-image` alinha ao host);
  - `USER ${AGENT_UID}`;
  - Claude Code via `curl -fsSL https://claude.ai/install.sh | bash`;
  - `ENTRYPOINT ["sleep","infinity"]`, com o worktree montado em `/home/agent/workspace`.

  **Não tem** browsers do Playwright nem Postgres. Fonte: [.sandcastle/Dockerfile](https://github.com/mattpocock/sandcastle/blob/v0.12.0/.sandcastle/Dockerfile) e [src/InitService.ts](https://github.com/mattpocock/sandcastle/blob/v0.12.0/src/InitService.ts).
- **`claudeCode(model, options)` não aceita argumentos extras nem arquivo de settings.** `ClaudeCodeOptions` tem só `effort`, `env`, `captureSessions`, `sessionStorage` e `permissionMode`. O comando é fixo: `claude --print --verbose[ --permission-mode X | --dangerously-skip-permissions] --output-format stream-json --model M [--effort] [--resume] [--fork-session] -p -`. Fonte: [src/AgentProvider.ts](https://github.com/mattpocock/sandcastle/blob/main/src/AgentProvider.ts) (linhas 1155–1215 na `main`).
- Há um PR aberto, [#927 "Add extraArgs escape hatch to claudeCode() provider"](https://github.com/mattpocock/sandcastle/issues/927), de 2026-07-21, que cita `--settings`, `--mcp-config` e `--strict-mcp-config`. Ainda **não foi mergeado**.
- **Saídas possíveis hoje:**
  - O tipo `AgentProvider` é exportado ([src/index.ts](https://github.com/mattpocock/sandcastle/blob/main/src/index.ts)), com `buildPrintCommand(): { command, stdin }`. Dá para embrulhar o `claudeCode()` e reescrever `command`.
  - Ou dá para usar arquivos que o Claude Code lê sozinho: `.claude/settings.json` do worktree, `~/.claude/settings.json` ou managed settings.
- **Repasse de env:**
  - Providers de agente e de sandbox aceitam `env`, e os dois não podem ter chaves em comum.
  - O resolver lê `.sandcastle/.env`, com fallback em `process.env` só para as chaves declaradas ali.
  - **`noSandbox()` repassa `process.env` inteiro** (`{ ...process.env, ...createOptions.env }`).

  Fontes: [README, Provider env](https://github.com/mattpocock/sandcastle/blob/main/README.md#provider-env), [src/EnvResolver.ts](https://github.com/mattpocock/sandcastle/blob/main/src/EnvResolver.ts) e [src/sandboxes/no-sandbox.ts](https://github.com/mattpocock/sandcastle/blob/main/src/sandboxes/no-sandbox.ts) (linha 51).

**Inferência:** com `noSandbox()`, todo secret do job chega ao agente. Para o container local, a regra "só auth do Claude entra" precisa ser garantida no `docker run` (lista explícita de `-e`), não no Sandcastle.

## 5. GitHub Actions `container:` + `services:` e Forgejo

**Fonte diz (GitHub):**
- `container:` e `services:` no mesmo job é o caminho documentado. Job e serviços ficam numa bridge network definida pelo usuário, e o serviço é acessado pelo **nome do label** (`postgres`), sem mapear portas. No host, seria `localhost:<porta mapeada>`. Exige runner Linux. Fontes: [Creating PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) e [Communicating with Docker service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers).
- No container, o shell padrão de `run` é `sh`, não `bash`. `options` aceita flags de `docker create`, **exceto `--network` e `--entrypoint`**. Fonte: [Running jobs in a container](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container).
- O runner monta no job container o workspace (`/__w`), `externals` (`/__e`, onde está o Node que roda actions JS como `upload-artifact`), temp, tools e `HOME=/github/home`. O entrypoint é `tail -f /dev/null`. Fonte: [ContainerOperationProvider.cs](https://github.com/actions/runner/blob/main/src/Runner.Worker/ContainerOperationProvider.cs).
- **O socket do Docker do host É montado no job container:** `if (this.IsJobContainer) MountVolumes.Add(new MountVolume("/var/run/docker.sock", "/var/run/docker.sock"))`. Fonte: [ContainerInfo.cs](https://github.com/actions/runner/blob/main/src/Runner.Worker/Container/ContainerInfo.cs) (linha 59). A imagem do Playwright não tem o CLI `docker`, mas o socket fica acessível.
- Actions do tipo Docker devem rodar como root ("Do not use the `USER` instruction… you won't be able to access the `GITHUB_WORKSPACE`"). Fonte: [Dockerfile support](https://docs.github.com/en/actions/reference/workflows-and-actions/dockerfile-support#user). Isso vale para actions Docker, não para o job container, que o Playwright roda com `--user 1001`.

**Inferência:**
- `actions/upload-artifact` (v7.0.2) é action JS e roda com o Node de `/__e`, que exige glibc. Na imagem noble, que é glibc, deve funcionar.
- O job container **não** isola o agente do host. Com o socket montado e `docker` instalável via `curl`, root no container vira root na VM. A VM é efêmera, mas isso derruba a premissa de "socket nunca montado" no CI. No local (`docker run` nosso), basta não passar `-v /var/run/docker.sock`.
- Como root no container, o Claude Code exige `IS_SANDBOX=1` (seção 2). Com `options: --user 1001`, o problema some, mas `sudo` não existe na imagem.

**Fonte diz (Forgejo):**
- `forgejo-runner` **v13.2.0** (2026-09-18). Fonte: [releases](https://code.forgejo.org/forgejo/runner/releases).
- **`jobs.<id>.container` e `jobs.<id>.services` são suportados.** O serviço é acessado pelo nome da chave (exemplo `psql -h pgsql`).
  - `container.options` aceita **só** `--volume`, `--tmpfs`, `--hostname` e `--memory`. Portanto **não aceita `--user` nem `--ipc=host`**.
  - Há campos próprios: `entrypoint`, `init`, `tty`, `credentials` e `volumes` (restritos a `valid_volumes`).
  - A doc avisa: "container images, once downloaded, are never updated", e recomenda pinar por digest.

  Fonte: [Forgejo Actions reference](https://forgejo.org/docs/next/user/actions/reference/).
- No `config.example.yaml`, o padrão é `docker_host: "-"` ("no docker host will be mounted in the job container"), `privileged: false` e `valid_volumes: []`. Fonte: [config.example.yaml@v13.2.0](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/pkg/config/config.example.yaml).
- Para artifacts no Forgejo, ver a contradição v4/v7 já registrada em [14-forgejo-portability](14-forgejo-portability.md) (A7/R3).

**Inferência:** no Forgejo, a imagem do Playwright roda como root. Sem `--user`, o caminho para o Claude Code é `IS_SANDBOX=1`, ou um passo `su pwuser -c …` / `setpriv` dentro do job.

## 6. Context7 MCP sem API key

**Fonte diz:**
- **Funciona sem chave.** Testei em 2026-10-18 com `initialize`, `tools/list` e `tools/call resolve-library-id` em `https://mcp.context7.com/mcp`, sem header de auth. As respostas vieram normais (por exemplo, `/microsoft/playwright`).
- Limites sem chave: "**Without API key**: Low rate limits and no custom configuration. **With API key**: Higher limits based on your plan." Acima do limite, a resposta é `429` com `Retry-After`. **Nenhum número** é publicado para o modo anônimo. Fonte: [API Guide, Rate Limits](https://context7.com/docs/api-guide#rate-limits). O README diz: "API Key Recommended: Get a free API key… for higher rate limits" ([README](https://github.com/upstash/context7/blob/master/README.md)).
- Com chave grátis: 1.000 chamadas/mês. Depois disso a conta fica bloqueada, com 20 chamadas bônus por dia. Pro custa US$ 10/seat com 2.000 chamadas. Fonte: [Plans & Pricing](https://context7.com/docs/plans-pricing).
- No headless/CI, a chave vai em `Authorization: Bearer <key>` (ou `CONTEXT7_API_KEY`). O plugin de Claude Code usa OAuth e **não lê** `CONTEXT7_API_KEY`. Fonte: [clients/claude-code](https://context7.com/docs/clients/claude-code).

**Desconhecido:** o número exato do rate limit anônimo e se ele é por IP. Os IPs dos runners hospedados são compartilhados ([pesquisa 01](01-sandcastle-hosted-runner.md)), então o limite anônimo pode estourar por causa de outros usuários.

## 7. CLI `skills` (vercel-labs/skills)

**Fonte diz:**
- A versão é **1.7.2** (2026-10-09). Fonte: `npm view skills` e [releases](https://github.com/vercel-labs/skills/releases).
- **Symlink é o modo padrão recomendado.** O diretório canônico é `.agents/skills` (`UNIVERSAL_SKILLS_DIR`), e os agentes não universais ganham symlink para ele. Claude Code usa `skillsDir: '.claude/skills'`. `--copy` copia em vez de linkar. Fontes: [README, Installation Methods](https://github.com/vercel-labs/skills/blob/main/README.md#installation-methods), [src/constants.ts](https://github.com/vercel-labs/skills/blob/main/src/constants.ts), [src/installer.ts](https://github.com/vercel-labs/skills/blob/main/src/installer.ts) e [src/agents.ts](https://github.com/vercel-labs/skills/blob/main/src/agents.ts).
- **Atualizar:** `npx skills update [nomes] [-p|-g] [-y]`. Fonte: [README, skills update](https://github.com/vercel-labs/skills/blob/main/README.md#skills-update).
- **Não existe verificação só de leitura.** `check` é **alias** de `update`/`upgrade` e chama `runUpdate`, que reinstala o que mudou. O único flag extra é `-y`, e não há `--dry-run` nem `--frozen`. Fonte: [src/cli.ts](https://github.com/vercel-labs/skills/blob/main/src/cli.ts) (linhas 405–408) e [src/update.ts](https://github.com/vercel-labs/skills/blob/main/src/update.ts).
- **Restaurar do lock:** `npx skills experimental_install` lê o `skills-lock.json` e instala **só em `.agents/skills/`** (agentes universais). Ele **não** cria os symlinks em `.claude/skills`. Fonte: [src/install.ts](https://github.com/vercel-labs/skills/blob/main/src/install.ts).
- O lock guarda por skill os campos `source`, `sourceUrl?`, `ref?` (branch ou tag), `sourceType`, `skillPath` e `computedHash` (SHA-256 do conteúdo em disco), sem timestamps. Fonte: [src/local-lock.ts](https://github.com/vercel-labs/skills/blob/main/src/local-lock.ts).
- **Pinar ref:**
  - O ref vai no fragmento `#ref` da fonte (por exemplo `owner/repo#v1.2.0`, ou `#ref@skill`). O clone usa `git clone --depth 1 --branch <ref>`.
  - **Um SHA completo funciona por fallback:** se `--branch` falha e o ref é um SHA, ele faz `cloneAtSha`. Isso existe na tag v1.7.2.
  - O `update` agrupa por `source + ref`, ou seja, "pinned to different refs are each checked against their own ref's tree".

  Fontes: [src/source-parser.ts](https://github.com/vercel-labs/skills/blob/main/src/source-parser.ts), [src/git.ts](https://github.com/vercel-labs/skills/blob/v1.7.2/src/git.ts) (linhas 295–323) e [src/update.ts](https://github.com/vercel-labs/skills/blob/main/src/update.ts) (linhas 556, 834).

**Inferência:**
- Um check de drift no CI seria `npx skills@1.7.2 experimental_install` seguido de `git diff --exit-code .agents/skills skills-lock.json`. Como os symlinks de `.claude/skills` são entradas do git, o `git diff` também os cobre.
- O comando é `experimental_*`, então fixe a versão do CLI.
- Não verifiquei se o `update` reescreve o `ref` quando se pina um SHA. O lock atual deste repo não tem `ref`, ou seja, segue o branch padrão de `mattpocock/skills`.

## Resumo

1. **Imagem do Playwright:**
   - A tag estável é `v1.64.1` (2026-10-14), e a tag sem sufixo é Ubuntu 24.04 (noble). Há também `-jammy` e `-resolute` (26.04).
   - `latest` está congelada desde 2024-08 e não deve ser usada.
   - O conteúdo verificado: Node 24.21.0, corepack 0.36.0, git 2.43.0. Sem sudo, gh, psql ou docker.
   - Roda como **root** por padrão. Existe `pwuser` com uid 1001 (= `runner`).
   - A tag segue exatamente a versão de `@playwright/test`, e a doc manda pinar.
2. **Root:** a checagem de root vale e foi confirmada empiricamente na 2.1.303. `IS_SANDBOX=1` (ou `CLAUDE_CODE_BUBBLEWRAP`) a pula, mas isso **não é documentado**. A doc recomenda usuário não-root.
3. **O que vale em bypass:**
   - `deny` vale em todos os modos, inclusive bypass. `allow` não tem efeito em bypass.
   - Hooks PreToolUse rodam e bloqueiam com exit 2, inclusive em `-p` e sem trust. `--bare` os desliga.
   - `--settings` se combina com o skip, e as listas se **somam**.
4. **Sandcastle:**
   - A versão segue 0.12.0. O Dockerfile padrão é `node:22-bookworm` + git/curl/jq/gh + Claude Code, com usuário `agent`.
   - `claudeCode()` **não** aceita args extras nem `--settings`. O PR #927 (`extraArgs`) está aberto.
   - Saídas: embrulhar `buildPrintCommand`, ou usar `.claude/settings.json` / managed settings.
   - `noSandbox()` repassa todo o `process.env`.
5. **GitHub e Forgejo:**
   - GitHub: `container:` + `services: postgres` + `upload-artifact` é suportado. O host do Postgres é o label, e o shell é `sh`.
   - **O runner do GitHub monta `/var/run/docker.sock` no job container.**
   - Forgejo v13.2.0 suporta `container:` e `services:`, mas `options` não aceita `--user`. Lá o socket não é montado por padrão.
6. **Context7:** funciona sem chave (testado). O limite anônimo é só "low", sem número publicado. Com chave grátis, 1.000 chamadas/mês.
7. **CLI `skills` 1.7.2:**
   - O padrão é symlink, de `.agents/skills` para `.claude/skills`.
   - `update` atualiza, e `check` é só um alias que **também muda arquivos**. Não há verify.
   - `experimental_install` restaura do lock (só em `.agents/skills`). Drift se detecta com restore + `git diff --exit-code`.
   - Pinagem com `#tag` ou `#<sha completo>`.

## Adendo: imagem num registry (rodada 3)

Pesquisado em: 2026-10-18. Cenário: imagem própria (`FROM ubuntu:24.04` + Node 24 + pnpm + Claude Code + Chromium via `playwright install --with-deps chromium`, usuário uid 1001) publicada num registry. O job Factory a usa via `container:` + `services: postgres`. O template é **público** e os produtos são repos **privados**, todos em contas pessoais GitHub Free. A regra é custo zero.

Versões e datas lidas:
- Docs do GitHub (sem data de revisão nas páginas) lidas em 2026-10-18.
- `actions/runner` **v2.338.0** (2026-10-06), código lido nessa tag.
- `actions/runner-images` `ubuntu24/20261012.334` (2026-10-13).
- `actions/checkout` **v7.0.1** (2026-07-20), a mais recente.
- Forgejo **v17.0.0** (2026-10-15). A linha v16 está em v16.0.6 (2026-10-12). Docs `forgejo.org/docs/v17.0` lidas.
- `forgejo-runner` **v13.2.0** (2026-09-18), código lido nessa tag.
- Imagem `mcr.microsoft.com/playwright:v1.64.1-noble`.
- `@anthropic-ai/claude-code-linux-x64@2.1.303` e `pnpm@12.14.0` (npm, 2026-10-18).

### A1. Billing do GHCR no GitHub Free

**Fonte diz** ([GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)):
- "GitHub Packages usage is free for public packages. In addition, data transferred in from any source is free."
- Para repos privados, a cota do GitHub Free é **500 MB de storage e 1 GB/mês de transferência**. "The storage amounts shown are shared with GitHub Actions artifacts."
- **Exceção do Container registry:** "Container image storage and bandwidth for the Container registry is currently free. If you use Container registry, you'll be informed at least one month in advance of any change to this policy."
- Download pelo Actions: "When a workflow uses GitHub Actions to download a package, the data transfer does not count against the usage for the hosting repository. We determine you are downloading packages using GitHub Actions when you log in to GitHub Packages using a `GITHUB_TOKEN`." A tabela marca `GITHUB_TOKEN` como "Free" em runner hospedado e em self-hosted. PAT é "Free" no hospedado e "Paid" no self-hosted.
- Ao estourar a cota: "If your account does not have a valid payment method on file, usage is blocked once you use up your quota." Com cartão cadastrado, o excedente é cobrado, limitado por budgets. Os alertas saem em 90% e 100%.
- Budgets: "If you do not select **Stop usage when budget limit is reached**, you will be notified by email if you exceed your budget, but usage will not be stopped." Fonte: [Set up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets).
- Actions: o GitHub Free tem **2.000 minutos/mês** em repo privado. "usage is blocked once you use up your quota" sem forma de pagamento. Fonte: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- Imagens customizadas de runner (`snapshot`) aparecem como "Not applicable" no GitHub Free (mesma página). Não são alternativa para nós.

**Desconhecido:** as docs atuais **não** falam em spending limit padrão de US$ 0. Só dizem que, sem forma de pagamento, o uso é bloqueado.

**Inferência:**
- Hoje, imagem no GHCR custa zero em qualquer visibilidade.
- Uma imagem **privada** depende do "currently free". Se a regra mudar, uma imagem de cerca de 0,8–1 GB (A2) sozinha passa dos 500 MB do Free. Sem cartão, o resultado é **bloqueio**, não cobrança. Com cartão e sem budget com "Stop usage", vira cobrança.
- Uma imagem **pública** fica coberta pela regra "free for public packages", que não depende da exceção.

### A2. Tamanho esperado da imagem

**Fonte diz:** o manifest amd64 de `mcr.microsoft.com/playwright:v1.64.1-noble` (digest `sha256:bdfda2a8…`, lido em [mcr.microsoft.com/v2/playwright/manifests](https://mcr.microsoft.com/v2/playwright/manifests/v1.64.1-noble)) tem 7 camadas e **986 MB comprimidos**. Localmente, `docker image ls` mostra 3,59 GB em disco. Por camada, cruzando com `docker history` e com o [Dockerfile.noble@v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/Dockerfile.noble):

| Camada | Comprimido | Em disco |
|---|---|---|
| Base `ubuntu:24.04` | 29,8 MB | 87,6 MB |
| Node 24 (NodeSource), git, openssh, zstd, yarn | 108,6 MB | 368 MB |
| `playwright-core install-deps` para os **3** browsers | 294,6 MB | 800 MB |
| Chromium + headless shell + ffmpeg | 314,3 MB | 713 MB |
| Firefox | 122,1 MB | 325 MB |
| WebKit | 113,7 MB | 307 MB |

Claude Code: o pacote `@anthropic-ai/claude-code` é só um wrapper de 189 KB. O binário `@anthropic-ai/claude-code-linux-x64@2.1.303` tem **129 MB comprimidos (tgz) e 286 MB descompactados** (`npm view` e download do tarball). `pnpm@12.14.0` tem 4,2 MB descompactados.

**Inferência:** sem Firefox e WebKit, e só com as dependências do Chromium (subconjunto da camada de 294,6 MB, não medido), sobra cerca de **0,73–0,88 GB comprimidos e 2,4–2,9 GB em disco**. O disco do runner privado padrão é 14 GB SSD ([GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)), então cabe.

### A3. Acesso: imagem pública de outra conta e imagem privada do próprio repo

**Fonte diz:**
- "in the Container registry, public packages allow anonymous access and can be pulled without authentication." Fonte: [Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).
- A visibilidade padrão ao publicar é **privada**. "Once you make a package public, you cannot make it private again." (mesma página e [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)).
- **O runner hospedado faz login no ghcr.io sozinho.** `UpdateRegistryAuthForGitHubToken` preenche `username = github.actor` e `password = github.token` quando o registry é `ghcr.io` ou `containers.pkg.github.com`, o runner é hospedado (`IsHostedServer`) e nenhuma credencial foi passada. Depois roda `docker login` e `docker pull` (com 3 tentativas). Fonte: [ContainerOperationProvider.cs@v2.338.0](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/ContainerOperationProvider.cs) (linhas 193–225 e 520–535). Isso entrou no PR #990 (2021-02-19).
- **Publicar do próprio repo privado:** o exemplo oficial usa `permissions: contents: read, packages: write` e `docker/login-action` com `password: ${{ secrets.GITHUB_TOKEN }}`. Fonte: [Publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
  - Publicado por workflow, "the repository that contains the workflow is linked automatically" ([Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)).
  - O pacote vinculado "automatically inherits the access permissions… GitHub Actions workflows in the linked repository also automatically get access to the package" ([access control](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)).
  - Ressalva: o token "will not have permission to push the package if you have previously pushed a package to the same namespace" (por exemplo, um push manual anterior). Nesse caso, é preciso adicionar o repo em "Manage Actions access".
- **`container.credentials`:** um mapa `username`/`password`, por exemplo `username: ${{ github.actor }}` e `password: ${{ secrets.github_token }}`. Fonte: [workflow syntax, container.credentials](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
- **Permissões do token:**
  - Repo novo em conta pessoal: "`GITHUB_TOKEN` only has read access for the `contents` and `packages` scopes" ([Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)).
  - "If you specify the access for any of these permissions, all of those that are not specified are set to `none`" ([workflow syntax, permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
- **Attestations:** o exemplo oficial de publicação usa `actions/attest`. Mas "If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, artifact attestations are only available for public repositories." Fonte: [Using artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

**Inferência:**
- Imagem própria em repo privado: funciona só com `GITHUB_TOKEN`, sem PAT e sem "Manage Actions access", **desde que** o primeiro push venha do workflow do próprio repo. Se o job declarar `permissions:`, ele precisa incluir `packages: read` (e `packages: write` no job que publica). Senão o login automático usa um token sem escopo de packages.
- Imagem pública do template puxada por produto privado: no hospedado, o pull **nunca é anônimo**, porque o runner injeta o `GITHUB_TOKEN` do produto. Pelas docs, um pacote público aceita qualquer token. O exemplo de publicação deve ser copiado **sem** o passo `actions/attest` para os produtos privados.

**Desconhecido:** não achei fonte primária que garanta que o `GITHUB_TOKEN` de um repo privado de *outra* conta consegue puxar um pacote público. Há relatos em community discussions (por exemplo [#45981](https://github.com/orgs/community/discussions/45981)), mas nada oficial. Vale um teste: um repo privado descartável com `container: ghcr.io/<dono-do-template>/<imagem>:<tag>`.

### A4. Tempo de pull e cache entre jobs

**Fonte diz:**
- O `container:` é avaliado no início do job. Depois, o runner adiciona um pre-job step chamado **"Initialize containers"** (`StartContainersAsync`), que faz login, pull, network e `docker create`. Fonte: [JobExtension.cs@v2.338.0](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/JobExtension.cs) (linhas 250–256 e 317–331).
- Billing de minutos: "If you run a workflow on a Linux runner and it takes 10 minutes to complete, you'll use 10 minutes" ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- Sem cache entre jobs: "each GitHub-hosted runner is a new virtual machine (VM)" ([GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)). O [Ubuntu2404-Readme.md](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) (`ubuntu24/20261012.334`) **não tem** seção "Cached Docker images", só Docker Client/Server 28.0.4, Buildx e Compose.
- Runners hospedados "are not subject to these limits" de rate limit do Docker Hub ([workflow syntax, container.image](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).

**Inferência:**
- O pull conta como minuto de job, porque é um step do próprio job. Nos produtos privados, ele sai dos 2.000 min/mês a **cada job**, sempre do zero.

**Desconhecido:**
- A vazão de rede do runner hospedado não é documentada. Medir pela duração de "Initialize containers" num run real.

### A5. Tag calculada em runtime

**Fonte diz:**
- Na tabela de disponibilidade de contexts, `jobs.<job_id>.container.image` aceita `github, needs, strategy, matrix, vars, inputs` (**sem** `secrets` e `env`). `container.credentials` aceita também `env` e `secrets`. Fonte: [Contexts reference, Context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts).
- O runner avalia o container com `jobContext.ExpressionValues` no início do job ([JobExtension.cs](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/JobExtension.cs), linha 252).
- No Forgejo, `container.image` aceita `env, forgejo, inputs, matrix, needs, strategy, vars`. Fonte: [Forgejo Actions reference](https://forgejo.org/docs/v17.0/user/actions/reference/).

**Inferência:** o padrão funciona nos dois. Um job `image` calcula o hash do Dockerfile, dá build e push se a tag não existir, e exporta `outputs.tag`. O job Factory usa `needs: image` e `container: image: ghcr.io/<owner>/<img>:${{ needs.image.outputs.tag }}`.

### A6. Forgejo: registry OCI embutido

**Fonte diz:**
- "The container registry follows the OCI specs." Nome `{registry}/{owner}/{image}:{tag}`, autenticação com `docker login <instância>` ("If you are using 2FA or OAuth use a personal access token"). As tags não diferenciam maiúsculas e minúsculas. Fonte: [Container Registry (v17.0)](https://forgejo.org/docs/v17.0/user/packages/container/).
- **Leitura:** "public, if user is public, otherwise for this user only" (para org: membros). A escrita é só do dono. Tudo pode ser restringido por `service.REQUIRE_SIGNIN_VIEW`. O pacote pertence ao dono, não ao repo. Fonte: [Package Registry (v17.0)](https://forgejo.org/docs/v17.0/user/packages/).
- **O token automático não acessa packages.** A doc de Authorized Integrations diz que o token automático "has limited capabilities". Elas "extend their reach into operations that are not permitted by the automatic token". O workflow usa `enable-openid-connect: true` e troca `ACTIONS_ID_TOKEN_REQUEST_TOKEN` por um JWT. Fonte: [Authorized Integrations (v17.0)](https://forgejo.org/docs/v17.0/user/authorized-integrations/).
  - O bug [#6904 "actions tokens do not have permissions to push to package repository"](https://codeberg.org/forgejo/forgejo/issues/6904) (`unauthorized: reqPackageAccess`) foi fechado em 2025-02.
  - A issue [#3571](https://codeberg.org/forgejo/forgejo/issues/3571) foi fechada em 2026-05-28. Segundo o mantenedor, Authorized Integrations "are functionally complete and merged for v16".
  - O teste end-to-end faz push OCI com `skopeo --dest-creds "any:<jwt>"` ([test.yml](https://code.forgejo.org/forgejo/end-to-end/src/branch/main/actions/example-authorized-integration/.forgejo/workflows/test.yml)).
- **`container.credentials`** aceita `env, forgejo, inputs, secrets, vars`. **Não aceita `needs` nem `steps`.** Fonte: [Forgejo Actions reference](https://forgejo.org/docs/v17.0/user/actions/reference/).
- "container images, once downloaded, are never updated" (mesma página).

**Inferência:**
- Push no Forgejo sem PAT: um step pega o JWT da Authorized Integration e faz login com ele.
- Pull no `container:`: o JWT nasce num step, então não chega em `container.credentials`. Restam duas opções: um secret com PAT `read:package` de um usuário-robô, ou um pacote de dono público, que dispensa credencial.
- Como o runner nunca re-baixa, a tag precisa ser imutável. A tag por hash (A5) já resolve isso.
- O custo é só a infra própria.

### A7. `USER 1001` na imagem, sem `options: --user`

**Fonte diz (GitHub):**
- O runner **não passa `--user`**. O `docker create` leva `--name`, `--label`, `--workdir`, `--network`, `-p`, as `options` do usuário e `-e`. Fonte: [DockerCommandManager.cs@v2.338.0](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/Container/DockerCommandManager.cs) (linhas 110–189).
- Cada step roda com `docker exec -i --workdir … -e … <id> <cmd>`, **sem `-u`**. Fonte: [StepHost.cs@v2.338.0](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/Handlers/StepHost.cs) (linhas 236–264).
- O runner monta `/__w` (work), `/__t` (tools) e `/__e` (externals) a partir do host ([ContainerInfo.cs@v2.338.0](https://github.com/actions/runner/blob/v2.338.0/src/Runner.Worker/Container/ContainerInfo.cs), linhas 54–56).
- Problema conhecido em [actions/runner#2411](https://github.com/actions/runner/issues/2411) (aberta desde 2023-02, runner hospedado):
  - Com `USER` cujo uid **≠ 1001**, falham `actions/checkout` e `echo … > $GITHUB_ENV`. O motivo é que `$GITHUB_ENV`, `_runner_file_commands` e `$HOME` (`/github/home`) pertencem ao uid **1001** (o `runner` do host).
  - O contorno descrito é `useradd -u 1001` + `USER 1001`. O próprio texto avisa que isso não vale em Larger Runners (uid 1000) nem em self-hosted com uid diferente.
  - A [#4302](https://github.com/actions/runner/issues/4302) (aberta em 2026-03) mostra a mesma falha de uid em ARC.
- `ubuntu:24.04` já traz o usuário `ubuntu` com **uid 1000**. Verificado com `docker run ubuntu:24.04`: `useradd` sem `-u` dá 1001 por acaso.
- Checkout:
  - v6 e v7 guardam a credencial em arquivo sob `$RUNNER_TEMP`.
  - "When Git 2.18 or higher is not in your PATH, falls back to the REST API".
  - O input `set-safe-directory` existe.

  Fonte: [README@v7.0.1](https://github.com/actions/checkout/blob/v7.0.1/README.md).

**Inferência (GitHub):**
- Com `USER 1001`, os steps rodam como 1001, porque `docker exec` sem `-u` usa o usuário configurado no container.
- No `ubuntu-latest` padrão, o uid coincide com o dono de `/__w`, `$GITHUB_ENV` e `/github/home`. O checkout funciona (com `git` na imagem; sem ele, o checkout cai para a REST API e não cria `.git`).
- `/__e` (Node das actions JS) e `/__t` só precisam de leitura e execução.
- O Dockerfile deve usar `useradd -u 1001` explícito.
- Confirmar num run real com `id`, `touch $GITHUB_ENV` e `actions/checkout`.

**Fonte diz (Forgejo, runner v13.2.0):**
- O container é criado sem `User`, a não ser que `options` traga `--user`. Então vale o `USER` da imagem.
- Ao iniciar, o runner roda `id -u` e `id -g`. Se não der 0, faz `chown -R <uid>:<gid> <WorkingDir>` **como `0`**. O mesmo `chown` vale para tudo o que copia para dentro (`CopyDir` e `copyTarStream`). Os steps rodam com `Exec(cmd, env, "", workdir)`, isto é, com o usuário da imagem.
- Fontes: [act/container/docker/run.go@v13.2.0](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/container/docker/run.go) (linhas 140–153, 186–193, 480–483, 787–826 e 889–892) e [act/runner/step_run.go](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/act/runner/step_run.go) (linha 42).
- **Correção da seção 5:** desde o runner **v12.4.0** (2025-12-31, [PR #1238](https://code.forgejo.org/forgejo/runner/pulls/1238), "add support for user and group-add job options"), `container.options` aceita `--user` e `--group-add`. O código v13.2.0 aplica `config.User = jobConfig.Config.User`. A [doc v17.0](https://forgejo.org/docs/v17.0/user/actions/reference/) ainda lista só `--volume`, `--tmpfs`, `--hostname` e `--memory`, ou seja, está desatualizada.

**Inferência (Forgejo):** no Forgejo, o `USER 1001` da imagem é respeitado e o workspace é ajustado por `chown`. O checkout deve funcionar sem depender do uid do host.

### Resumo do adendo

1. **GHCR no GitHub Free:**
   - Storage e banda do Container registry são "currently free" em qualquer visibilidade, com aviso de 1 mês antes de mudar.
   - Pacote público é grátis por regra própria.
   - Pull via `GITHUB_TOKEN` no Actions não conta transferência.
   - Ao estourar a cota sem cartão, o uso é **bloqueado**. Não há "US$ 0 padrão" documentado.
   - Risco para os produtos: uma imagem privada de cerca de 0,8–1 GB não cabe nos 500 MB do Free se a exceção acabar. O caminho robusto é **uma imagem pública** publicada pelo template.
2. **Tamanho:** a imagem do Playwright com 3 browsers tem 986 MB comprimidos e 3,6 GB em disco. A nossa (só Chromium + Claude Code com 129 MB) deve ficar em cerca de **0,73–0,88 GB comprimidos** (Inferência).
3. **Acesso:**
   - No runner hospedado, o pull de `ghcr.io` sempre usa o `GITHUB_TOKEN` do job automaticamente.
   - Imagem própria privada funciona com `packages: write` e `packages: read`, sem PAT, se o primeiro push vier do workflow.
   - Imagem pública de outra conta: falta um teste, sem fonte oficial.
   - `actions/attest` não existe em repo privado no Free.
4. **Pull:**
   - O pull é o step "Initialize containers", dentro do job, e conta minutos (2.000/mês nos privados).
   - Não há cache de imagem entre jobs, porque cada job é uma VM nova.
   - A vazão não é documentada.
5. **Tag em runtime:** `container.image` aceita `needs.*` no GitHub e no Forgejo.
6. **Forgejo v17.0.0:**
   - Tem registry OCI embutido.
   - O token automático não acessa packages. O push sai via Authorized Integration (JWT, v16+).
   - O pull em `container.credentials` exige secret (PAT) ou pacote público.
   - O runner nunca re-baixa a imagem, então a tag precisa ser imutável.
7. **`USER 1001`:**
   - GitHub: funciona porque o uid coincide com o `runner` do `ubuntu-latest`. Use `useradd -u 1001` explícito, porque o `ubuntu:24.04` já tem o uid 1000. Quebra em runners com outro uid (#2411).
   - Forgejo: o `USER` é respeitado, e o runner faz `chown` do workspace para o uid da imagem.
   - Desde o runner v12.4.0, o Forgejo também aceita `--user` (a doc está desatualizada).
