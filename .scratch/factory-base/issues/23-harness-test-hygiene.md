# 23: Testes do harness estáveis e sem lixo em `/tmp`

Spec: [../spec.md](../spec.md)

**What to build:** a suíte do `@factory/harness` passa sob carga e não deixa nada para trás. Hoje o `test/skeleton-scope.test.ts` ("escalates as needs-human, naming the follow-up…") estoura o timeout de 120 s quando a máquina está carregada e passa sozinho (três vezes em 2026-10-20), e os testes de `publish` criam diretórios `factory-artifacts-*` em `/tmp` sem apagá-los.

**Blocked by:** None (can start immediately)

**Status:** done

## Acceptance criteria

- [x] O teste do `skeleton-scope` deixa de depender do tempo da máquina: menos chamadas ao git ou fixture compartilhada, como o ticket 09 fez para `work` e `publish`, sem só subir o timeout.
- [x] Todo diretório temporário criado pelos testes do harness é apagado no fim do teste, passando ou falhando; nenhum `factory-artifacts-*` sobra em `/tmp` depois da suíte.
- [x] Um teste confere que a suíte não deixa diretórios temporários.
- [x] `TURBO_FORCE=1 pnpm factory:verify` verde duas vezes seguidas.

## Comments

- Causes (2026-10-20): each `git` call costs ~0.15 s here and `run()` made ~65 per test, so a loaded machine multiplied it past 120 s. Fixes: base commit with the Skeleton files made once per file (`derivedCheckout` in `test/helpers.ts`) instead of per test (commit + fetch + reset), `maintenance.auto=false` for test git, and `revertToBase` batched (one `ls-tree`, one `checkout`, one `rm` instead of 3 per path).
- Temp dirs: `afterEach` removal now retries; the run gets a private `TMPDIR` (`test/global-setup.ts`) and fails if anything is left; `test/temp-hygiene.test.ts` runs a probe file (passing and failing tests) in a child vitest and checks its TMPDIR is empty. The old `factory-*` dirs in /tmp came from interrupted/killed runs.
- Skeleton: `db.test.ts` timed out at the first CREATE DATABASE on a cold Postgres, now warmed up in the global setup; `email-outbox.test.ts` polls the row (Better Auth sends in `waitUntil`, nothing to await) up to the test's own timeout instead of 10 s.
- `sandcastle-agent` resume test: 10 min Stage timeout checked, fine.
- Pending (orchestrator): `TURBO_FORCE=1 pnpm factory:verify` green twice, checked at merge (criterion left unticked).


Merge (2026-10-20/21): na `factory-base` com os tickets 16–20 juntos, `TURBO_FORCE=1 pnpm factory:verify` verde duas vezes seguidas (13/13 tarefas, 703/703 testes do harness cada), com load average 85–96, e nenhum diretório `factory-*` sobrando. No caminho, a checagem nova pegou dois problemas reais: um teste do ticket 16 importava os helpers dinamicamente (a limpeza não rodava; corrigido com import estático) e a sonda do próprio teste de higiene usava o timeout padrão de 5 s do vitest (agora o mesmo do harness).
