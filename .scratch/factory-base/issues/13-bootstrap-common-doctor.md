# 13: Bootstrap: estrutura, parte comum e `doctor`

Spec: [../spec.md](../spec.md)

**What to build:** quem copia o Template roda `pnpm bootstrap`, configura a parte comum a todos os Products (Cloudflare e labels) e confere tudo com `pnpm bootstrap doctor`. Rodar de novo não cria nada repetido. A estrutura do wizard, com clientes falsos, fica pronta para os módulos dos tickets seguintes.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] Wizard em TS com `@clack/prompts` dentro de `.factory/`, `pnpm bootstrap`; `gh` como único pré-requisito, `wrangler` e `neonctl` como devDependencies; chamadas ao `gh` num módulo de forja só.
- [ ] Clientes de GitHub, Cloudflare, Neon e Resend atrás de interfaces, com adaptador real e falso.
- [ ] Sem estado local e sem segredo em disco: cada etapa consulta o estado e pula o que existe; `--redo <etapa>`.
- [ ] Parte comum: token da Cloudflare pela URL do template "Edit Cloudflare Workers", `CLOUDFLARE_ACCOUNT_ID`, registro do `workers.dev` se faltar, labels a partir do `config.ts` (`gh label create --force`).
- [ ] `doctor` só leitura: secrets, variáveis, labels, recursos e permissões, mostrando o que ficou desligado.
- [ ] Testes contra os falsos: segunda execução não cria nada, `--redo`, labels conferidas (seam 8).
