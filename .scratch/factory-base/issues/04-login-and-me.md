# 04: Login, logout e `GET /api/me`

Spec: [../spec.md](../spec.md)

**What to build:** um usuário verificado entra com email e senha e vê o próprio nome na página inicial; depois sai. Tentativas em excesso do mesmo IP recebem 429. A fatia mínima `GET /api/me` atravessa todas as camadas e serve de modelo para toda rota futura.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Telas de login e logout; redirect para o login quando não há sessão.
- [ ] Rate limit com `rateLimit.enabled: true`, `customStorage` num DO `RateLimiter` (SQLite) e `ipAddressHeaders: ["cf-connecting-ip"]`.
- [ ] `GET /api/me` com Zod e OpenAPI (`operationId`, `summary`, `description`), hook do Kubb e página inicial logada com o nome. Nada de Company.
- [ ] Ponto único que resolve o usuário pela sessão (o token do MCP entra no ticket 06).
- [ ] Testes de integração: login ok, senha errada, 429 depois do limite, `/api/me` com e sem sessão (seam 3).
- [ ] Teste da página inicial no Browser Mode (seam 4) e E2E `@evidence` cadastro → login → nome na tela → logout (seam 5).
