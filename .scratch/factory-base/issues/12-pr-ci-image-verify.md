# 12: CI do PR: imagem e `verify` por Product afetado

Spec: [../spec.md](../spec.md)

**What to build:** todo PR roda o `verify` só dos Products afetados, dentro da imagem publicada no GHCR, sem nenhum secret, e o check `verify` fica verde ou vermelho no PR. O CI também confere as skills e cria um Product descartável para provar que o molde continua verde.

**Blocked by:** 10, 11

**Status:** ready-for-agent

- [ ] Job reaproveitável `image` (`packages: write`): calcula o hash, confere a tag no GHCR, constrói e publica só se faltar, devolve a tag. O PR que sobe uma versão testa com a imagem nova.
- [ ] Job `build` em `container:` da imagem, `contents: read`, `packages: read`, `persist-credentials: false`, sem cache e sem secrets, Postgres por `services:`, `runs-on` aceita `vars.FACTORY_RUNNER`.
- [ ] Checkout com `--filter=blob:none`; `turbo query affected --packages` monta a matrix (`fail-fast: false`); arquivos da raiz em `globalDependencies`; mudanças só em `.factory/` ou `.github/` rodam os testes do harness.
- [ ] Job `skills-check` com o CLI `skills` fixado: restaura do lock, `git diff --exit-code`, confere symlinks.
- [ ] Job `ci-probe`: `new-product ci-probe` numa cópia temporária + `verify`, sem deploy, cópia apagada no fim.
- [ ] Saem `claude.yml` e `claude-code-review.yml`.
- [ ] Testes estáticos do YAML: `build` só em `container:` e só ele (com o `work`, depois) aceita `vars.FACTORY_RUNNER` (seam 2).
- [ ] Critérios medidos e registrados aqui: "Initialize containers" com a imagem × `setup.sh` direto na VM (se não for mais rápido, reabrir a escolha); `actions/checkout` no container com `USER 1001`; visibilidade com que o pacote do GHCR nasce num repo público e leitura com `packages: read`.
