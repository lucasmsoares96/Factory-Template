# Pesquisa 20 — Hash de senha num Durable Object no Workers Free

Ticket de origem: [17-leadflow-login-cpu](../issues/17-leadflow-login-cpu.md) · Pesquisado em 2026-10-18

Pergunta: levar o scrypt do Better Auth (65 a 179 ms de CPU por login, medido no leadflow) para um **Durable Object (DO)** deixa email e senha robustos no **Workers Free**? E onde guardar o rate limit sem usar KV?

Versões e fontes consultadas:
- **Docs Cloudflare** (páginas `index.md`, lidas em 2026-10-18; a data é o "Last updated" de cada página):
  - [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/): 2026-06-01
  - [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): 2026-10-18
  - [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/): 2026-10-12
  - [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/): 2026-10-18
  - [DO Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/): 2026-10-15
  - [Invoke methods](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/) e [Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/): 2026-04-21
  - [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): 2026-10-12
  - [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/): 2026-09-30
  - [process](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/): 2026-04-23
- **Histórico da página de limites de DO**: `cloudflare/cloudflare-docs`, `src/content/docs/durable-objects/platform/limits.mdx`. Último commit `3ac30b3e` (2026-06-01). Também consultados `1a878eb1` (2025-03-25), `c30ee9f9` (2025-04-06) e `27945f4a` (2025-04-17).
- **Changelog Cloudflare**: [DOs no Workers Free](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/) (2025-04-07) e [Rate Limiting GA](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/) (2025-09-19).
- **workerd**: `main@2c34e935ce` (2026-10-18). Release mais recente `v1.20261018.1` (2026-10-18).
- **Better Auth**: **1.7.10** (npm `latest`, publicado em 2026-10-15), tag `v1.7.10` no commit `b734a41`. Depende de `@better-auth/utils` **0.5.0** (2026-07-25).
- **OWASP Password Storage Cheat Sheet**: commit `3c07d4aa` (2026-10-04).
- **Evidência empírica de terceiros**: repositório `billfan157-pixel/TNTTVN`, `tools/cloudflare-free-feasibility/results/`, medições de 2026-09-24 e 2026-09-26 numa conta **Workers Free** com wrangler 4.137.0. Não é fonte primária. É a única medição pública que encontrei de CPU de DO no Free.

Convenção: **Fonte diz** é afirmação da fonte primária (doc, código ou changelog). **Inferência** é leitura minha. **Não documentado** quer dizer que procurei e não achei.

---

## Resposta curta

1. **A doc oficial é ambígua quanto à CPU de um DO no Free**:
   - A tabela de limites dá "30 seconds (default) / configurable to 5 minutes", **sem separar Free e Paid**.
   - Na mesma página, porém, consta: "Workers Limits apply according to your Workers plan", e o FAQ diz que os DOs "have the same per invocation CPU limits as any Workers do", com link para a tabela em que o Free tem **10 ms**.
   - A única medição pública que encontrei (terceiros, conta Free, setembro de 2026) viu DOs gastarem **até ~3 s de CPU por invocação, com 0 `exceededCpu`**. Na prática, portanto, o DO no Free **não** está preso aos 10 ms.
   - **Isso não está prometido em lugar nenhum**: a Cloudflare pode "corrigir" para 10 ms. Ver §1.
2. **Se a medição se confirmar, o DO resolve.** O padrão:
   - uma classe `PasswordHasher` sem estado, com métodos RPC `hash`/`verify`;
   - chamada por `getByName("shard-<k>")`, com `k` aleatório num pool fixo de ~8 a 16 nomes;
   - retry de uma vez em erro `.retryable`.

   Cada objeto roda uma thread só, o que dá **~9 hashes/s por objeto**. A cota do Free fica longe: 1.000 logins/dia gastam ~19 GB-s de 13.000. Ver §2.
3. **Better Auth 1.7.10**: `emailAndPassword.password.hash(password)` e `emailAndPassword.password.verify({ hash, password })`. **Todas** as chamadas internas passam por `ctx.context.password.*`, inclusive o hash falso para email inexistente e o de sign-up duplicado. Ver §3.
4. **Alternativas no Worker não escapam dos 10 ms**:
   - **PBKDF2 do `crypto.subtle`** é nativo, mas roda síncrono na thread do isolate e conta como CPU. Em produção vai **no máximo a 100.000 iterações**, abaixo dos 600.000 da OWASP.
   - O **scrypt nativo de `node:crypto`** também roda síncrono.
   - **Baixar os parâmetros** até caber em ~10 ms dá ~1/20 do trabalho que a OWASP pede.
   - A Cloudflare **não publica** orientação para hash de senha. Ver §4.
5. **Rate limit**:
   - O Better Auth 1.7 exige um `customStorage.consume(key, rule)` atômico, e um DO é o encaixe natural.
   - `storage: "database"` (Neon) também funciona e é atômico, mas faz 2 a 3 queries por request.
   - O binding de Rate Limiting é por local (PoP), eventualmente consistente, e só aceita janelas de 10 s ou 60 s. A doc **não diz** se ele está disponível no Free.
   - **Atenção**: no Workers, o rate limit do Better Auth vem **desligado** por padrão, e o header de IP padrão é o errado. Isso provavelmente explica o "nenhum 429" do leadflow. Ver §5.
6. **Recomendação**: hash num DO com shards, rate limit num DO via `customStorage` e `rateLimit.enabled: true` com `cf-connecting-ip`. **Antes de fechar a spec, rodar o teste de 15 min do §6 na conta do usuário.** É o único jeito de transformar o "funciona" de terceiros em fato da nossa conta. Ver §6.

---

## 1. Durable Objects no Workers Free

### Disponibilidade e limites (fonte diz)

- **Só DOs com SQLite no Free.** "**Workers Free plan**: Only Durable Objects with SQLite storage backend are available." ([DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/), 2026-06-01; idem em [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), 2026-10-18). Disponível desde 2025-04-07 ([changelog](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/)).
- **Cotas diárias do Free**, citadas de [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), 2026-10-18:

  | | Free plan |
  | --- | --- |
  | Requests | 100,000 / day |
  | Duration | 13,000 GB-s / day |
  | Rows reads | 5 million / day |
  | Rows written | 100,000 / day |
  | SQL Stored data | 5 GB (total) |

  "If you exceed any one of the free tier limits, further operations of that type will fail with an error." "Daily free limits reset at 00:00 UTC."
- **Objetos e classes**: "Number of Objects | Unlimited". "Maximum Durable Object classes (per account) | 500 (Workers Paid) / 100 (Free)". "Storage per account | Unlimited (Workers Paid) / 5GB (Free)". "Storage per Durable Object | 10 GB", e o FAQ diz "1 GB on the Free plan" ([DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- **Throughput**: "Each individual Object is inherently single-threaded." "An individual Object has a soft limit of 1,000 requests per second" (mesma página).

### O limite de CPU: o texto exato e a contradição

Citações exatas de [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (2026-06-01):

- No topo: "Durable Objects are a special kind of Worker, so [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) apply according to your Workers plan. In addition, Durable Objects have specific limits as listed in this page."
- Tabela "SQLite-backed Durable Objects general limits": "CPU per request | 30 seconds (default) / configurable to 5 minutes of active CPU time". A linha **não traz** "(Free)" nem "(Workers Paid)", ao contrário das linhas de classes e storage.
- Nota de rodapé 4: "Each incoming HTTP request or WebSocket *message* resets the remaining available CPU time to 30 seconds. […] If you consume more than 30 seconds of compute between incoming network requests, there is a heightened chance that the individual Durable Object is evicted and reset."
- FAQ "Can I increase Durable Objects' CPU limit?": "Durable Objects are Worker scripts, and have the same [per invocation CPU limits](https://developers.cloudflare.com/workers/platform/limits/#account-plan-limits) as any Workers do. […] By default, the maximum CPU time per Durable Objects invocation (HTTP request, WebSocket message, or Alarm) is set to 30 seconds, but can be increased […] by setting `limits.cpu_ms`".

O que diz [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-12):

- "CPU time | 10 ms | 5 min" (Free | Paid). Esta é a tabela `#account-plan-limits` para onde o FAQ dos DOs aponta.
- "CPU time per HTTP request | 10 ms | 5 min (default: 30 seconds)".
- Na seção do erro 1102: "**Offload work** — Move expensive computation to Durable Objects or process data in smaller chunks across multiple requests". A frase não diz para qual plano vale.
- "On the Workers Paid plan, you can increase the maximum CPU time from the default 30 seconds to 5 minutes". O `limits.cpu_ms` é recurso do Paid.

**Histórico (fonte diz, git):**
- Até 2025-03-25, a tabela de DO tinha duas colunas, ambas com "30s".
- O commit `1a878eb1` (2025-03-25, "durable objects: cpu time updates") trocou a coluna Paid por "30 seconds (default) / configurable to 5 minutes" e incluiu a frase "share the same per invocation CPU limits".
- O commit `c30ee9f9` (2025-04-06, véspera do lançamento no Free) juntou tudo numa coluna só, com o mesmo texto e sem distinguir planos.

**Inferência:** a tabela com "30 s" foi escrita pensando no Paid e unificada às pressas. A frase "same per invocation CPU limits as any Workers" admite as duas leituras. Pelo texto, **não dá para afirmar** nem que o DO no Free tem 10 ms nem que tem 30 s.

**Evidência empírica (terceiros, não primária):** numa conta conferida como Free ("Workers plans displayed **Free**, `$0` […] 10 ms/Worker invocation limits"), um DO com SQLite rodou bcrypt custo 12 (`bcryptjs`, JS puro).
- Medição de 2026-09-24, pelo dashboard: "Durable Object namespace: 35 requests, 0 invocation errors, 0 exceeded-CPU events. CPU p50 **713.644 ms**, p90 **860.093 ms**, p99 **2559.682 ms**". O Worker da frente ficou em "CPU p50 0.63 ms […] p99 1.63 ms" ([medição de 2026-09-24](https://github.com/billfan157-pixel/TNTTVN/blob/main/tools/cloudflare-free-feasibility/results/2026-09-24-workers-free-measurement.md)).
- Medição de 2026-09-26, por `wrangler tail`: 40 invocações do DO, "outcomesOk": 40, "cpuP50Ms": 669, "cpuMaxMs": 2976, "exceededCpuEvents": 0 ([JSON de 2026-09-26](https://github.com/billfan157-pixel/TNTTVN/blob/main/tools/cloudflare-free-feasibility/results/2026-09-26-workers-free-cpu-current-branch.json)).
- **Inferência:** 3 s repetidos são 300× os 10 ms. Isso não cabe na "built-in flexibility" por isolate que a doc do Workers menciona. Na prática, o DO no Free recebe o orçamento de 30 s.

**Resposta à pergunta 1:** a Cloudflare **não diz** com clareza que o DO no Free tem 10 ms. A tabela diz 30 s, e a única medição pública confirma algo muito acima de 10 ms. **Mas isso não está garantido**: há uma frase oficial que pode ser lida como "10 ms no Free". Se a Cloudflare passar a aplicar essa leitura, levar o hash para o DO **deixa de ajudar**.

---

## 2. Como levar o hash para um DO

### RPC por stub (fonte diz)

- "public methods on the Durable Objects class are exposed as RPC methods". O padrão é `env.MY_DURABLE_OBJECT.getByName("foo")` seguido de `await stub.sayHello()`. Exige compatibility date ≥ 2024-04-03 ([Invoke methods](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/), 2026-04-21).
- "Every RPC method call on a Durable Objects stub is its own RPC session and therefore a single billed request" ([DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
- No Worker, esperar a resposta do RPC não conta CPU: "Waiting on network requests […] does **not** count toward CPU time" ([Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)). A medição de terceiros mostra o Worker da frente em ~1 ms.

### `node:crypto` scrypt dentro do DO

- **Fonte diz:** "A Durable Object class is defined in a Worker script" ([changelog 2025-04-07](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/)).
  - **Inferência:** o DO herda os compatibility flags do script. Com `nodejs_compat`, `node:crypto` funciona igual no Worker e no DO.
- **Fonte diz (código):** no workerd, `scrypt()` assíncrono chama `cryptoImpl.getScrypt(...)` de forma **síncrona** dentro do executor de uma `Promise` ([`src/node/internal/crypto_scrypt.ts`](https://github.com/cloudflare/workerd/blob/main/src/node/internal/crypto_scrypt.ts), `main@2c34e935ce`).
  - Ou seja, não existe thread pool. O comentário do Better Auth ("libuv thread pool, non-blocking") vale só para o Node.
  - **Inferência:** enquanto um hash roda, o DO fica bloqueado e as outras chamadas esperam na fila.
- **Fonte diz (código):** o workerd limita o scrypt a `N*r*p ≤ 2^20` (`DEFAULT_MAX_SCRYPT_COST = 1u << 20`, [`src/workerd/io/limit-enforcer.h`](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h)). O padrão do Better Auth (N=16384, r=16, p=1 = 2^18) cabe.

### Roteamento e concorrência

- **Fonte diz:** "Use Durable Objects for stateful coordination, not stateless request handling". A lista de "Use plain Workers when you need" inclui "Stateless request handling" e "High fan-out" ([Rules of DOs](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), 2026-10-18).
  - **Inferência:** usar um DO só como fuga de CPU **não é o uso pretendido**, e isso reforça o risco de a Cloudflare fechar a brecha.
- **Fonte diz:** "A single Durable Object can handle approximately **500-1,000 requests per second** for simple operations […] shard your workload across multiple Durable Objects". "Required DOs = (Total requests/second) / (Requests per DO capacity)" (mesma página).
- **Inferência (conta):** com ~110 ms de CPU por hash, um objeto faz no máximo ~9 hashes/s. Numa rajada de 10 logins simultâneos no mesmo objeto, o último espera ~1 s.
  - A medição de terceiros confirma a forma: um objeto só deu p50 de 3.452 ms; 10 shards, 1.220 ms ([JSON de 2026-09-26](https://github.com/billfan157-pixel/TNTTVN/blob/main/tools/cloudflare-free-feasibility/results/2026-09-26-workers-free-cpu-current-branch.json)).
  - Um objeto sobrecarregado devolve `overloaded` ([DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- **Opções de chave**:

  | Chave | Prós | Contras |
  | --- | --- | --- |
  | Um nome fixo (`"hasher"`) | simples | gargalo de ~9/s, todos na mesma fila |
  | `getByName(email)` | ataque a uma conta serializa sozinho | objeto frio a cada email novo; emails aleatórios (hash falso) criam um objeto por tentativa; local fixado pelo 1º acesso |
  | **Pool fixo de N nomes, `k` aleatório** (recomendado) | objetos quentes, paralelismo ~N×9/s, nada de estado | o atacante distribui carga por todo o pool; o rate limit é que protege |

- **Incerteza:** "Durable Objects may run in the same isolate on the same physical machine and share the 128 MB of memory" ([DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), nota 5). **Não documentado:** se objetos que dividem um isolate também dividem a thread. Se dividirem, os shards não paralelizam. A medição de terceiros sugere que paralelizam.
- **Memória:** o scrypt padrão aloca `128*N*r` = 32 MiB por hash (`maxmem: 128 * config.N * config.r * 2` em `@better-auth/utils@0.5.0`, `dist/password.node.mjs`). Cabe nos 128 MB do isolate.

### Latência e local

- **Fonte diz:** "By default, a Durable Object is created near the location of the first request it receives" ([Rules of DOs](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)). Há `locationHint` para escolher a região.
- **Inferência:** cada login ganha um salto Worker→DO. O custo é ~0 quando o DO está no mesmo PoP e uma ida e volta inter-regional quando não está, somado à fila. Os nomes do pool são criados no primeiro acesso, então convém disparar o primeiro a partir da região dos usuários ou passar `locationHint`.
- **Fonte diz:** "Durable Object reset because its code was updated" aparece durante um deploy. Erros com `.retryable` "are suggested to be retried if requests […] are idempotent". `.overloaded` "should not be retried" ([Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/), 2026-04-21; o caso real está no [log de terceiros](https://github.com/billfan157-pixel/TNTTVN/blob/main/tools/cloudflare-free-feasibility/results/2026-09-24-workers-free-measurement.md)). `hash` e `verify` são idempotentes, então um retry com stub novo é seguro.

### Cobrança no Free

- **Fonte diz:**
  - "Durable Objects are billed for compute duration (wall-clock time) while the Durable Object is actively running or is idle in memory but unable to hibernate. Durable Objects that are idle and eligible for hibernation are not billed for duration".
  - "Duration billing charges for the 128 MB of memory […] regardless of actual usage".
  - A duração "is shared across all requests active on an Object at once" ([DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
  - O DO hiberna "after 10 seconds of inactivity" se não houver `setTimeout`/`setInterval` nem request pendente ([Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), 2026-10-15).
- **Inferência (conta)**, para um DO sem timers que paga só o tempo ativo:
  - 1.000 logins/dia × ~0,15 s × 0,128 GB ≈ **19 GB-s/dia**, ou **0,15 %** de 13.000.
  - A cota de duração só esgota por volta de 13.000 / (0,128 × 0,15) ≈ 677 mil hashes/dia. Antes disso, o teto que vale é o de **100.000 requests/dia** do DO, e o dos Workers, que também é de 100.000/dia.
  - Cada login gasta 1 subrequest do Worker (o limite do Free é 50 por invocação).

---

## 3. Integração com o Better Auth (1.7.10)

- **Fonte diz (tipos):** `emailAndPassword.password?: { hash?: (password: string) => Promise<string>; verify?: (data: { hash: string; password: string }) => Promise<boolean> }` (`packages/core/src/types/init-options.ts`, `v1.7.10`).
- **Fonte diz (contexto):** `hash: options.emailAndPassword?.password?.hash || hashPassword` e `verify: options.emailAndPassword?.password?.verify || verifyPassword` (`packages/better-auth/src/context/create-context.ts`).
- **O hash falso passa pelo custom? Sim.** Em `api/routes/sign-in.ts`, quando o usuário não existe: "Hash password to prevent timing attacks […]", seguido de `await ctx.context.password.hash(password);`. O mesmo vale para usuário sem senha.
  - Em `sign-up.ts`, com email já existente e resposta genérica: `await ctx.context.password.hash(password);`.
  - `grep` em `v1.7.10`: **todas** as chamadas usam `ctx.context.password.hash/verify`. Isso cobre sign-up, sign-in, change/set/reset password, update-user, admin, username, phone-number e email-otp. Nenhum caminho chama o scrypt direto.
- **Compatibilidade dos hashes já gravados:** o formato padrão é `${salt}:${hex(key)}`, com scrypt N=16384, r=16, p=1, dkLen=64 e NFKC na senha (`@better-auth/utils@0.5.0`, `dist/password.node.mjs`). O `exports["./password"]` tem a condição `workerd`, que aponta para essa versão `node:crypto`.
  - **Inferência:** se o DO importar `hashPassword`/`verifyPassword` de `better-auth/crypto`, que reexporta `./password` (`packages/better-auth/src/crypto/index.ts`), os hashes do leadflow continuam válidos sem migração.

Esboço (inferência; não testado):

```ts
// password-hasher.ts — mesma Worker, migration new_sqlite_classes: ["PasswordHasher"]
import { DurableObject } from "cloudflare:workers";
import { hashPassword, verifyPassword } from "better-auth/crypto";

export class PasswordHasher extends DurableObject<Env> {
  hash(password: string) { return hashPassword(password); }
  verify(hash: string, password: string) { return verifyPassword({ hash, password }); }
}

// auth.ts — betterAuth criado por request com env
const SHARDS = 16;
const stub = (env: Env) =>
  env.PASSWORD_HASHER.getByName(`s${crypto.getRandomValues(new Uint32Array(1))[0] % SHARDS}`);
async function once<T>(env: Env, f: (s: ReturnType<typeof stub>) => Promise<T>) {
  try { return await f(stub(env)); }
  catch (e: any) { if (e?.retryable && !e?.overloaded) return f(stub(env)); throw e; }
}
// emailAndPassword: { enabled: true, password: {
//   hash: (p) => once(env, (s) => s.hash(p)),
//   verify: ({ hash, password }) => once(env, (s) => s.verify(hash, password)) } }
```

Exemplos públicos:
- **Mesmo padrão (DO sem estado só para CPU de senha), com bcrypt e sem Better Auth**: classe `PasswordCpu extends DurableObject`, com o comentário "Stateless bcrypt compute only" ([`server/src/cloudflare/passwordCpu.js`](https://github.com/billfan157-pixel/TNTTVN/blob/main/server/src/cloudflare/passwordCpu.js)).
- **Better Auth + DO para hash: não encontrei nenhum exemplo publicado.**
- Outro caminho que aparece por aí: um Worker separado de hash, chamado por Service Binding RPC ([GeekNews](https://news.hada.io/topic?id=27399)).
  - **Inferência:** no Free, esse Worker chamado também é uma invocação de Worker com 10 ms. Não resolve.
- Issue relacionada: [better-auth#8860](https://github.com/better-auth/better-auth/issues/8860) (2026-03-31, fechada). O scrypt em JS puro estourava a CPU, e a saída foi `password.hash/verify` custom com `node:crypto`. Desde 1.6 isso é o padrão, e mesmo assim não cabe em 10 ms.

---

## 4. Alternativas sem DO

| Opção | CPU no Worker | Segurança | Evidência |
| --- | --- | --- | --- |
| scrypt padrão (atual) | 65 a 179 ms medidos | N·r·p = 2^18, abaixo do menor nível da OWASP (2^14·8·5 ≈ 2^19,3) | [issue 17](../issues/17-leadflow-login-cpu.md); [OWASP](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md) |
| PBKDF2 via `crypto.subtle` | **conta como CPU** | **máximo de 100.000 iterações em produção**; a OWASP pede 600.000 | ver abaixo |
| scrypt mais barato (por exemplo N=2^12, r=8) | ~7 ms (estimativa local de terceiros) | ~1/20 do que a OWASP pede | [eedsilva/agent-foundry#733](https://github.com/eedsilva/agent-foundry/issues/733) (2026-10-09), sem medição no Workers |
| Workers Paid | 30 s por padrão | parâmetros OWASP | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/); quebra a regra de stack gratuita |

- **O WebCrypto nativo conta como CPU?**
  - **Fonte diz (código):** `SubtleCrypto::deriveBits` executa `js.evalNow([&]{ … baseKey.impl->deriveBits(js, …) })`, ou seja, roda de forma síncrona e com o lock do isolate ([`crypto.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/crypto.c++)).
  - O PBKDF2 chama `ncrypto::pbkdf2Into` direto ([`pbkdf2.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/pbkdf2.c++)).
  - **Inferência:** é tempo de CPU da thread do isolate e entra na conta dos 10 ms. "Nativo" só significa mais rápido que JS. A Cloudflare diz só isto: "significantly faster than performing them purely in JavaScript" ([Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), 2026-09-30).
- **Teto do PBKDF2**:
  - **Fonte diz (código):** `DEFAULT_MAX_PBKDF2_ITERATIONS = 100'000`, com o comentário "this current default limit is *WAY* below the recommended minimum iterations for pbkdf2" ([`limit-enforcer.h`](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h)).
  - No workerd local o limite é desligado (`checkPbkdfIterations … return kj::none` em `worker-factory.c++`).
  - Há uma issue aberta: [workerd#1346](https://github.com/cloudflare/workerd/issues/1346) (2023-10-25), "100,000 iterations of PBKDF2 is insecure".
  - Confirmado em produção por terceiros: "Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)" ([JSON](https://github.com/billfan157-pixel/TNTTVN/blob/main/tools/cloudflare-free-feasibility/results/2026-09-24-pbkdf2-600k-error-detail.json)).
- **Orientação da Cloudflare para hash de senha no Workers: não documentado.** Procurei em `workers/llms-full.txt` e `durable-objects/llms-full.txt` (2026-10-18) e não há guia sobre isso. O mais perto é o "Offload work — Move expensive computation to Durable Objects" da seção de CPU.

---

## 5. Storage do rate limit

### O que o Better Auth 1.7.10 aceita (fonte diz, código)

- `rateLimit.storage?: "memory" | "database" | "secondary-storage"`. O padrão é `"memory"`, ou `"secondary-storage"` quando há `secondaryStorage` (`create-context.ts`).
- `rateLimit.customStorage?: { consume(key, rule: { window, max }) => Promise<{ allowed, retryAfter }> }`. "Better Auth no longer accepts separate `get`/`set` rate-limit storage because that shape cannot enforce a distributed limit" (`init-options.ts`). O formato `get`/`set` de versões anteriores **não funciona** na 1.7.
- `"secondary-storage"` exige `SecondaryStorage.increment` atômico; sem ele, lança "Secondary-storage rate limiting requires SecondaryStorage.increment." (`api/rate-limiter/index.ts`). **Inferência:** o KV não tem incremento atômico, e no Free ainda tem só 1.000 escritas/dia. Está descartado.
- `"database"`: faz `findMany`, depois `create` ou um `incrementOne` com guarda (`count < max`, janela) e, de vez em quando, um `deleteMany` de limpeza. É atômico, mas gasta **2 a 3 queries por request** limitado.
- `"memory"`: um `Map` por isolate. **Inferência:** no Workers, cada isolate tem o próprio contador, então o limite não vale de forma global.
- Regras padrão: `/sign-in*`, `/sign-up*`, `/change-password*` e `/change-email*` têm "window: 10, max: 3". O padrão geral é janela de 10 s e máximo de 100.

### Duas armadilhas no Workers (provável causa do "nenhum 429" do leadflow)

1. **O rate limit vem desligado.**
   - **Fonte diz:** `enabled: options.rateLimit?.enabled ?? isProduction`, e `isProduction = nodeENV === "production"`. Esse valor vem de `env.NODE_ENV`, lido por um `Proxy` sobre `globalThis.process?.env` (`packages/core/src/env/env-impl.ts`).
   - **Fonte diz (Cloudflare):** o `process.env.NODE_ENV` é "statically replaced at build time" pelo Wrangler. Em tempo de execução, o `process.env` contém só "environment variables, secrets, or version metadata" ([process](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/), 2026-04-23).
   - **Inferência:** a troca estática só atinge o texto literal `process.env.NODE_ENV`, e o Better Auth não usa esse texto. Sem uma var `NODE_ENV` no wrangler, `isProduction` fica `false` e o rate limit fica **desligado**. Use **`rateLimit.enabled: true`** explicitamente.
   - **Conferido no leadflow** (`~/Bytewer/monorepo/site/leadflow`, 2026-10-18): o `wrangler.jsonc` não define `NODE_ENV` em `vars`, e `src/lib/auth.ts` não tem `rateLimit` nem `ipAddressHeaders`. Isso bate com o "nenhum 429" medido na issue 17.
2. **O header de IP é o errado.**
   - **Fonte diz:** `DEFAULT_IP_HEADERS = ["x-forwarded-for"]`, e cadeias com vírgula não são confiáveis por padrão. Sem IP, o Better Auth cai num balde único por path (`packages/core/src/utils/ip.ts`, `rate-limiter/index.ts`).
   - A doc do Better Auth traz o exemplo `ipAddressHeaders: ["cf-connecting-ip"], // Cloudflare specific header example` (`docs/content/docs/concepts/rate-limit.mdx`, v1.7.10). Use esse valor.

### As opções comparadas

| Opção | Consistência | Custo no Free | Encaixe no Better Auth |
| --- | --- | --- | --- |
| **DO via `customStorage.consume`** | forte (um DO por chave, uma thread) | 1 request de DO + ~1 linha escrita por tentativa; cotas de 100k/dia | direto: `consume` é exatamente uma operação atômica num DO |
| `storage: "database"` (Neon) | forte (`incrementOne` com guarda) | 2 a 3 queries por tentativa, cada uma é subrequest e mantém a compute do Neon acordada | nativo, só precisa da tabela `rateLimit` |
| Binding de Rate Limiting | **por PoP**, "permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system"; `period` "Must be either `10` or `60`" | sem preço publicado; **disponibilidade no Free não documentada** | ruim: as regras do Better Auth têm janelas variáveis; serve melhor como middleware Hono à parte |

Fontes da tabela: [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (2026-10-12); a própria página desaconselha usar IP como chave ("It is not recommended to use IP addresses"). [GA em 2025-09-19](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/), sem menção a plano.

- **Inferência:** um DO de rate limit **com estado só em memória** perde o contador quando hiberna, o que acontece depois de 10 s ociosos ([Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)). A janela padrão também é de 10 s, e a coincidência mascara o problema, mas para janelas de 60 s ou mais é preciso gravar no SQLite do DO (`ctx.storage.sql` ou `put`), que conta como "rows written" (100.000/dia no Free).
- **Recomendação:** `customStorage` num DO `RateLimiter` com `getByName(key)` e contagem gravada em SQLite. Ele não toca o Neon, é atômico e cabe nas cotas. Plano B, mais simples: `storage: "database"`.

---

## 6. Conclusão e desenho recomendado

**O hash num DO deixa email e senha robustos no Free?** **Na prática, sim. No papel, não com certeza.**
- A tabela oficial dá 30 s, e a medição de terceiros mostra DOs gastando 0,7 a 3 s de CPU no Free sem erro.
- Mas a Cloudflare nunca escreveu "30 s no Free". Há uma frase que pode ser lida como 10 ms, e a própria doc diz que DO não é para trabalho sem estado.
- O hash no DO troca uma tolerância não documentada (a do isolate, que já funciona hoje) por uma ambiguidade documental, e fica um degrau mais firme. Paga com complexidade (classe, migration, shards, retry) e latência.

**Desenho recomendado:**
1. Classe `PasswordHasher` (com SQLite, sem estado) na mesma Worker. Os métodos RPC `hash`/`verify` reutilizam `better-auth/crypto`, mantendo os hashes atuais válidos.
2. `emailAndPassword.password.{hash,verify}` chamam `getByName("s<k>")`, com `k` aleatório entre 0 e 15, e fazem 1 retry em `.retryable` (nunca em `.overloaded`).
3. Rate limit com `enabled: true`, `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` e `customStorage.consume` num DO `RateLimiter`. Manter a regra padrão de 3 tentativas a cada 10 s em `/sign-in*` e `/sign-up*`. O rate limit roda **antes** do hash, então também protege a CPU do DO.
4. Fallback: se o teste abaixo der `exceededCpu` no DO, o DO não serve. As saídas são as da issue 17: scrypt mais barato, Paid ou um provedor externo.

**Teste para confirmar na conta do usuário (~15 min; não executado aqui, porque exigiria deploy na conta):**
1. Fazer deploy de uma Worker descartável no Free com um DO `PasswordHasher` (`new_sqlite_classes`) e uma rota `/h` que chama `stub.hash("x")` 1× e 5× em sequência, o que dá ~110 a 550 ms de CPU no DO.
2. Rodar `wrangler tail --format json` durante 50 chamadas a `/h`, em paralelo de 10.
3. Aceitar se todas as invocações do DO tiverem `outcome: "ok"`, `cpuTime` bem acima de 10 ms e nenhum `exceededCpu`; o Worker da frente deve ficar em ~1 ms.
4. Apagar a Worker (`wrangler delete`).

**Incertezas em aberto:**
- O limite de CPU do DO no Free não tem texto oficial inequívoco.
- Não sei se DOs que dividem um isolate também dividem a thread, o que afeta o ganho dos shards.
- A disponibilidade do binding de Rate Limiting no Free não está documentada.
- O rate limit desligado no leadflow vem do código do Better Auth somado à config do leadflow. Não testei em tempo de execução.
