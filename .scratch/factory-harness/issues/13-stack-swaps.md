# Trocas na stack

Type: grilling
Status: open
Blocked by: 06, 07

## Question

Para cada troca proposta pelas pesquisas da stack e de auth (ex.: Pages → Workers Static Assets, Kubb → outra ferramenta, Better Auth → combinação com lib da Cloudflare), o usuário aceita ou mantém a peça original? Se nenhuma troca for proposta, este ticket fecha sem decisão.

Trocas propostas pela pesquisa 06 (detalhes em `../research/06-stack-official-docs.md`):
- T1: Pages → Workers + Static Assets + `@cloudflare/vite-plugin`
- T2: um único Worker (SPA + Hono em `/api/*`, `run_worker_first`)
- T3: driver serverless do Neon → Hyperdrive + `pg` + `drizzle-orm/node-postgres`. A pesquisa 05 confirma: sem Hyperdrive no preview (`pg` direto na URL pooled do branch Neon), Hyperdrive só em produção, com o mesmo código. A pesquisa 08 também usa Hyperdrive `localConnectionString` nos testes locais.
- T4: Drizzle 0.45 estável × v1 RC com versão exata
- T5: shadcn sobre Base UI (padrão atual)
- T6: `@react-email/components` → `react-email` 6 (obrigatória)
- T7: adicionar TanStack Router

Também decide, a partir da pesquisa 07: (a) **plano Workers Paid** (login com senha, hash de ~121 ms de CPU) **ou login sem senha** (magic link/código por email via Resend) para caber no plano Free; (b) aceitar a combinação Better Auth (app) + `@cloudflare/workers-oauth-provider` (tokens do MCP) + `createMcpHandler` (substituindo o `McpAgent`, que está deprecated) num único Worker.

Contexto de [Modelo de organização da Reference App](10-organization-model.md): a verificação de email é obrigatória e a troca de email exige verificar o novo endereço; se ficar com senha, falta decidir troca e reset de senha.
