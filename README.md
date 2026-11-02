# Factory Template

A repository of Products plus the harness that builds them. See [AGENTS.md](AGENTS.md) for the map and [GLOSSARY.md](GLOSSARY.md) for the terms.

## Install

[proto](https://moonrepo.dev/docs/proto) is the only tool you install by hand. `.prototools` pins Node, pnpm and the GitHub CLI (`gh`); the `gh` plugin is `.proto/gh.toml`, which downloads the official `cli/cli` release and checks its checksum.

1. Install proto: `bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)`.
2. In the clone, run `proto install`. If proto refuses the `gh` plugin because the configuration is not trusted, run `proto trust` once in the clone first: `[plugins]` is a security-sensitive setting, applied only to a trusted path.
3. Run `pnpm install`, then `pnpm bootstrap`.

Export variables that hold a secret with `read -s`, so the token stays out of the shell history:

```sh
read -s -p "GitHub token: " GITHUB_TOKEN; export GITHUB_TOKEN
```

## Criar um projeto novo

O fluxo inteiro, em ordem (`<id>` em minúsculas, dígitos e hifens; ex.: `notas`):

1. `pnpm bootstrap product <id>`: cria a pasta `apps/<id>/` se ela não existir (pergunta o título e o domínio, ou lê `--title` e `--domain`; é o mesmo código do `pnpm new-product <id>`) e prepara o banco, os segredos, o ambiente e a conta padrão. Se a pasta já existe, nada nela muda. Ele não faz commit nem push.
2. `pnpm dev <id>`: roda o projeto na sua máquina.
3. Abra o pull request com `apps/<id>/` e o `pnpm-lock.yaml` (a pasta criada ainda não está no git).
4. Faça o merge. O Worker só existe depois do primeiro deploy.
5. O primeiro deploy: `gh workflow run factory-deploy.yml --ref main`.
6. Os opcionais, quando quiser: `pnpm bootstrap previews <id>`, `pnpm bootstrap domain <id>` e `pnpm bootstrap billing <id>`.

Quer só a pasta, sem contas nem banco? `pnpm new-product <id>`.
