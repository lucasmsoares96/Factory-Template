# 01: Retomada de extração no seam `Agent`, usada pelo Review

Spec: [../spec.md](../spec.md)

**What to build:** quando a sessão do Review termina sem um bloco `<review>` válido, a Factory retoma a mesma sessão e pede o bloco de novo, até 2 vezes, como o `runWithExtraction` do Sandcastle (`maxRetries: 2`). Os tokens das retomadas entram no uso do Review, e a retomada conta dentro do timeout do Stage. Depois das 2 retomadas, vale o fallback de hoje: a mensagem crua vira o summary. A retomada serve só para extrair a saída; nenhum Stage é retomado para continuar o trabalho.

**Blocked by:** None (can start immediately). Fecha antes do [ticket 21 da base](../../factory-base/issues/21-base-ready-adrs.md).

**Status:** done

- [x] O seam `Agent` aceita o validador do bloco esperado e devolve quantas retomadas houve, com os tokens somados.
- [x] O adaptador do Sandcastle retoma a mesma sessão para extrair; o adaptador falso segue um roteiro (bloco inválido, depois válido).
- [x] O comentário do seam diz que a sessão nunca é retomada para continuar o trabalho, só para extrair a saída.
- [x] O Review usa a retomada.
- [x] Testes pela CLI contra os falsos: bloco válido sem retomada; válido na 1ª e na 2ª retomada; inválido depois de 2, com o fallback da mensagem crua; tokens somados; timeout do Stage respeitado (seam 1).
- [x] Teste do adaptador do Sandcastle para a retomada.
- [x] ADR em `docs/adr/`: a retomada só para extração num seam de sessões novas, com as alternativas (sessão nova por retentativa; sem retentativa).
- [x] `pnpm factory:verify` verde.

## Comments

- Sandcastle 0.12.0 (npm latest, checked 2026-10-20, modified 2026-06-29) resumes sessions: `run({ resumeSession })` runs `claude --resume <id>`, and the host session file must exist (under `HOME` with `noSandbox()`). Chosen over `Output.object({ maxRetries })` to keep the harness validator and the per-resume `stream-json` files; the session id comes from the stream-json init event. No Claude Code CLI fallback needed.
- Seam: `Agent.run(..., { extract })` and `AgentRun.retries`; the stage record in `result.json` carries `retries`. Fake: a step returns `resumes: [...]`. Tests: `review-extraction.test.ts` (seam 1), `sandcastle-agent.test.ts`. ADR: `docs/adr/0001-resume-session-only-to-extract-output.md`.
- Pending (human): the measured run with real Claude (`pnpm factory local`) showing a resume working in the Sandcastle adapter (spec acceptance); real Claude's `--resume` usage totals were not verified.
- `pnpm factory:verify` NOT run (coordinator: machine overloaded; the orchestrator runs it serially at merge). Verified instead: `typecheck` clean; vitest green on review-extraction, sandcastle-agent, work, work-failures, prompts.


Merge (2026-10-20): `TURBO_FORCE=1 pnpm factory:verify` verde na `factory-base` (12/12). O teste de retomada do adaptador falhava sob carga porque o Stage de 60 s acabava antes da retomada; o timeout comum dos testes do adaptador passou a 10 min (o teste de timeout define o seu). A demonstração com Claude real é do ticket 05.
