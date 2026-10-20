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
- [ ] Medidos também aqui, vindos dos tickets 03 e 04: 429 do rate limit por IP atrás da Cloudflare (`cf-connecting-ip`); linhas do `RateLimiter` dentro das cotas de DO do Free; CPU do render do email no Worker.
- [ ] Critérios medidos e registrados aqui: login real sem `exceededCpu` no `PasswordHasher`; CPU por request do `/mcp` no Free; resposta da API a environment e ruleset num repo privado no Free. O que for criado só para medir é apagado.

## Comments

2026-10-20: o domínio do Resend já existe como `pnpm bootstrap domain <id>` (ticket 13, branch `bootstrap-domain`): etapas `resend-domain` (adiável, procura antes de criar), `dns-records` (cria os registros que faltam na zona da Cloudflare ou os imprime, e verifica o domínio), `restricted-resend-key` (secret `<ID>_RESEND_API_KEY`) e `worker-domain` (Custom Domain do Worker), reutilizáveis por `domainSteps(product)` em `.factory/src/bootstrap/domain.ts`. O critério "domínio do Resend adiável com os registros DNS mostrados" fica coberto em parte; nenhum critério foi marcado.

O que resta aqui: `bootstrap product <id>` precisa chamar `domainSteps` dentro do módulo Produção (ou pedir o comando separado), criar o projeto Neon `<id>` com key restrita, gravar os outros secrets `<ID>_`, `<ID>_RESEND_API_KEY` com a queda para secrets no repo (hoje o `domain` grava no repo via `setSecret`, sem environment), o id em `DEPLOY_PRODUCTS` e `DEPLOY_ENABLED` depois do `doctor`. O `worker-domain` só funciona depois do primeiro deploy (o Worker `<id>` precisa existir): o fluxo do 14 deve rodar `--redo worker-domain` depois do deploy de teste. O `doctor <id>` do 14 deve somar a seção de domínio (já existe) às demais.

Pending (human): `pnpm bootstrap domain example` na conta real.

