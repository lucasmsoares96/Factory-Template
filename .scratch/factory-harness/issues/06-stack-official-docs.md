# Stack segundo a documentação oficial atual

Type: research
Status: resolved

## Question

Para cada peça da stack pedida, qual é a forma oficialmente recomendada hoje e há motivo para trocar alguma? Especificamente: (a) **Cloudflare Pages vs Workers com Static Assets** para o front React (e o Vite plugin da Cloudflare); (b) **Kubb** vs alternativas para gerar hooks TanStack Query + schemas Zod a partir do OpenAPI do Hono; (c) **Hono + `@hono/zod-openapi` + Swagger UI** (versão do Zod suportada, Zod 4); (d) **Drizzle + Neon no Workers**: driver serverless HTTP/WebSocket vs Hyperdrive, drizzle-kit migrations; (e) **Resend** no Workers (SDK, React Email); (f) shadcn/ui + TanStack Form com Vite/React 19; (g) monorepo (pnpm workspaces/Turborepo) para front + back + pacotes compartilhados. Liste cada troca proposta explicitamente, com justificativa e fonte, para virar decisão do usuário.

## Answer

A stack continua válida, com ajustes. O front sai do **Pages** e vai para **Workers + Static Assets + Vite plugin**: a Cloudflare manda começar projetos novos no Workers, e o Worker Previews resolve o preview por PR. A recomendação é **um único Worker** com a SPA e o Hono em `/api/*`. Para o Neon no Worker, recomendo **Hyperdrive + `pg` + `drizzle-orm/node-postgres`**, recomendação feita por Neon e Cloudflare. O limite de 10/25 configs Hyperdrive conflita com preview por PR, o que fica para o ticket 05. Falta decidir **Drizzle 0.45 estável ou v1 RC**: a doc já ensina a v1. Outras mudanças: **shadcn passou a usar Base UI por padrão**, e `@react-email/components` foi descontinuado em favor de `react-email`. Hono 4.13 + `@hono/zod-openapi` 1.6 exigem **Zod 4**. Kubb v5, TanStack Query/Form (sem adapter Zod), Resend, pnpm 12 e Turborepo ficam. Avaliei e não recomendo agora: CLI `cf` (beta), Hono 5 (RC), Hono RPC no lugar do Kubb, Scalar, Cloudflare Email Service e `pnpm pipeline`.

[pesquisa](../research/06-stack-official-docs.md)
