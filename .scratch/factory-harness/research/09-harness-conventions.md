# 09 — Convenções de arquivos de harness e MCPs oficiais

Pesquisa feita em 2026-10-17, só com fontes primárias. Versões de referência:

- **Claude Code v2.1.302** (release de 2026-10-16, [anthropics/claude-code releases](https://github.com/anthropics/claude-code/releases)); docs em `code.claude.com/docs/en/*` lidas nessa data.
- **anthropics/claude-code-action v1.0.252** (2026-10-16; a tag `v1` aponta para a série 1.0.x). Essa versão instala o **Claude Code 2.1.302** fixo (`src/entrypoints/run.ts`, `const claudeCodeVersion = "2.1.302"`).
- Spec AGENTS.md em [agents.md](https://agents.md/) (sem número de versão nem data na página).
- Codex: docs em `learn.chatgpt.com/docs/*` (`developers.openai.com/codex/*` redireciona com 308 para lá), sem data na página.
- MCPs: `@playwright/mcp` 0.0.83, `@playwright/cli` 0.1.22 (2026-09-28), `shadcn` 4.22.0 (2026-10-16), `@upstash/context7-mcp` 4.4.2 e `ctx7` 0.8.0 (2026-10-15/16), README de `cloudflare/mcp-server-cloudflare` (push em 2026-10-09) e de `cloudflare/mcp` (2026-10-13), `neondatabase/mcp-server-neon` (2026-10-16), `resend/resend-mcp` (2026-10-16).

---

## Resposta

### Layout recomendado dos arquivos de harness

```text
AGENTS.md                         # fonte da verdade, em inglês, < 200 linhas; SEM CLAUDE.md em lugar nenhum
GLOSSARY.md
docs/adr/  docs/agents/
apps/web/AGENTS.md                # exemplo: convenções por pacote (o layout real sai do ticket de monorepo)
apps/api/AGENTS.md
packages/db/AGENTS.md
.agents/skills/<name>/SKILL.md    # cópia canônica, formato Agent Skills (Codex e outros leem aqui)
  └─ agents/openai.yaml           # opcional, metadados do Codex
.claude/
  skills/<name>/SKILL.md          # espelho de .agents/skills (Claude Code só lê aqui); mantido por `npx skills`
  agents/                         # subagents da Factory, um por Stage (só Claude Code)
    explorer.md  developer.md  e2e.md  reviewer.md
  hooks/*.sh                      # scripts de hook (ex.: git guardrails), chamados via "$CLAUDE_PROJECT_DIR"
  settings.json                   # permissions.deny/ask, hooks, env sem segredo
.mcp.json                         # MCPs de projeto; segredos só como ${VAR}
skills-lock.json                  # lock do `npx skills` (já existe)
.github/
  factory/claude-settings.ci.json # permissions.allow + pluginConfigs do CI, passado no input `settings:` da action
  workflows/factory-*.yml         # anthropics/claude-code-action@v1 (fixar versão/SHA)
```

Regras do layout:

1. **Não criar `CLAUDE.md`, `.claude/CLAUDE.md` nem `CLAUDE.local.md`.** Se existir um, o Claude Code deixa de ler qualquer `AGENTS.md` no modo padrão (finding 2).
2. **Allowlist de ferramentas do CI fica fora do `.claude/settings.json`.** Em `claude -p`/SDK, os `permissions.allow` do projeto são ignorados porque a pasta nunca é "trusted" (finding 8). Ela vai no input `settings:` da action, que escreve em `~/.claude/settings.json` (escopo user), ou em `--allowedTools`.
3. **Skills nas duas pastas.** O Claude Code não lê `.agents/skills`, e o Codex não lê `.claude/skills` (finding 5).
4. **Subagents e hooks são só do Claude Code.** Ficam como camada fina por cima de skills portáveis: o subagent de cada Stage pré-carrega skills (`skills:`) em vez de duplicar instruções.

### MCPs recomendados (`.mcp.json` da Factory)

| Nome | Para quê | Por quê |
| - | - | - |
| `cloudflare-docs` → `https://docs.mcp.cloudflare.com/mcp` | Docs atuais de Workers/Pages/bindings | Sem auth, então funciona headless sem segredo |
| `context7` → `https://mcp.context7.com/mcp` | Docs versionadas de Hono, Drizzle, TanStack, Better Auth, Kubb, Zod | Bearer API key em secret do CI |
| `shadcn` → `npx shadcn@<versão> mcp` | Buscar e instalar componentes do registry | stdio, sem auth |
| `cloudflare-api` → `https://mcp.cloudflare.com/mcp` | Ler logs/observability do preview, inspecionar recursos | Token de API **read-only** (Bearer); deploy continua via `wrangler` no workflow |
| `neon` → `https://mcp.neon.tech/mcp?readonly=true&projectId=…` | Inspecionar schema/dados do branch de preview | Bearer API key; só read-only e escopado ao projeto, porque a Neon desaconselha produção |

Fora do `.mcp.json`, como **CLI + skill** em vez de MCP:

- **Playwright CLI** (`@playwright/cli` + `playwright-cli install --skills`) para o E2E e os prints no PR. A própria Microsoft recomenda CLI+skills para coding agents. Headless por padrão.
- Skills de fornecedor: `cloudflare/skills` (wrangler, workers-best-practices), `neondatabase/agent-skills`, `shadcn/ui` e o skill do `ctx7`.

Não usar:

- Os servidores `bindings.mcp.cloudflare.com` e `observability.mcp.cloudflare.com`, que estão **depreciados** em favor do `mcp.cloudflare.com`.
- Resend MCP na Factory: envia e-mail real. Fica só como opção manual.

---

## Achados detalhados

### 1. Spec AGENTS.md

- É Markdown puro, sem campos obrigatórios: "AGENTS.md is just standard Markdown. Use any headings you like". Fica na raiz e, em monorepo, "Place another AGENTS.md inside each package". Fonte: [agents.md](https://agents.md/).
- Precedência: "Agents automatically read the nearest file in the directory tree, so the closest one takes precedence" e "The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything." Fonte: [agents.md](https://agents.md/).
- Governança: "AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation." A página não traz versão nem data. Fonte: [agents.md](https://agents.md/).
- **Lacuna:** a lista de ferramentas da home não cita o Claude Code, embora ele leia AGENTS.md nativamente (finding 2). Não verifiquei a página "View all supported agents".

### 2. Claude Code lê AGENTS.md nativamente (desde v2.1.277), com condições

Fonte de todo este item: [Memory → AGENTS.md](https://code.claude.com/docs/en/memory#agents-md) e [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) (entrada 2.1.277: "Added AGENTS.md support: in a project with no CLAUDE.md, Claude Code reads AGENTS.md instead").

- O Claude Code lê `AGENTS.md` "without adding a `CLAUDE.md`, an import, or a setting". Requer **v2.1.277+**. A partir da v2.1.281 isso vale também em Bedrock/Vertex/Foundry e com telemetria desligada.
- **Só lê se não houver CLAUDE.md.** Por padrão (`claude-md-or-agents-md`), um `CLAUDE.md`, `.claude/CLAUDE.md` ou `CLAUDE.local.md` no cwd ou acima dele faz o Claude ler **só** os CLAUDE.md. Não contam para essa checagem `~/.claude/CLAUDE.md`, o CLAUDE.md gerenciado e `.claude/rules/`.
- **O que é carregado:**
  - No início da sessão: todo `AGENTS.md` e `.claude/AGENTS.md` do cwd e dos diretórios acima.
  - Em subdiretórios: o `AGENTS.md` do subdiretório entra "when Claude opens a file there **with the Read tool** and that subdirectory has none of the three CLAUDE.md files of its own".
  - Os imports `@path` são expandidos.
  - **Não são lidos:** `AGENTS.local.md`, `AGENTS.override.md` ou "anything under a `.agents/` directory".
- **Como os arquivos se combinam:** são concatenados, sem override, da raiz até o cwd ("All discovered files are concatenated into context rather than overriding each other"). Fonte: [How CLAUDE.md files load](https://code.claude.com/docs/en/memory#how-claude-md-files-load).
- **Modos (setting "Project instructions"):** `claude-md-or-agents-md` (padrão), `claude-md-and-agents-md`, `claude-md` e `managed-only`.
  - Em arquivo, a configuração fica em `pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles`.
  - **Só é lida de `~/.claude/settings.json`, de `--settings` ou de managed settings; o Claude a ignora em project/local settings.** Antes da v2.1.285 o ID era `agents-md@builtin`.
- **Diferenças de AGENTS.md lido direto em relação a CLAUDE.md:**
  - Hooks `InstructionsLoaded` não disparam.
  - Com `--add-dir`, o AGENTS.md do diretório adicionado não carrega.
- **Quando o suporte fica indisponível:**
  - Versões anteriores à v2.1.277.
  - Plugin embutido desativado via `/plugin`.
  - "In some cases, it's your first session after you upgrade from v2.1.276 or earlier".
- **Alternativa compatível:** um `CLAUDE.md` com `@AGENTS.md` (ou um symlink). A doc avisa que, no Windows, um symlink commitado vira arquivo texto se `core.symlinks` estiver desligado.
- **Tamanho:** "target under 200 lines per CLAUDE.md file". Imports não reduzem custo de contexto. Fonte: [Write effective instructions](https://code.claude.com/docs/en/memory#write-effective-instructions).
- **Subagents** herdam os AGENTS.md carregados como project instructions. As exceções são `Explore`/`Plan` embutidos e subagents com `omitClaudeMd: true`. Fonte: [Sub-agents → what loads at startup](https://code.claude.com/docs/en/sub-agents).

**Conclusão:** para "AGENTS.md é a fonte da verdade", o caminho documentado é **nenhum CLAUDE.md** no repo. O fallback `CLAUDE.md` com `@AGENTS.md` tem um custo: no modo padrão, um CLAUDE.md na raiz faz o Claude parar de ler os `AGENTS.md` dos subdiretórios. Cada pacote precisaria então do seu próprio `CLAUDE.md` com `@AGENTS.md`, ou do modo `claude-md-and-agents-md` em user settings.

### 3. Codex: descoberta de AGENTS.md

Fonte: [Codex → AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

- Nível global: `~/.codex/AGENTS.override.md` ou `AGENTS.md`, usando só o primeiro não vazio.
- Nível de projeto: "Starting at the project root (typically the Git root), Codex walks down to your current working directory". Em cada diretório, procura `AGENTS.override.md`, depois `AGENTS.md`, depois `project_doc_fallback_filenames`, com no máximo um arquivo por diretório.
- Os arquivos são concatenados da raiz para baixo; o mais próximo aparece por último.
- Limite: `project_doc_max_bytes`, **32 KiB por padrão**.
- **Nested abaixo do cwd não carrega:** "Codex stops searching once it reaches your current directory". O Claude, ao contrário, carrega sob demanda.
- A página não cita `CLAUDE.md`. Pela regra de fallback, ele só seria lido se entrasse em `project_doc_fallback_filenames` (inferência minha).

**Implicação:** AGENTS.md por pacote funciona nos dois agentes, mas com semânticas diferentes:

- No Claude, o arquivo carrega quando o agente faz Read de um arquivo do pacote.
- No Codex, só carrega se o cwd estiver dentro do pacote.

O AGENTS.md raiz deve listar os AGENTS.md de pacote e mandar lê-los antes de editar ali.

### 4. Regras por caminho (`.claude/rules/`): existem, mas não são portáveis

- `.claude/rules/*.md` com frontmatter `paths:` carrega quando o Claude lê, escreve ou edita um arquivo que casa com o padrão. Sem `paths`, a regra carrega no início com a mesma prioridade de `.claude/CLAUDE.md`. Fonte: [Organize rules with .claude/rules/](https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/).
- Não fazem parte da spec AGENTS.md nem do Codex. **Recomendação:** não usar no Template, para manter a portabilidade. Se usar, só para reforço específico do Claude.

### 5. Skills: `.claude/skills` (Claude) × `.agents/skills` (Codex e outros); formato SKILL.md

- **Claude Code lê:**
  - `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md` e os aninhados em `<subdir>/.claude/skills/`. Os aninhados carregam quando o Claude toca um arquivo do subdiretório.
  - O cwd e todos os pais até a raiz do repo.
  - Plugins.
  - **A doc de skills não menciona `.agents/skills`.** A doc de memória diz que o Claude não lê "anything under a `.agents/` directory" (no contexto de AGENTS.md).
  - Uma pasta de skill pode ser symlink.
  - Fonte: [Skills](https://code.claude.com/docs/en/skills).
- **Codex lê:** `$CWD/.agents/skills`, `$CWD/../.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills` e os embutidos. Segue symlinks. `agents/openai.yaml` é opcional (`interface`, `policy.allow_implicit_invocation`, `dependencies.tools`). A doc não menciona `.claude/skills`. Fonte: [Codex → Build skills](https://learn.chatgpt.com/docs/build-skills).
- **Spec Agent Skills:**
  - `name` é obrigatório (≤ 64 caracteres, minúsculas/dígitos/hífen, igual ao nome do diretório).
  - `description` é obrigatória (≤ 1024 caracteres).
  - Opcionais: `license`, `compatibility` (≤ 500), `metadata` e `allowed-tools` (experimental).
  - Pastas opcionais `scripts/`, `references/` e `assets/`.
  - SKILL.md com menos de 500 linhas e menos de 5000 tokens.
  - A spec **não define local de descoberta.**
  - Fonte: [agentskills.io/specification](https://agentskills.io/specification).
- **Extensões do Claude Code** (ignoradas por outros agentes):
  - `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths` e `shell`.
  - Campo desconhecido é ignorado sem erro.
  - A listagem trunca `description` + `when_to_use` em 1.536 caracteres.
  - Fonte: [Skills → frontmatter reference](https://code.claude.com/docs/en/skills).
- **Estado atual do repo:** `.agents/skills/` e `.claude/skills/` têm cópias idênticas (103 arquivos rastreados em cada; `diff -rq` vazio), instaladas pelo `npx skills` (`skills-lock.json`). O CLI `skills` 1.7.2 recomenda o modo symlink ("Single source of truth"). O modo `--copy` serve para quando não há symlink. Fonte: [vercel-labs/skills README](https://github.com/vercel-labs/skills). É fonte primária do CLI, não da Anthropic ou da OpenAI.
- **Comandos legados:** `.claude/commands/*.md` foram fundidos em skills e continuam funcionando. Fonte: [Skills](https://code.claude.com/docs/en/skills).

### 6. Subagents (`.claude/agents/`): só Claude Code

Fonte: [Sub-agents](https://code.claude.com/docs/en/sub-agents).

- **Escopos, do de maior prioridade para o de menor:** managed, `--agents` (JSON; em `-p` aceita caminho de arquivo desde v2.1.281), `.claude/agents/`, `~/.claude/agents/` e plugin.
- **Descoberta:** os diretórios `.claude/agents/` são varridos do cwd até a raiz, recursivamente. A identidade vem só do `name`.
- **Frontmatter:**
  - Obrigatórios: `name` e `description`.
  - Opcionais: `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `autoCompactWindow`, `skills` (pré-carrega o conteúdo inteiro), `mcpServers`, `hooks`, `memory`, `background`, `omitClaudeMd`, `effort`, `isolation: worktree`, `color`, `initialPrompt` e `experimental.cacheTtl`.
- **Contexto inicial:** o subagent recebe o próprio prompt, a mensagem de delegação, os CLAUDE.md/AGENTS.md, o git status e as skills pré-carregadas. Não vê o histórico da conversa.
- **Restrição em CI** (finding 8): hooks de frontmatter e `mcpServers` inline de subagents do repo **não são usados** em `-p` numa pasta não trusted. É melhor referenciar servidores do `.mcp.json` pelo nome.
- **Fora do Claude Code:** não há equivalente na spec AGENTS.md. O Codex guarda configuração em `.codex/config.toml` (finding 7). Não pesquisei subagents do Codex.

### 7. `.mcp.json` de projeto

Fonte: [MCP](https://code.claude.com/docs/en/mcp).

- **Local e formato:** o escopo project fica em `.mcp.json` na raiz, `{"mcpServers": {...}}`, com tipos `stdio`, `http`, `sse` e `ws`. A precedência é local > project > user > plugin > conectores do claude.ai, sem merge de campos entre escopos.
- **Expansão de variáveis:** `${VAR}` e `${VAR:-default}` valem em `command`, `args`, `env`, `url` e `headers`.
- **Credenciais lidas como vazio:** nas `url`/`headers` de servidores remotos, algumas variáveis de credencial "read as empty". Exemplos citados: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY` e `NPM_TOKEN`. **A lista dá exemplos ("such as") e não é exaustiva.** Use nomes próprios, como `FACTORY_CF_MCP_TOKEN`.
- **Aprovação de servidores:** em sessão interativa, o Claude pede aprovação antes de usar servidores do `.mcp.json`. "In `claude -p` runs, Agent SDK sessions, and cloud sessions, Claude Code can't show that prompt: it loads project-scoped servers without asking."
- **OAuth não funciona headless:** "A `claude -p` or Agent SDK run has no `/mcp` panel, so Claude Code can't run the OAuth flow there." Para CI, use header `Authorization: Bearer ${VAR}` ou `headersHelper`. Porém o `headersHelper` do `.mcp.json` **não roda** em `-p` numa pasta não trusted ([Permissions → What runs before you trust a folder](https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder)).
- **Codex não lê `.mcp.json` de projeto:** usa `~/.codex/config.toml` ou `.codex/config.toml` ("trusted projects only"). Fonte: [Codex → MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Se a portabilidade de MCP importar, mantenha um espelho em TOML.

### 8. `.claude/settings.json`, permissões, hooks e trust no CI

- **Arquivos e precedência:**
  - Precedência: managed > linha de comando (`--settings`) > `.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`.
  - Listas como `permissions.allow` **somam** entre níveis.
  - Fonte: [Settings](https://code.claude.com/docs/en/settings).
- **Trust do workspace:**
  - `permissions.allow` e `additionalDirectories` do `.claude/settings.json` só valem depois do diálogo de trust.
  - "A `claude -p` run or an SDK session never shows it".
  - Fonte: [Permissions → Project allow rules and workspace trust](https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust).
- **O que roda em `-p`/SDK numa pasta nunca trusted:**

  | Conteúdo do repo | Em `-p`/SDK sem trust |
  | - | - |
  | Hooks de settings, bloco `env`, `allowed-tools` de skills | **Usados**. "Workspace trust never gates a skill's `allowed-tools` in any session" |
  | `permissions.allow` do `.claude/settings.json` | **Não usados**; aviso `this workspace has not been trusted` no stderr |
  | Hooks de frontmatter de subagent, plugin `@skills-dir`, `extraKnownMarketplaces` | Não usados |
  | `mcpServers` inline em subagent | Não usados |
  | Servidores do `.mcp.json` | Conectados sem perguntar |
  | `headersHelper` do `.mcp.json` | Não roda |

  Fonte: mesma página.
- **Contorno documentado:** `projects["<repo root>"].hasTrustDialogAccepted = true` em `~/.claude.json`. Fonte: mesma página.
- **Deny e ask valem sempre:** `deny`/`ask` não dependem de trust, então o `.claude/settings.json` é o lugar certo para *restrições*. Para bloqueio de verdade, use hook `PreToolUse` (exit code 2 bloqueia), porque CLAUDE.md/AGENTS.md "are not a hard enforcement layer". Fontes: [Hooks](https://code.claude.com/docs/en/hooks) e [Memory](https://code.claude.com/docs/en/memory).
- **Eventos de hook relevantes para a Factory:** `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart`/`SubagentStop` e `TaskCompleted`. Fonte: [Hooks](https://code.claude.com/docs/en/hooks).
- **`--bare` não serve aqui:** ele pula hooks, skills, subagents, `.mcp.json` e CLAUDE.md. Fonte: [Headless](https://code.claude.com/docs/en/headless).
- **Primeira sessão:**
  - Recursos atrás de feature flag e o modo de permissão inicial podem diferir na primeira sessão.
  - "if each run starts in a CI container … every run is a first session".
  - AGENTS.md **não** está na lista de recursos dependentes de flag. A doc de memória, porém, cita uma exceção de "first session after you upgrade from v2.1.276 or earlier". Um CI com instalação limpa da 2.1.302 não é upgrade, mas a doc não diz isso explicitamente.
  - Fonte: [Env vars → First session after an install or upgrade](https://code.claude.com/docs/en/env-vars).

### 9. Como o `claude-code-action` carrega tudo isso

Fontes: código e docs de [anthropics/claude-code-action @ v1.0.252](https://github.com/anthropics/claude-code-action/tree/v1.0.252) e [Claude Code → GitHub Actions](https://code.claude.com/docs/en/github-actions).

- **Versão do Claude Code:** a action instala uma versão **fixa**, `curl https://claude.ai/install.sh | bash -s -- 2.1.302` (`src/entrypoints/run.ts`). Portanto o AGENTS.md nativo (≥ 2.1.277) está disponível.
- **Como o Claude roda:** via Agent SDK com `settingSources: ["user", "project", "local"]`, a menos que `--setting-sources` venha em `claude_args` (`base-action/src/parse-sdk-options.ts`). Por isso `AGENTS.md`, `.claude/skills`, `.claude/agents`, `.claude/settings.json` (hooks, deny) e `.mcp.json` são lidos do checkout.
- **Input `settings:`:** aceita JSON ou caminho de arquivo e é **mesclado em `~/.claude/settings.json`** (escopo user). A action **sempre** força `enableAllProjectMcpServers: true` (`base-action/src/setup-claude-code-settings.ts`). Consequências:
  - É o lugar certo para `permissions.allow` do CI, porque regras de user não dependem de trust.
  - Também serve para `pluginConfigs["cc-plugin-agents-md@builtin"]`, que só é lido de user settings.
- **Ferramentas:** "Claude does **not** have access to execute arbitrary Bash commands by default". Ferramentas do `.mcp.json` "still need to be explicitly allowed", via `claude_args: --allowedTools …`. Fonte: `docs/configuration.md`.
- **Skills:** é possível rodar uma skill como `prompt: /skill-name`, desde que `actions/checkout` venha antes. Fonte: [GitHub Actions → Run a skill](https://code.claude.com/docs/en/github-actions#run-a-skill).
- **Arquivos restaurados da base em PRs:**
  - Em eventos de PR, a action restaura da branch base `.claude/`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `CLAUDE.md`, `CLAUDE.local.md` e `.husky/` (`SENSITIVE_PATHS` em `src/github/operations/restore-config.ts`; `docs/security.md`).
  - **`AGENTS.md` e `.agents/` não estão na lista.** Um PR que altere o AGENTS.md é lido com a versão do PR.
- **Quem pode disparar:** só atores com write access e humanos (bots exigem `allowed_bots`). Fonte: [GitHub Actions → Who can trigger runs](https://code.claude.com/docs/en/github-actions#who-can-trigger-runs).
- **Não encontrei** (busca de código em `anthropics/claude-code-action`) nenhuma escrita de `hasTrustDialogAccepted`. Logo, `permissions.allow` do `.claude/settings.json` do projeto **provavelmente não vale** dentro da action. Inferência a partir da doc de permissões, ainda não testada.

### 10. MCPs oficiais para a stack

- **Cloudflare** ([cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare), [cloudflare/mcp](https://github.com/cloudflare/mcp)):
  - Recomendado: o "Cloudflare API MCP Server" `https://mcp.cloudflare.com/mcp`, em Code Mode: 4 tools (`docs`, `search`, `execute`, `whoami`) cobrindo cerca de 2.500 endpoints em cerca de 1k tokens.
  - Auth: OAuth, ou "Option 2: API Token — For CI/CD, automation" como Bearer. Tokens com IP filtering não são suportados.
  - Docs: `https://docs.mcp.cloudflare.com/mcp`, "does not require authentication".
  - **Depreciados:** Workers Bindings (`bindings.mcp.cloudflare.com`), Observability (`observability.mcp.cloudflare.com`), Builds e outros: "Please migrate to the Cloudflare API MCP Server".
  - O plugin [cloudflare/skills](https://github.com/cloudflare/skills) traz skills (`wrangler`, `workers-best-practices`, `agents-sdk`, `durable-objects` e outras) mais o servidor `cloudflare`.
- **Neon** ([neondatabase/mcp-server-neon](https://github.com/neondatabase/mcp-server-neon)):
  - `https://mcp.neon.tech/mcp`, com OAuth ou `Authorization: Bearer <NEON_API_KEY>`. Este último é "useful if you want to connect a remote agent to Neon where OAuth is not available".
  - Parâmetros de URL: `readonly`, `projectId`, `category` e `roleName`.
  - Aviso do próprio fornecedor: "intended for local development and IDE integrations only. **We do not recommend using the Neon MCP Server in production environments.**"
  - Há skills em [neondatabase/agent-skills](https://github.com/neondatabase/agent-skills).
- **Playwright** ([microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp), [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)):
  - MCP: stdio `npx @playwright/mcp@latest`, **headed por padrão**; use `--headless`. "concurrent MCP clients sharing the same workspace will conflict", então use `--isolated`. Há `--output-dir` para screenshots.
  - A Microsoft recomenda CLI+skills para coding agents: "CLI invocations are more token-efficient".
  - O `playwright-cli` é headless por padrão e tem `screenshot`. Para as skills: `playwright-cli install --skills`.
- **shadcn** ([docs MCP](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/(root)/mcp.mdx), [docs Skills](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/(root)/skills.mdx)):
  - `npx shadcn@latest mcp init --client claude`, que gera `{"command":"npx","args":["shadcn@latest","mcp"]}`. Os registries vêm do `components.json`.
  - Skill: `npx skills add shadcn/ui`.
  - Não verifiquei auth de registries privados.
- **Context7** ([upstash/context7](https://github.com/upstash/context7), [all-clients](https://context7.com/docs/resources/all-clients)):
  - `https://mcp.context7.com/mcp` com `Authorization: Bearer <API_KEY>`. OAuth existe em `/mcp/oauth`, que não serve para o CI.
  - API key "Recommended … for higher rate limits", sem números publicados.
  - Alternativa: CLI `ctx7` + skill, "no MCP required".
- **Resend** ([resend/resend-mcp](https://github.com/resend/resend-mcp)):
  - `https://mcp.resend.com/mcp` com OAuth, ou Bearer `re_…`. "If your client runs somewhere a browser login isn't possible (a server, CI, or a headless agent), pass a Resend API key as a Bearer token".
- **GitHub:** a action já inclui seus próprios servidores MCP de GitHub (comentários, inline comments, file ops, Actions), que são ativados por `--allowedTools`. Fonte: `src/mcp/*` e `docs/configuration.md` da action.

---

## Tabela de MCPs

| Servidor | URL / comando | Auth | Headless no CI? | Notas |
| - | - | - | - | - |
| Cloudflare Docs | `https://docs.mcp.cloudflare.com/mcp` (http) | Nenhuma | **Sim** | Uma tool: `search_cloudflare_documentation` |
| Cloudflare API (Code Mode) | `https://mcp.cloudflare.com/mcp` (http) | OAuth **ou** Bearer API token (user/account) | **Sim, com token** (OAuth não) | Use token read-only; deploy continua no `wrangler` |
| Cloudflare Workers Bindings | `https://bindings.mcp.cloudflare.com/mcp` | OAuth (não verificado) | Não recomendado | **Depreciado** |
| Cloudflare Observability | `https://observability.mcp.cloudflare.com/mcp` | OAuth (não verificado) | Não recomendado | **Depreciado**; use a API MCP |
| Neon | `https://mcp.neon.tech/mcp?readonly=true&projectId=…` (http) | OAuth **ou** Bearer `NEON_API_KEY` | **Sim, com API key** | Fornecedor desaconselha produção; IPs fixos `34.192.103.46`, `23.22.233.166` se houver IP Allow |
| Playwright MCP | `npx @playwright/mcp@0.0.83 --headless --isolated` (stdio) | Nenhuma | **Sim, com `--headless`** (padrão é headed) | Precisa do browser instalado no runner |
| Playwright CLI + skill | `@playwright/cli@0.1.22` + `playwright-cli install --skills` | Nenhuma | **Sim** (headless por padrão) | Recomendado pela Microsoft para coding agents |
| shadcn | `npx shadcn@4.22.0 mcp` (stdio) | Nenhuma (registry público) | **Sim** | Lê `components.json` |
| Context7 | `https://mcp.context7.com/mcp` (http) ou `npx @upstash/context7-mcp --api-key …` | Bearer API key (opcional, limita taxa); OAuth em `/mcp/oauth` | **Sim, com API key** | Alternativa CLI `ctx7` + skill |
| Resend | `https://mcp.resend.com/mcp` (http) | OAuth **ou** Bearer `re_…` | **Sim, com API key** | Envia e-mail real; fora da Factory |
| GitHub (da action) | embutido no `claude-code-action` | Token do GitHub App/`github_token` | **Sim** | Só ativa as tools listadas em `--allowedTools` |

---

## Riscos em aberto

1. **AGENTS.md no CI sem prova empírica.**
   - A doc garante o suporte na v2.1.277+ e a action instala a 2.1.302.
   - Porém: (a) a doc cita um caso de "first session after you upgrade" sem detalhar; (b) hooks `InstructionsLoaded` não disparam para AGENTS.md lido direto, então não dá para auditar o carregamento por hook.
   - Mitigação: um smoke test no workflow que pergunte ao agente uma frase sentinela do AGENTS.md. Se falhar, o plano B é o modo `claude-md-and-agents-md` via `settings:` da action.
2. **AGENTS.md de subdiretório só carrega com a ferramenta Read** no Claude, e o Codex só o carrega se o cwd estiver dentro do pacote. Um agente que cria arquivo novo num pacote sem ler nada ali perde as convenções. Mitigação: o AGENTS.md raiz indexa os de pacote e manda lê-los.
3. **`permissions.allow` do projeto é ignorado em `-p`/SDK.**
   - O contorno `hasTrustDialogAccepted` em `~/.claude.json` é documentado, mas não foi testado com a action. Não sei se a action escreve ou sobrescreve esse arquivo.
   - Decisão sugerida: allowlist no input `settings:` ou `--allowedTools`.
   - Falta a confirmação que o ticket do motor (12) precisa fazer.
4. **`AGENTS.md` fica fora dos `SENSITIVE_PATHS`** restaurados pela action em PRs. Se a Factory rodar em eventos de PR, um PR pode alterar as próprias instruções. Ao mesmo tempo, mudanças da Factory em `.claude/` só valem depois do merge.
5. **MCPs só com OAuth não funcionam no CI.**
   - Todo MCP remoto da Factory precisa de token em secret e header `Bearer ${VAR}`.
   - A lista de variáveis "lidas como vazio" não é exaustiva, então use nomes próprios.
   - `headersHelper` não roda sem trust.
6. **Superfície de risco dos tokens:**
   - Neon desaconselha o MCP em produção. Use `readonly=true`, `projectId` e, se possível, `roleName` com permissão mínima.
   - O token Cloudflare do MCP deve ser read-only. Escrita só pelo workflow.
   - A saída de MCPs de docs (Context7) é superfície de prompt injection.
7. **Divergência das duas cópias de skills** (`.agents/skills` × `.claude/skills`). Symlink resolve, mas quebra no Windows sem `core.symlinks`; o mesmo aviso da doc de CLAUDE.md se aplica. Mitigação: só alterar via `npx skills` e checar no CI que as duas árvores são idênticas.
8. **Ritmo de releases.**
   - Claude Code saiu em 2.1.300, 2.1.301 e 2.1.302 em três dias, e a action solta uma versão por dia. A tag `v1` é móvel.
   - Fixe a action numa versão/SHA e revise as versões dos MCPs `npx` (não usar `@latest` no CI).
   - Os servidores `*.mcp.cloudflare.com` já mudaram de status (depreciados) dentro do ciclo.
9. **Subagents e hooks não são portáveis.** A spec AGENTS.md não tem equivalente e o Codex usa `.codex/config.toml`. Se a portabilidade for levada a sério, a lógica dos Stages precisa morar em skills, e os subagents ficam como invólucro fino.
10. **Fontes silenciosas:** não verifiquei a auth dos servidores Cloudflare depreciados, a auth de registries privados do shadcn, nem os limites numéricos do Context7. Também não verifiquei se o Codex lê `.claude/skills`: a doc não diz, e presumo que não.
