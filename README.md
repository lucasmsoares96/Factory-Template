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

1. `pnpm bootstrap product <id>`: cria a pasta `apps/<id>/` se ela não existir (pergunta o título e o domínio, ou lê `--title` e `--domain`; é o mesmo código do `pnpm new-product <id>`) e prepara o banco (pergunta a região do banco uma vez por Product, com São Paulo, `aws-sa-east-1`, como padrão; sem terminal vem de `NEON_REGION`; a região não muda depois), os segredos, o ambiente e a conta padrão. Se a pasta já existe, nada nela muda. Ele não faz commit nem push.
2. `pnpm dev <id>`: roda o projeto na sua máquina.
3. Abra o pull request com `apps/<id>/` e o `pnpm-lock.yaml` (a pasta criada ainda não está no git).
4. Faça o merge. O Worker só existe depois do primeiro deploy.
5. O primeiro deploy: `gh workflow run factory-deploy.yml --ref main`.
6. Os opcionais, quando quiser: `pnpm bootstrap previews <id>`, `pnpm bootstrap domain <id>` e `pnpm bootstrap billing <id>`.

Quer só a pasta, sem contas nem banco? `pnpm new-product <id>`.

Precisa trocar a região do banco? Ela não muda com o banco criado: rode `pnpm bootstrap destroy db <id>` (apaga só os projetos da Neon e o que depende deles, incluindo a conta padrão; não toca no Worker, nos ambientes nem na regra da `main`), depois `pnpm bootstrap product <id> --redo region` e `pnpm bootstrap previews <id>`. O e-mail e a senha da conta padrão são pedidos de novo.

## Rodar na sua máquina

`pnpm dev <id>` sobe o Worker e a SPA com um Postgres local. Há dois modos de cobrança:

- **Stripe falsa (padrão):** `pnpm dev <id>`. A cobrança roda numa Stripe que vive dentro do Worker, sem internet nem chave.
- **Sandbox real da Stripe:** `pnpm dev <id> --stripe`. O Checkout, o Billing Portal e os webhooks são os da Stripe de verdade. Use a sandbox dos Previews, que já tem os planos do Product (`pnpm bootstrap billing <id>`). Crie uma chave restrita nela e exporte:

  ```sh
  read -s -p "Stripe sandbox key: " STRIPE_SECRET_KEY; export STRIPE_SECRET_KEY
  ```

  Só chaves de sandbox (`sk_test_`, `rk_test_`) são aceitas; uma `sk_live_` é recusada antes de subir qualquer coisa. O comando sobe o Vite na porta 5173 e o `stripe listen` (Stripe CLI, já no catálogo; não instale nada), que encaminha os webhooks para `localhost:5173/api/auth/stripe/webhook`. O Worker roda com `BILLING_ENVIRONMENT=local`: o que ele cria fica marcado `local`, os Previews ignoram esses eventos e ele só aceita os marcados `local`. Se um dos dois processos cai, o outro cai junto.

Cartões de teste: `4242 4242 4242 4242` paga, `4000 0000 0000 0002` recusa, `4000 0027 6000 3184` pede o 3D Secure, `4000 0000 0000 0341` falha ao cobrar. Para disparar um evento com o `--stripe` rodando, use `pnpm --filter @workspace/skeleton exec stripe trigger <evento> --api-key $STRIPE_SECRET_KEY` (por exemplo, `customer.subscription.trial_will_end`).
