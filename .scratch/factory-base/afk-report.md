# Relatório da execução AFK: base da Factory (tickets 01–13)

Data: 2026-10-19. Branch de integração: `factory-base` (criada a partir de `planning/factory-harness`, `c64e819`). Nada foi enviado ao remoto, nenhum PR foi aberto e `main` não foi tocada.

Último `TURBO_FORCE=1 pnpm factory:verify`: verde (12/12 tarefas, sem cache), no branch `review-fixes` (`574bf62`) que foi mesclado em `factory-base` (`077cfd6`). A mescla em si não foi reexecutada, porque `review-fixes` já continha `factory-base`.

## Tickets

| Ticket | Status | Observação |
|---|---|---|
| 01 Workspace e Worker do `example` | done | |
| 02 Contrato até a tela | done | |
| 03 Cadastro e verificação de email | done | itens pendentes abaixo |
| 04 Login, logout e `GET /api/me` | done | item pendente abaixo |
| 05 Reset de senha | done | |
| 06 Ponte OpenAPI → MCP | **ready-for-human** | falta a medição de CPU no Workers Free |
| 07 `new-product` e molde | done | itens adiados registrados no critério da `Feature` |
| 08 Caminho feliz da Factory contra falsos | done | |
| 09 Falhas, recusas e Escalation | done | |
| 10 Execução local da Factory | **ready-for-human** | falta a demonstração com Claude real |
| 11 Arquivos de harness | done | 19 skills do Matt, não 18 (decisão abaixo) |
| 12 CI do PR: imagem e `verify` | **ready-for-human** | workflows não instalados (ver abaixo) |
| 13 Bootstrap: estrutura, parte comum e `doctor` | done | verificado só contra clientes falsos |

## Pendências humanas por ticket

**03**
- Domínio do Resend e `RESEND_API_KEY` restrita ao domínio, na conta real. Nenhum teste chama o Resend de verdade.
- Medir na conta o login real sem `exceededCpu` no `PasswordHasher` e o CPU do render do email no Free.

**04**
- No smoke da conta, conferir que o 429 vale por IP atrás da Cloudflare e que as linhas do `RateLimiter` cabem nas cotas de DO do Free.

**06**
- Medir o CPU por request do `/mcp` no Workers Free. É o único critério sem marca.
- Criar o namespace KV `OAUTH_KV` de produção e o `PREVIEW_OAUTH_KV_ID` do preview, pelo bootstrap. O `wrangler.jsonc` só declara o binding.

**10**
- Demonstração com Claude real. Exige `CLAUDE_CODE_OAUTH_TOKEN` ou `ANTHROPIC_API_KEY`, que não existiam no ambiente. O comando exato está no `## Comments` do ticket. A issue de teste em Markdown deve ser criada e apagada junto com o branch e a evidência, como o ticket pede.

**11**
- Nada pendente. Para você decidir: 18 ou 19 skills do Matt. No Windows, os symlinks de `.claude/skills` exigem `core.symlinks=true`.

**12** (os workflows estão em `.scratch/factory-base/pending/ticket-12/`)
1. Instalar `factory-image.yml` e `factory-pr.yml` em `.github/workflows/`, remover `claude.yml` e `claude-code-review.yml`, e trocar `WORKFLOWS_DIR` no teste `.factory/test/ci-workflows.test.ts`. Os comandos estão no `README.md` dessa pasta. As regras `deny` do ticket 11 bloqueiam a escrita nesses caminhos e não foram contornadas.
2. Medir "Initialize containers" com a imagem contra o `setup.sh` direto na VM. Se o pull não for mais rápido, reabrir a escolha da imagem.
3. Conferir `actions/checkout` no container com `USER 1001`.
4. Conferir a visibilidade com que o pacote do GHCR nasce num repo público e a leitura com `packages: read`.
5. Exigir o check `verify` no ruleset da `main`, depois do primeiro PR verde.

**13**
- Rodar `pnpm bootstrap` na conta real (criar o token pela URL do template, registrar o `workers.dev`) e depois `pnpm bootstrap doctor`. Os adaptadores reais do `gh` e da Cloudflare só foram exercitados por testes de construção de comando e `fetch` falso.

**Geral**
- `pnpm install` lista quatro pacotes com skills aguardando `pnpm approve`: `@cloudflare/workers-oauth-provider`, `@tanstack/router-plugin`, `@tanstack/virtual-file-routes` e `drizzle-kit`. Não foram aprovados.
- As exclusões de idade mínima de release (`minimumReleaseAgeExclude`) para wrangler, workerd, Kubb, shadcn e better-auth podem ser removidas a partir de 2026-10-20.

## Falhas e problemas durante a execução

- O agente do ticket 07 caiu por rate limit do Opus antes de escrever qualquer coisa. Foi reiniciado no Sonnet. Depois de terminar, ficou em laço de espera e gerou dezenas de avisos falsos e 36 processos `sleep` residuais. Parei esse agente por conta própria, sem esperar uma resposta que não viria numa execução sem humano, e os processos sumiram.
- Testes de `.factory` e Playwright estouraram timeout algumas vezes com a máquina sobrecarregada (load average entre 100 e 330, por causa de outros projetos). Em cada caso o teste passou isolado ou numa nova rodada. O `db check` e o harness ganharam timeouts maiores, e as fixtures do harness passaram a ser copiadas em vez de recriadas por teste.
- O `verify` do ticket 13 ficou vermelho duas vezes em `example:e2e` pelo mesmo motivo. O merger confirmou que passou com a máquina mais livre, e só então o merge foi commitado.
- A revisão de código achou 15 itens. Foram corrigidos 13, o 3 (`.gitignore`) já estava coberto, e o 4 foi aplicado só em parte (os dois `execFileSync("git")` de `ci/matrix.ts` e do Skeleton ficaram, porque o Skeleton não pode depender de `.factory`). Não corrigi os commits sem referência `#N`: só 2 dos 40 citam uma issue.
- A versão do ticket 07 mudou o título `pt-BR` do `example` de "Exemplo" para "Example".

## Decisões e desvios que merecem sua revisão

- **TypeScript 7 + oxlint em vez de ESLint**, porque o typescript-eslint não aceita TypeScript 7. Node 24.22.0 LTS no `.node-version`; o Node 26 vira LTS em 2026-10-28.
- **pnpm 12.14.0** é exigido pelo workspace. Foi instalado via proto em `~/.proto/tools/pnpm/12.14.0`. O pnpm 10 global não consegue trocar para ele.
- **Versões da spec que mudaram:** wrangler 4.151.2 (não 4.135), `@cloudflare/vitest-plugin` no lugar do `vitest-pool-workers`, `@kubb/adapter-oas` no lugar do `plugin-oas` e `@kubb/plugin-fetch` adicionado, `@base-ui/react` (renomeado), MCP SDK v2 para o `createMcpHandler`. Tudo registrado em `notes/versions.md` (fora do repo, em `Factory-Template.worktrees/notes/`) e nos tickets.
- **19 skills do Matt em vez de 18**, porque a lista decidida no ticket 25 do wayfinder nomeia 19. Para voltar a 18, basta remover uma.
- **Hook do git em Node**, porque a imagem não tem `jq`. `.claude/hooks` entrou nos caminhos protegidos.
- **Seams ajustados em relação à spec:** `CodeHost.branchHead` e `labelPr`; `Agent.run` e `Verify.run` com `timedOut`; motivo de Escalation `protected-paths` fora do enum do `result.json` (registrado no ticket 09).
- **Convenção de prints `@evidence`:** `test-results/evidence/<product>/<name>.png`.
- **`ci-probe` fora do `factory:verify`**, porque quase dobraria o tempo. O ticket 12 chama `pnpm factory:ci-probe` como job.
- **PRs de fork usam a imagem do commit base**, para que o `setup.sh` de um fork nunca rode com `packages: write`.
- **Rate limit:** janela fixa aberta na primeira tentativa (o Better Auth reinicia a cada tentativa aceita). O limite é o mesmo, 3 em 10 s.
- **`GITHUB_STEP_SUMMARY` e custo estimado:** o preço do Opus 5.5 (US$ 4 / US$ 20 por milhão de tokens) está em `config.ts`, conferido em 2026-10-19.
- Itens da `Feature` adiados no ticket 07: `messages.ts` e códigos de erro por feature, `nav`/`companyPage`/`events` só como tipos, `seed` ainda não ligado ao E2E nem ao branch Neon.

## Próximos passos

1. **Resolver as pendências humanas** acima, começando pelo ticket 12 (instalar os workflows), que destrava o CI e os tickets seguintes.
2. **Mesclar `factory-base` em `main`** por PR, depois de revisar. O diff é grande (cerca de 480 arquivos), em boa parte as skills que viraram symlinks. `main` não foi tocada.
3. **Tickets 14 a 22** (precisam de contas reais, TTY e workflows na `main`):
   - 14 produção do Product e as medições na conta;
   - 15 previews de PR;
   - 16 Factory no Actions;
   - 17 Blocked Issues e Triage;
   - 18 comentários no PR e update-branch;
   - 19 `destroy`;
   - 20 runner próprio;
   - 21 ADRs e docs da base pronta;
   - 22 prompt de instalação no Forgejo.
4. A Factory só deve receber a primeira issue do backlog do Skeleton depois de "base pronta": as três partes do bootstrap com `doctor` verde, um deploy de teste, um PR de teste com preview e smoke, `new-product ci-probe` passando e os critérios de aceite medidos.
5. Limpeza local: os branches `ticket-01` a `ticket-13` e `review-fixes` já estão mesclados e podem ser apagados com `git branch -d`. O worktree `integration` fica até você mesclar.
