# 07: `new-product` e molde

Spec: [../spec.md](../spec.md)

**What to build:** um dev roda `pnpm new-product <id>` e ganha um Product novo que já sobe com `pnpm dev <id>`, passa no `verify` e roda os E2E do Skeleton, sem editar nenhum arquivo do Skeleton. O `example` passa a ser exatamente o que o molde gera.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Molde dentro do pacote do Skeleton; `pnpm new-product <id>` cria `apps/<id>/`, registra o Product no workspace e mostra o comando do bootstrap.
- [ ] Identidade em `product.config.ts` (`id`, `title`, `emailFrom`, domínio); tema por tokens do shadcn e textos do i18n por cima.
- [ ] Interface `Feature` (`id`, `api`, `mcp?`, `nav?`, `companyPage?`, `seed?`, `events?`) exportada pelo Skeleton; features e roles a mais (`INSERT` em `member_roles`) do Product entram por ela.
- [ ] Cada Product tem o seu snapshot do `tools/list` e as suas migrations, aplicadas depois das do Skeleton.
- [ ] Specs de E2E do Skeleton ficam no pacote e rodam no `e2e` de cada Product.
- [ ] `pnpm dev` sobe o Product quando há um só e pede `pnpm dev <id>` quando há vários.
- [ ] O molde gera o `AGENTS.md` do Product (conteúdo final no ticket 11).
- [ ] Teste: `new-product` numa cópia temporária + `verify` passa, e a cópia é apagada no fim.
