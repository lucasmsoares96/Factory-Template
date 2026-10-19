# 14: Produção de um Product

Spec: [../spec.md](../spec.md)

**What to build:** `pnpm bootstrap product example` configura a produção do `example`, e todo merge na `main` passa a fazer deploy dos Products afetados pelo Actions, com smoke de login real. O `example` está no ar num `workers.dev`, e um `exceededCpu` no hash apareceria como deploy vermelho.

**Blocked by:** 07, 12, 13

**Status:** ready-for-agent

- [ ] Módulo Produção: projeto Neon `<id>` (procura antes de criar) com key restrita, domínio do Resend adiável com os registros DNS mostrados, secrets `<ID>_`, o id em `DEPLOY_PRODUCTS`, `DEPLOY_ENABLED` ligado depois do `doctor`.
- [ ] Environments `<id>-production`/`<id>-preview` restritos à `main` e ruleset na `main` (PR obrigatório, sem force-push nem exclusão, check `verify`), com queda para secrets no repo e `FACTORY_USE_ENVIRONMENTS=false` quando a API recusar.
- [ ] Workflow de deploy da `main`: `build` sem secrets → `deploy` (código da `main`, config gerado com o id, migrations do Skeleton e do Product, `wrangler deploy --name <id>`, KV de produção pelo provisionamento automático) → `smoke` (login real, 401 com `WWW-Authenticate` no `/mcp`) (seam 7).
- [ ] O deploy da `main` também migra o branch `base` do preview quando o módulo Previews existir.
- [ ] Testes do módulo contra os falsos: queda para o nível do repo, prefixo `<ID>_` (seam 8).
- [ ] Deploy de teste do `example` pelo Actions.
- [ ] Critérios medidos e registrados aqui: login real sem `exceededCpu` no `PasswordHasher`; CPU por request do `/mcp` no Free; resposta da API a environment e ruleset num repo privado no Free. O que for criado só para medir é apagado.
