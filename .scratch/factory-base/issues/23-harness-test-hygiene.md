# 23: Testes do harness estáveis e sem lixo em `/tmp`

Spec: [../spec.md](../spec.md)

**What to build:** a suíte do `@factory/harness` passa sob carga e não deixa nada para trás. Hoje o `test/skeleton-scope.test.ts` ("escalates as needs-human, naming the follow-up…") estoura o timeout de 120 s quando a máquina está carregada e passa sozinho (três vezes em 2026-10-20), e os testes de `publish` criam diretórios `factory-artifacts-*` em `/tmp` sem apagá-los.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance criteria

- [ ] O teste do `skeleton-scope` deixa de depender do tempo da máquina: menos chamadas ao git ou fixture compartilhada, como o ticket 09 fez para `work` e `publish`, sem só subir o timeout.
- [ ] Todo diretório temporário criado pelos testes do harness é apagado no fim do teste, passando ou falhando; nenhum `factory-artifacts-*` sobra em `/tmp` depois da suíte.
- [ ] Um teste confere que a suíte não deixa diretórios temporários.
- [ ] `TURBO_FORCE=1 pnpm factory:verify` verde duas vezes seguidas.
