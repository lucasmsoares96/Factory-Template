# 15: Previews por PR

Spec: [../spec.md](../spec.md)

**What to build:** com o módulo Previews configurado, todo PR de autor confiável ganha um preview `pr-N` por Product afetado, com banco próprio sem dados reais e os emails visíveis no outbox, e o PR recebe um comentário com as URLs. O código do PR nunca roda com secrets, e tudo some quando o PR fecha.

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] Módulo Previews: projeto Neon `<id>-preview` com branch padrão `base` e key restrita, KV do preview em `PREVIEW_OAUTH_KV_ID`, o id em `PREVIEW_PRODUCTS`, `PREVIEWS_ENABLED` ligado depois do `doctor`.
- [ ] Workflow em `pull_request_target`: `build` (ticket 12) → `deploy` com as regras de blindagem (checkout e `--config` da `main`, artifact em `$RUNNER_TEMP` com allowlist, `CLOUDFLARE_API_BASE_URL` fixado, `--ignore-scripts` com o lockfile da `main`, número do PR do evento), branch `preview/pr-N` a partir do `base`, `migrate(db, { migrationsFolder })`, `wrangler preview --name pr-N` → `smoke` sem secrets (login real, outbox, 401 no `/mcp`) (seam 7).
- [ ] Rota do outbox que só existe no preview.
- [ ] Comentário único no PR listando cada Product com a URL.
- [ ] Preview automático para autor com `write`+; os demais pela label `preview`, removida a cada push.
- [ ] Pula com comentário quando os bindings mudaram ou há 9 previews abertos do Product ("preview skipped: limit reached").
- [ ] Limpeza no `closed`: `wrangler preview delete` + branch Neon apagado. O deploy da `main` recria o `base` se ele sumir.
- [ ] Testes do módulo contra os falsos (seam 8).
- [ ] PR de teste com preview e smoke verdes, depois fechado e limpo (Worker Preview, branch Neon, branch git).
- [ ] Critério medido e registrado aqui: permissões do token da Cloudflare que criam um Worker Preview (workers-sdk#15797).
