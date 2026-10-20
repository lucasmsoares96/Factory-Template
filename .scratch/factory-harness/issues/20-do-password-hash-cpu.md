# Medir o hash de senha num Durable Object no Free

Type: task
Status: resolved

## Question

O hash scrypt do Better Auth (65–179 ms de CPU) roda dentro de um Durable Object no Workers Free sem `exceededCpu`? A doc dos limites de DO se contradiz (tabela: 30 s por request; texto: limite do plano do Worker, 10 ms no Free), e a única medição pública é de terceiros ([pesquisa](../research/20-durable-object-password-hash.md)).

Trabalho (AFK, na conta do usuário):
- Deploy de um Worker descartável com uma classe `PasswordHasher` (SQLite-backed, RPC `hash`/`verify` usando `better-auth/crypto`), chamada por `getByName` num pool de nomes.
- 50 chamadas (sequenciais e em rajada paralela) acompanhadas no `wrangler tail`; registrar CPU por invocação do DO e qualquer `exceededCpu`/1102.
- Apagar o Worker no fim.

Resultado esperado: CPU do DO bem acima de 10 ms, todas `ok`. Se falhar, as saídas são as de [Medir a CPU do login no leadflow](17-leadflow-login-cpu.md): scrypt mais barato, plano Paid ou login externo.

## Answer

**Sim: o hash num Durable Object roda no Workers Free sem `exceededCpu`.** Medido em 2026-10-18 na conta do usuário, com um Worker descartável `do-hash-probe` (wrangler 4.151.1, Better Auth 1.7.10, `compatibility_date` 2026-10-01 + `nodejs_compat`). A classe `PasswordHasher` usa SQLite e expõe RPC `hash`/`verify`/`hashN` com `hashPassword`/`verifyPassword` de `better-auth/crypto`. O bundle chama `scrypt` de `node:crypto`. O Worker escolhe o objeto por `getByName("s<k>")`, com `k` aleatório entre 0 e 15.

- **Plano confirmado como Free**: um deploy com `limits.cpu_ms: 60000` foi recusado pela API com "CPU limits are not supported for the Free plan" (código 100328).
- **Carga**: 74 requests ao Worker, todas HTTP 200:
  - 1 de `hash` + 2 `verify`;
  - 20 sequenciais com 1 hash e 10 sequenciais com 5 hashes;
  - 20 em paralelo com 1 hash e 10 em paralelo com 5 hashes;
  - 10 em paralelo no mesmo objeto (`s0`);
  - 2 com 10 hashes numa invocação só.
- **`wrangler tail`**: 143 eventos, **todos `outcome: ok`**, sem exceções e sem `exceededCpu`. Dos 72 eventos esperados do DO chegaram 67, porque o tail descarta alguns; as 74 respostas HTTP voltaram 200.
  - **DO**: 1 hash ≈ **58 a 173 ms** de CPU, coerente com os 65–179 ms do leadflow. 5 hashes ≈ 288 a 549 ms. A maior invocação gastou **843 ms** de CPU (wall 982 ms), ou 84× os 10 ms do Free. `verify` levou 104 e 139 ms.
  - **Worker da frente**: **0 a 1 ms** de CPU (3 ms na rota que faz 3 RPCs), porque esperar o RPC não conta.
  - Foram usados 16 objetos distintos, um por nome do pool.
- **Mesmo objeto, 10 em paralelo**: as chamadas serializam (o objeto tem uma thread só); a última respondeu em ~0,89 s. Duas invocações concorrentes no mesmo objeto apareceram com `cpuTime: 0`, porque o tail atribui a CPU a outra invocação em curso. Isso confirma o pool de shards da [pesquisa](../research/20-durable-object-password-hash.md) em vez de um nome fixo.
- **Latência ponta a ponta** (cliente local → workers.dev): p50 ~0,33 s para 1 hash, máximo ~0,9 s nas rajadas.
- O Worker foi apagado (`wrangler delete`; a URL devolve 404). O código ficou só em `/tmp`, fora do repo.

**Conclusão**: o desenho de [Segurança do CI do PR com código da Factory](19-pr-ci-security.md) fica como está: `PasswordHasher` com pool de 16 nomes, um retry em `.retryable`, e `RateLimiter` em DO. Os parâmetros do scrypt não mudam. A spec do Skeleton pode ser escrita.

**Risco que resta**: o orçamento de CPU do DO no Free ainda não está escrito sem ambiguidade na doc. Agora é fato medido na conta, mas a Cloudflare pode mudá-lo. Se um dia surgir 1102 no DO, as saídas continuam as de [Medir a CPU do login no leadflow](17-leadflow-login-cpu.md): scrypt mais barato, plano Paid ou login externo. Sugestão para a spec: o smoke pós-deploy faz um login real, e assim um `exceededCpu` no DO aparece como falha do deploy, não como reclamação de usuário.

