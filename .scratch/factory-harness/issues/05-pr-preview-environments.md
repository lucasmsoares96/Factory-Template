# Ambiente de preview por PR

Type: research
Status: resolved

## Question

Como ter um ambiente de preview completo por PR nesta stack: front (Pages preview deployments ou Workers versions/preview URLs com Static Assets), back (Workers preview URLs / `wrangler versions upload` / ambientes nomeados), banco (**Neon branch por PR** via GitHub Action oficial do Neon, aplicar migrations do Drizzle no branch, connection string injetada no Worker), secrets por ambiente, email no preview (Resend em modo de teste), e limpeza quando o PR é fechado? Qual é o fluxo oficial recomendado por Cloudflare e Neon para isso em outubro de 2026, e como o E2E e os prints podem apontar para a URL do preview?

## Answer

- Desde 2026-09-22 o fluxo oficial é **Worker Previews** (`wrangler preview --name pr-N`, wrangler ≥ 4.135; hoje 4.151.1, "open beta" no código). Cada Preview é isolado no mesmo Worker, com vars, secrets e bindings próprios, e a URL é estável: `pr-N-<worker>.<sub>.workers.dev`. A Cloudflare manda **não** usar Version URLs (`versions upload --preview-alias`) para PR, porque usam recursos de produção e não funcionam com Durable Objects.
- **Front:** sair do Pages (a doc diz "Start new projects with Workers") e servir a SPA como Static Assets no **mesmo Worker** do Hono. Service bindings vindos de um Preview chamam a produção. É troca de stack; decide no ticket 13.
- **Banco:** `neondatabase/create-branch-action@v6` (`preview/pr-N`, `expires_at` como backstop) → `drizzle-kit migrate` com a URL direta → `wrangler preview --secrets-file` com o `DATABASE_URL` pooled. Sem Hyperdrive no preview, porque exigiria um config manual por PR (limite de 10 ou 25 por conta). Neon Free e Launch incluem só 10 branches por projeto, o que limita os previews simultâneos.
- **Secrets fixos de preview:** ficam em `wrangler preview base-config secret put` e não herdam nada da produção. O input `secrets:` do `wrangler-action` grava na **produção**; não usar com preview. **Resend** não tem modo de teste: usar `@resend.dev` ou a caixa `<id>.resend.app` lida por API, redirecionando os destinatários no preview.
- **Limpeza** no `closed`: `wrangler preview delete` + `delete-branch-action@v3`. **E2E e prints** usam o output `preview_url` como `BASE_URL`; `deployment_status` não serve, porque eventos do `GITHUB_TOKEN` não disparam workflows. PRs criados pela Factory com `GITHUB_TOKEN` ficam aguardando aprovação, então é preciso GitHub App ou PAT.

[pesquisa](../research/05-pr-preview-environments.md)
