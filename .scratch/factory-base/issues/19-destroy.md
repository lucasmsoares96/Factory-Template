# 19: `destroy`

Spec: [../spec.md](../spec.md)

**What to build:** quem copiou o Template desmonta tudo, um Product ou um módulo com `pnpm bootstrap destroy`, vendo antes a lista do que vai sumir e confirmando pelo id. Nenhum agente consegue rodar o comando.

**Blocked by:** 16

**Status:** ready-for-agent

- [x] `destroy [product <id> | módulo]`; sem argumento, apaga tudo.
- [x] Apaga Worker e Previews, KVs, projetos Neon, domínio no Resend, secrets, variáveis, environments, ruleset e colaborador; não apaga o repo, as issues, as labels nem as contas.
- [x] Mostra a lista com o banco de produção em destaque e exige digitar o id.
- [x] Recusa sem TTY ou com `CI` definido; regra no `AGENTS.md` da raiz (o `deny` já vem do ticket 11).
- [x] Testes contra os falsos: o que some em cada escopo, recusa sem TTY e com `CI` (seam 8).
- [ ] Demonstração: `new-product` de um Product descartável, `bootstrap product` dele e `destroy product <id>` deixando a conta como estava.

## Comments

Código implementado em 2026-10-20 (branch `ticket-19`). Escopos: `product <id>` (produção + previews), `previews <id>`, `factory`, `common` e, sem argumento, tudo (`all`). Confirmação digitada: o id, `factory`, `common` ou `all`. Código em `.factory/src/bootstrap/destroy.ts`; métodos `delete*` nos clientes reais e falsos; testes em `test/bootstrap/destroy.test.ts` (recusas, o que some e o que fica em cada escopo, confirmação errada, falha parcial, credenciais) e `adapters.test.ts`. A regra "nunca rodar `bootstrap destroy`" já estava no `AGENTS.md` da raiz.

Decisões: o ruleset `main` e as listas `DEPLOY_PRODUCTS`/`PREVIEW_PRODUCTS` (com `DEPLOY_ENABLED`/`PREVIEWS_ENABLED`) só somem com o último Product; secrets dos Products são nomeados um a um (nunca por prefixo `<ID>_`, que pegaria `SHOP_2_*`); projeto Neon com nome repetido não é apagado e vira falha; registros DNS e o subdomínio workers.dev nunca são tocados; a chave restrita do Resend não tem id guardado e fica (o domínio some). Falhas viram lista no fim e exit 1.

Pending (human): demonstração na conta real (Product descartável com `new-product`, `bootstrap product`, `destroy product <id>`). Também conferir nela: (1) o nome do KV de produção criado pelo auto-provisionamento do wrangler (o `destroy` procura `<id>-oauth-kv`); (2) que `DELETE .../workers/scripts/<name>?force=true` leva junto os Worker Previews e os Custom Domains (o `destroy` desanexa os domínios antes); (3) `neonctl projects delete <id>` sem `--org-id`.
