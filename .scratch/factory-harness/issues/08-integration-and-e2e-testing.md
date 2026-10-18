# Testes de integração e E2E para esta stack

Type: research
Status: resolved

## Question

Qual é a melhor forma, segundo as docs oficiais atuais, de escrever: (a) **testes de integração do back** — `@cloudflare/vitest-pool-workers` com Hono, banco real em teste (Neon branch efêmero, PGlite, ou Postgres em container no CI) com Drizzle, isolamento entre testes, Better Auth em teste; (b) **testes de integração do front** — Vitest browser mode vs jsdom/happy-dom, Testing Library, MSW com handlers gerados pelo Kubb a partir do OpenAPI; (c) **E2E** com Playwright contra preview ou contra stack local (`wrangler dev`), autenticação em E2E, e como verificar emails de convite (Resend test mode, inbox de teste, captura do email no ambiente de teste)? O que deve rodar no E2E Stage da Factory e o que roda no CI comum?

## Answer

- **Back**: `createTestHarness()` do wrangler (desde 4.99) + Vitest, recomendado pela Cloudflare para integração. `@cloudflare/vitest-pool-workers` está deprecated; o sucessor é `@cloudflare/vitest-plugin`, só para unit. O banco é um Postgres local (service container ou container no runner) ligado pelo Hyperdrive `localConnectionString`. O isolamento vem dos dados (Company e usuários únicos por teste). Better Auth usa o plugin `testUtils()` numa instância de auth só de teste.
- **Front**: Vitest Browser Mode (Playwright/Chromium) + `vitest-browser-react` (princípios da Testing Library). MSW com handlers gerados pelo `@kubb/plugin-msw` (`parser: 'faker'`, seed fixo). jsdom/happy-dom ficam de fora.
- **E2E**: Playwright contra a stack local subida pelo harness. O harness repassa o `fetch` de saída do Worker pelo Node, então o `msw/node` captura o e-mail de convite do Resend sem rede. Cada worker do Playwright recebe uma conta via `getCookies`.
- **E2E Stage da Factory** = unit + integração + E2E local completo (determinístico, gera screenshots). O CI comum repete o mesmo como evidência. Só um smoke pós-deploy no preview usa branch do Neon e Resend real (`*.resend.app` + Received Emails API). Não existe sandbox; a cota Free é de 100/dia, contando enviados e recebidos.
- **Riscos**: Docker no runner (ticket 01); driver Hyperdrive × `neon-http` (ticket 06); Kubb ainda declara `msw ^2` enquanto `@msw/cloudflare` pede `msw >=3`; Hyperdrive dentro do harness não está documentado.

[pesquisa](../research/08-integration-and-e2e-testing.md)

Revisto em [Segurança do CI do PR com código da Factory](19-pr-ci-security.md): o preview não fala com o Resend (outbox no banco do branch, lido pelo smoke); Resend real só no smoke pós-deploy da produção.
