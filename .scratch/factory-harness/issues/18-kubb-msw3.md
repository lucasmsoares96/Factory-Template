# Kubb + MSW 3

Type: research
Status: open

## Question

O `@kubb/plugin-msw` (Kubb v5) declara `msw ^2`, enquanto o MSW para Workers (`@msw/cloudflare`, usado nos testes do back em [Testes de integração e E2E](08-integration-and-e2e-testing.md)) exige `msw >=3`. Na documentação e nos pacotes publicados mais recentes (outubro de 2026):
1. Os handlers gerados pelo `@kubb/plugin-msw` rodam com MSW 3? Há versão do Kubb que já declare `msw ^3`, ou issue/PR aberto sobre isso?
2. Quais breaking changes do MSW 3 afetam o código gerado (imports `msw` × `msw/http`, `HttpResponse`, `setupWorker` no Vitest Browser Mode)?
3. Se não forem compatíveis: duas versões do MSW convivem num monorepo pnpm (front com 2, back com 3) sem quebrar tipos ou o Vitest? Há override de peer dependency seguro?

Conclua com uma recomendação concreta para a parte de testes da spec do Skeleton.
