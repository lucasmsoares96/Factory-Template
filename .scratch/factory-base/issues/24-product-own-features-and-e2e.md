# 24: O `example` recebe features próprias e cada Product tem seus E2E

Spec: [../spec.md](../spec.md)

**What to build:** um dev (ou a Factory) consegue dar ao `example` uma feature, um texto ou uma tela própria, com teste E2E `@evidence` do próprio Product, sem mexer no Skeleton. Hoje isso é impossível por dois motivos, achados pela demonstração com Claude real do ticket 05 do PR bottleneck (2026-10-20): `packages/skeleton/test/new-product.test.ts` exige que `apps/example` seja byte a byte a saída do molde, e `defineE2EConfig` (`packages/skeleton/e2e/index.ts`) só roda os specs do Skeleton. O usuário decidiu (2026-10-20) que o `example` pode receber features próprias.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance criteria

- [ ] O teste do molde deixa de exigir que `apps/example` seja igual ao molde. O molde continua provado: `new-product <id>` numa pasta temporária gera um Product que passa no `typecheck`, no `lint` e no `generate` (e o `ci-probe` continua cobrindo o `verify` completo).
- [ ] `defineE2EConfig` roda os specs do Skeleton e também os do Product em `apps/<id>/e2e/`, com o mesmo fixture (`t`, `mailbox`, `evidence`), as mesmas regras de localização (role + chave do i18n ou `data-testid`) e os prints em `test-results/evidence/<product>/<name>.png`.
- [ ] O molde traz a pasta `e2e/` do Product (vazia, com um `.gitkeep`, ou com um spec de exemplo mínimo), e o `AGENTS.md` do Product diz onde ficam os specs dele.
- [ ] A skill `skeleton-evidence-test` e o `AGENTS.md` do Skeleton deixam de dizer que um Product não tem specs próprios.
- [ ] Um teste prova que um spec em `apps/example/e2e/` roda no `e2e` do `example` e salva o print no diretório de evidência do Product.
- [ ] `TURBO_FORCE=1 pnpm factory:verify` verde.

## Comments

Ticket de acompanhamento original, aberto pela Factory durante a demonstração (`<skeleton-gap>`): "`defineE2EConfig` needs an option such as `testDir` so a Product can run its own specs; `new-product.test.ts` blocks any change to the `example` Product".
