# Trocas na stack

Type: grilling
Status: resolved
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

## Progresso do grilling (rodada 1)

Aceitos pelo usuário (recomendação da rodada):
- **T1 + T2:** um único Worker (SPA como Static Assets + Hono em `/api/*` e `/mcp`), sem Pages.
- **T4:** Drizzle v1 RC (`1.0.0-rc.4`) com versão exata; se a v1 for abandonada ou mudar muito até a estável, voltar para 0.45 antes de escrever o Skeleton.
- **T5:** shadcn sobre Base UI, `-b base` explícito no bootstrap e no `components.json`.
- **T6:** `react-email` 6; renderizar com `render` e enviar `html` ao Resend (não o campo `react`, "Node.js only").
- **T7:** TanStack Router.
- **Não entram agora:** CLI `cf` (rever quando sair do beta), Hono 5 (rever quando estável), Kubb → Hono RPC/Orval/Hey API, Swagger UI → Scalar, Cloudflare Email Service, `pnpm pipeline`. Ficam Hono 4.13 + Zod 4, Kubb v5, TanStack Query/Form, Resend, pnpm, Turborepo. O conflito Kubb `msw ^2` × MSW para Workers `>=3` fica para a spec do Skeleton.

Nova restrição do usuário: **a stack precisa ser 100% gratuita.**

Fatos levantados na rodada (2026-10-17):
- Hyperdrive está incluído no plano Workers Free: 100.000 queries/dia (cached ou não), reset às 00:00 UTC, e acima disso as queries falham com erro ([pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), 2026-06-18); 10 configs por conta.
- Workers Free: 10 ms de CPU por request, mas "each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit"; estouro consistente termina com erro 1102 ([limits](https://developers.cloudflare.com/workers/platform/limits/), 2026-10-12).
- O leadflow (`~/Bytewer/monorepo/site/leadflow`) roda Better Auth 1.6.23 com `emailAndPassword` num Worker, no plano gratuito. O `@better-auth/utils` 0.4.2 dele usa o mesmo scrypt nativo (`node:crypto`, `N=16384`, condição `workerd`) que a pesquisa 07 mediu. Logo, a conclusão "senha exige Paid" da pesquisa 07 era forte demais: login esporádico cabe na tolerância por isolate.
- Resend Free: 100 emails/dia e 3.000/mês, sem excedente; emails recebidos na inbox também contam ([pricing](https://resend.com/pricing)).
- CIMD: Claude Code (≥ 2.1.81), Claude Desktop/web, Gemini CLI e Zed suportam; VS Code parcial; Cursor só DCR (matriz Zuplo, jul/2026, citada em [outline#14010](https://github.com/outline/outline/issues/14010)); a spec MCP 2026-07-28 deprecou DCR em favor de CIMD.

## Progresso do grilling (rodada 2)

- **"100% gratuito":** infra da app (Workers Free, KV, R2, Neon Free, Resend Free) e forja (GitHub) sem custo. O Claude da Factory fica fora da regra. Domínio próprio é opcional (`*.workers.dev` basta). Peça que só funciona em plano pago precisa de alternativa gratuita. Em repo privado, o GitHub Actions Free tem 2.000 min/mês.
- **Banco:** `pg` + `drizzle-orm/node-postgres` conectando direto na URL pooled do Neon em produção, preview e local (container). Sem Hyperdrive: evita o teto de 100k queries/dia do Free. Ligar Hyperdrive depois muda só a origem da connection string.
- **Login:** email e senha no plano Free (como no leadflow), com reset de senha por link e troca de senha (exige a senha atual e revoga as outras sessões) no Skeleton. Risco registrado: rajadas de login no mesmo isolate podem estourar a CPU (1102); medir `cpuTime` do login nos Workers Logs no primeiro deploy.
- **MCP:** só a combinação A (Better Auth + `workers-oauth-provider` + `createMcpHandler`), sem reavaliar a B. Compatibilidade máxima de clientes: CIMD **e** DCR ligados, `legacy: "stateless"` mantido.

## Answer

Restrição nova e permanente: **infra da app e forja 100% gratuitas** (o Claude da Factory fica fora da regra; domínio próprio opcional; peça só paga precisa de alternativa gratuita).

- **Hospedagem (T1 + T2):** um único Worker com a SPA em Static Assets + `@cloudflare/vite-plugin` e o Hono em `/api/*` e `/mcp` (`run_worker_first`). Sem Pages.
- **Banco (T3, revista):** `pg` + `drizzle-orm/node-postgres` direto na URL pooled do Neon em produção, preview e local (container). **Sem Hyperdrive**: ele é gratuito, mas o teto de 100k queries/dia derrubaria a app. Supera o "Postgres local via Hyperdrive `localConnectionString`" de [Testes de integração e E2E](08-integration-and-e2e-testing.md).
- **Drizzle (T4):** v1 RC (`1.0.0-rc.4`) com versão exata; volta para 0.45 se a v1 for abandonada ou mudar muito antes do Skeleton.
- **UI (T5, T7):** shadcn sobre Base UI (`-b base` explícito); TanStack Router.
- **Email (T6):** `react-email` 6, `render` para `html`, enviado pelo Resend (não o campo `react`).
- **Login:** email e senha no Workers Free, como no leadflow (mesmo scrypt nativo). O Skeleton ganha reset de senha por link e troca de senha (exige a senha atual, revoga as outras sessões). OTP descartado: gastaria a cota de 100 emails/dia do Resend Free.
- **MCP:** combinação A, sem reavaliar a B: Better Auth (identidade, sessão, Company) + `@cloudflare/workers-oauth-provider` (tokens em KV `OAUTH_KV`, `/authorize` lê a sessão do Better Auth) + `createMcpHandler`. Compatibilidade máxima: CIMD e DCR ligados, `legacy: "stateless"`. Tokens carregam só `userId` e `companyId`; toda tool revalida Member e role no Postgres; hooks do Better Auth chamam `revokeGrant`.
- **Ficam:** Hono 4.13 + `@hono/zod-openapi` + Zod 4, Swagger UI, Kubb v5, TanStack Query/Form, Resend, pnpm, Turborepo, Wrangler.
- **Revisar depois:** CLI `cf` quando sair do beta; Hono 5 quando estável.

Riscos encaminhados: CPU do login no Free → [Medir a CPU do login no leadflow](17-leadflow-login-cpu.md); Kubb `msw ^2` × MSW para Workers `>=3` → [Kubb + MSW 3](18-kubb-msw3.md).

Revisto em [Segurança do CI do PR com código da Factory](19-pr-ci-security.md): o hash de senha roda num Durable Object `PasswordHasher` e o rate limit num DO `RateLimiter`.
