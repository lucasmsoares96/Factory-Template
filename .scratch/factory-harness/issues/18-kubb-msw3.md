# Kubb + MSW 3

Type: research
Status: resolved

## Question

O `@kubb/plugin-msw` (Kubb v5) declara `msw ^2`, enquanto o MSW para Workers (`@msw/cloudflare`, usado nos testes do back em [Testes de integração e E2E](08-integration-and-e2e-testing.md)) exige `msw >=3`. Na documentação e nos pacotes publicados mais recentes (outubro de 2026):
1. Os handlers gerados pelo `@kubb/plugin-msw` rodam com MSW 3? Há versão do Kubb que já declare `msw ^3`, ou issue/PR aberto sobre isso?
2. Quais breaking changes do MSW 3 afetam o código gerado (imports `msw` × `msw/http`, `HttpResponse`, `setupWorker` no Vitest Browser Mode)?
3. Se não forem compatíveis: duas versões do MSW convivem num monorepo pnpm (front com 2, back com 3) sem quebrar tipos ou o Vitest? Há override de peer dependency seguro?

Conclua com uma recomendação concreta para a parte de testes da spec do Skeleton.

## Answer

- **Compatível na prática, sem suporte declarado.**
  - O `@kubb/plugin-msw` 5.1.3 (e o canary de 2026-10-16) ainda declara peer `msw ^2.0.0`, opcional, e a doc diz "Install msw v2".
  - O upgrade está só na issue aberta [kubb-labs/plugins#1049](https://github.com/kubb-labs/plugins/issues/1049), de 2026-10-08, sem PR.
  - O código gerado importa só `http` e `type HttpResponseResolver` da raiz `'msw'` e responde com `new Response`. O MSW 3 mantém os exports da raiz "for backward-compatibility" até o próximo major.
  - Testado com `msw@3.0.3`: `tsc --strict` ok e 10/10 testes em Vitest 5 Browser Mode.
- **Breaking changes que importam:** nenhuma no código gerado. No código de teste:
  - `onUnhandledRequest` virou `onUnhandledFrame`;
  - `worker.stop()` virou assíncrono;
  - **um `worker.start()` repetido agora lança exceção**. Por isso a receita oficial do MSW para Vitest Browser Mode, e o fixture da pesquisa 08, quebram a partir do 2º teste. A correção é um fixture `scope: 'file'`.
- **Duas versões convivem no pnpm** (variantes separadas de `vitest` e `@vitest/mocker`, que aceita `^2.4.9 || ^3`), mas só com SPA e API em pacotes separados. Isso conflita com o Worker único da decisão 13 e não compensa.
- **Recomendação para o Skeleton:**
  - `msw` 3.0.x via catalog em todo o workspace, com `peerDependencyRules.allowedVersions: { "@kubb/plugin-msw>msw": "3" }` no `pnpm-workspace.yaml`;
  - código manual importando de `msw/http`, `msw/browser` e `msw/node`, com `onUnhandledFrame: 'error'`;
  - fixture de Browser Mode `scope: 'file'` + `resetHandlers` por teste;
  - `msw({ mode: 'worker-only' })` no `vitest.config.ts`, sem `public/mockServiceWorker.js`;
  - um gate no CI de `kubb generate` + `tsc` + teste com override de handler gerado.
- **Riscos:** a issue msw#2801, aberta (o worker para de interceptar depois de ~5 min no Chromium); a mudança de API quando o Kubb resolver a #1049; e o MSW 4, que tira os exports da raiz.

[pesquisa](../research/18-kubb-msw3.md)
