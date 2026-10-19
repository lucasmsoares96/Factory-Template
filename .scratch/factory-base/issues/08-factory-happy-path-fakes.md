# 08: Caminho feliz da Factory contra falsos

Spec: [../spec.md](../spec.md)

**What to build:** o harness leva uma issue `ready-for-agent` até um PR `ready` com review e evidência, num teste que roda sem Claude, sem Docker e sem forja. É o esqueleto do pacote `.factory/`: a CLI, a configuração, os quatro seams e o caminho `claim` → `work` → `publish` em que tudo dá certo na primeira tentativa.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Pacote `.factory/` no workspace com a CLI `pnpm factory <comando>` e `config.ts` (modelos, timeouts, 5 tentativas, labels, limite de previews), sobrescrevível por variável do repo.
- [x] Interfaces `Tracker`, `CodeHost`, `Agent` e `Verify` como na spec, com adaptadores falsos em memória (o `Agent` falso é roteirizado). Tokens fora das interfaces.
- [x] `claim`: guard básico (aberta, `ready-for-agent` posta por quem tem `write`+, critérios e seams presentes, bloqueadores `done`) e trava `ready-for-agent` → `in-progress`.
- [x] `work`: uma tentativa Development → Review → E2E, sessão nova por Stage, gate "gerou commits", saída em `result.json` validado por Zod.
- [x] `publish`: valida o `result.json`, faz push com `--force-with-lease`, abre PR draft `Fix #N: <título>` com `Closes #N`, review `COMMENT` com inline filtrado ao diff, comentário de evidência único e `ready`.
- [x] Testes do caminho feliz pela CLI contra os falsos, conferindo labels, PR, review e evidência (seam 1).

## Comments

Versões conferidas no registro do npm em 2026-10-19 e fixadas no catalog de `pnpm-workspace.yaml`: `zod` 4.6.7 (2026-10-12), `vitest` 5.0.5 (2026-10-15), `typescript` 7.0.2 (2026-07-08), `@types/node` 26.6.5 (2026-10-09). Modelo padrão de todos os Stages: `claude-opus-5-5` (Opus atual). Node local 26.3.0; a CLI usa type stripping e `import.meta.main`, então pede Node ≥ 24.2. pnpm local 10.28.1 (sem `packageManager` fixado: fica para o ticket 01).

Como rodar: `pnpm --filter @factory/harness test` (23 testes) e `pnpm --filter @factory/harness typecheck`. Os testes usam repos git temporários (git é permitido; sem Claude, Docker ou forja), com config git isolada pelo `vitest.config.ts`.

Raiz mínima para o merge com o 01: `package.json` só com o script `factory`, `pnpm-workspace.yaml` com `.factory` e o catalog, `.gitignore` com `node_modules/`.

Decisões e desvios da spec:
- `CodeHost` ganhou `branchHead(branch)`: o `claim` lê o head de `factory/issue-N` e o devolve como `startSha`; o `publish` recebe `--start-sha` do job `claim` (não do `result.json`, que vem da VM do agente) e faz o push com lease contra ele. `openPrFor` recebe o branch, não o número da issue.
- `Agent.run` recebe `{ timeoutMs, model }` (o harness escolhe o modelo por Stage no `config.ts`) e devolve também `timedOut`. `Verify.run` recebe `{ timeoutMs }`.
- Override por variável: cada folha do `config.ts` vira `FACTORY_<CAMINHO>` (`FACTORY_MAX_ATTEMPTS`, `FACTORY_TIMEOUTS_DEVELOPMENT`, `FACTORY_LABELS_IN_PROGRESS`, `FACTORY_MACHINE_USER`...), validado com Zod.
- Prints: o E2E `@evidence` deve gravar em `test-results/evidence/<product>/<nome>.png` (`evidenceDir` no `config.ts`); o `work` copia para `evidence/` ao lado do `result.json` e do `branch.bundle`.
- A Review termina com `<review>{summary, inline[]}</review>`; sem bloco válido, a mensagem inteira vira o resumo.
- Fica para o 09 (hoje lança erro claro): Escalation (`outcome: escalated`), "Run discarded" (push recusado pelo lease), releitura do estado antes de escrever, timeouts, teto global, caminhos protegidos. O laço de tentativas já existe (o gate "gerou commits" leva à tentativa seguinte, testado); a falha do E2E já volta ao Development com o comando e a saída cortada, mas ainda sem teste próprio.
- Fica para o 10/16: `FACTORY_ADAPTERS=local|github` em `src/adapters/index.ts` (hoje só explica que não há adaptador real); os prompts em `src/prompts.ts` viram templates em `.factory/prompts/`.
