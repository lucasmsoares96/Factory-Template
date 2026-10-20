# Medir a CPU do login no leadflow

Type: task
Status: resolved

## Question

O login com email e senha do Better Auth (scrypt nativo, `N=16384`) cabe no plano Workers Free sem erro 1102? O leadflow (`~/Bytewer/monorepo/site/leadflow`, Worker `leadflow`) já roda isso em produção. Levantar nos Workers Logs / Analytics (ou `wrangler tail` durante logins de teste):
- `cpuTime` das requests de `/api/auth/sign-in/email` (e de sign-up, que também faz hash);
- se já houve algum `exceededCpu` / 1102 no Worker;
- o comportamento com uma rajada de logins seguidos (por exemplo 5 a 10 em poucos segundos).

Se o `wrangler` não estiver logado na conta do usuário, entregar um checklist curto para ele rodar.

Resultado esperado: confirmar email e senha no Free, ou acionar a saída já prevista (rate limit de login e parâmetros de scrypt mais baratos) antes de escrever a spec do Skeleton.

## Answer

**Email e senha cabem no Workers Free.** Medido em 2026-10-18 no Worker `leadflow` (plano Free, Better Auth 1.6.x com `emailAndPassword` e scrypt padrão), com wrangler 4.151.1.

- **Histórico de 30 dias** (GraphQL `workersInvocationsAdaptive`): 7.846 requests, só os status `success` (5.599) e `clientDisconnected` (2.247). **Nenhum `exceededCpu`/`exceededResources` (1102).** CPU p50 3,6 ms, p99 99 ms, p99.9 188 ms, máximo 269 ms, todos `success`.
- **Sign-in medido** (`wrangler tail`, `POST /api/auth/sign-in/email` com email inexistente, que retorna 401 mas executa o scrypt como proteção contra timing): 21 requests, **CPU de 65 a 179 ms (≈110 ms em média)**, todos `outcome: ok`. Bate com os ≈121 ms medidos em Node na pesquisa 07.
- **Rajadas**: 10 sequenciais em ~5 s e 10 em paralelo no mesmo instante, todas `ok`, e o GraphQL do intervalo mostra 21 `success`. A tolerância por isolate absorveu as duas rajadas.
- **Sign-up** não foi medido para não criar contas na produção. Usa o mesmo `hashPassword`, então o custo é o mesmo.
- **Achado lateral**: o rate limit do Better Auth não atuou no leadflow (21 tentativas do mesmo IP em ~30 s, nenhum 429). O Skeleton deve configurá-lo explicitamente, como defesa contra força bruta e contra rajadas de CPU. O storage fica para a spec: KV Free tem só 1.000 escritas/dia, então convém `database` (Neon) ou o binding de rate limit do Workers.

Conclusão: a decisão de [Trocas na stack](13-stack-swaps.md) (email e senha no Free) se mantém, sem mexer nos parâmetros do scrypt. O risco que resta é um ataque sustentado de força bruta, que o rate limit cobre. A tolerância por isolate não tem número publicado ([limits](https://developers.cloudflare.com/workers/platform/limits/), 2026-10-18: "some built-in flexibility … infrequently runs over the configured limit"). Se surgir 1102 no login, as saídas são: scrypt mais barato, Workers Paid (quebra a regra de stack gratuita) ou um provedor de login externo com plano gratuito (por exemplo Auth0). Não é prioridade agora.

Revisto em [Segurança do CI do PR com código da Factory](19-pr-ci-security.md): o hash sai do Worker e roda num Durable Object; o rate limit fica num DO `RateLimiter`, com `rateLimit.enabled` e `cf-connecting-ip`.
