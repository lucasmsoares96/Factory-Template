# 19: `destroy`

Spec: [../spec.md](../spec.md)

**What to build:** quem copiou o Template desmonta tudo, um Product ou um módulo com `pnpm bootstrap destroy`, vendo antes a lista do que vai sumir e confirmando pelo id. Nenhum agente consegue rodar o comando.

**Blocked by:** 16

**Status:** ready-for-agent

- [ ] `destroy [product <id> | módulo]`; sem argumento, apaga tudo.
- [ ] Apaga Worker e Previews, KVs, projetos Neon, domínio no Resend, secrets, variáveis, environments, ruleset e colaborador; não apaga o repo, as issues, as labels nem as contas.
- [ ] Mostra a lista com o banco de produção em destaque e exige digitar o id.
- [ ] Recusa sem TTY ou com `CI` definido; regra no `AGENTS.md` da raiz (o `deny` já vem do ticket 11).
- [ ] Testes contra os falsos: o que some em cada escopo, recusa sem TTY e com `CI` (seam 8).
- [ ] Demonstração: `new-product` de um Product descartável, `bootstrap product` dele e `destroy product <id>` deixando a conta como estava.
