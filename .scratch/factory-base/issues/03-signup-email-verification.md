# 03: Cadastro e verificação de email

Spec: [../spec.md](../spec.md)

**What to build:** um visitante se cadastra com email e senha, recebe o email de verificação, pode pedir reenvio e só usa a app depois de verificar. O hash de senha roda num Durable Object, e o email sai pelo Resend na produção e cai no outbox nos testes e no preview.

**Blocked by:** 02

**Status:** done

- [x] Better Auth 1.7 com `emailAndPassword` e verificação obrigatória, montado na `platform/` do Skeleton.
- [x] DO `PasswordHasher` sem estado (RPC `hash`/`verify`, pool de 16 nomes por `getByName`, um retry em `.retryable`) plugado em `emailAndPassword.password.hash/verify`; scrypt sem mudança de parâmetros.
- [x] Adaptador de email: Resend com `html` renderizado do `react-email` 6 e remetente do Product; outbox no banco no preview e nos testes. Os emails usam as mensagens do i18n.
- [x] Telas de cadastro, "verifique seu email" com reenvio e o destino do link de verificação.
- [x] Testes de integração: cadastro grava o usuário, o email é capturado por MSW, o link verifica, o usuário não verificado é recusado; `testUtils()` do Better Auth numa instância só de teste (seam 3).
- [x] Teste das telas no Browser Mode (seam 4) e E2E cadastro → verificação pelo email capturado (seam 5).

## Comments

Implementado em 2026-10-19. Versões conferidas no npm registry (`npm view <pkg> version time`) e nos tipos/código dos pacotes nessa data, fixadas no `catalog`:

| Pacote | Versão | Publicado |
|---|---|---|
| better-auth (+ `@better-auth/*`) | 1.7.11 | 2026-10-19 |
| react-email | 6.11.3 | 2026-10-16 |
| @react-email/render (transitivo, condição `workerd`) | 2.1.1 | 2026-10-16 |
| resend | 6.34.1 | 2026-10-16 |
| @tanstack/react-form | 1.33.5 | 2026-08-11 |

O que ficou:
- Tabelas do Better Auth (`users`, `sessions`, `accounts`, `verifications`, `usePlural`) e `email_outbox` no schema `skeleton`, numa migration nova (`20261019165621_auth_and_email_outbox`); a do ticket 01 não mudou.
- `platform/auth-options.ts`: `authOptions()` (config única: `emailAndPassword` + `requireEmailVerification`, `sendOnSignUp`, drizzle adapter, emails do i18n). `platform/auth.ts` cria uma instância por request (bindings só existem no request) em `/api/auth/*`, fora da OpenAPI. `baseURL` = origem do request.
- `PasswordHasher` (`@workspace/skeleton/durable-objects`): DO sem estado (`new_sqlite_classes`), RPC `hash`/`verify` com `hashPassword`/`verifyPassword` de `better-auth/crypto` (scrypt padrão). `passwordHashing()` sorteia `hasher-0..15` por `getByName` e repete uma vez em `.retryable` (nunca em `.overloaded`).
- Email: `createEmailSender()` com `EMAIL_TRANSPORT` = `resend` (padrão, `vars` do `wrangler.jsonc`, `RESEND_API_KEY` secret opcional que só a produção tem) ou `outbox` (insert em `skeleton.email_outbox`). `pnpm dev` usa `outbox`. Template `emails/verify-email.tsx` com `react-email` 6, `html` + `text` renderizados, remetente `emailFrom` do `createApp()`, textos do i18n (`emails.verifyEmail`) no `LOCALE` do build (`__SKELETON_LOCALE__`, injetado pelo plugin Vite do Skeleton).
- Os emails saem depois da resposta (`advanced.backgroundTasks` → `c.var.defer` → `waitUntil`), para um email novo e um já cadastrado responderem igual; o cliente `pg` do request só fecha depois das tarefas adiadas.
- Telas: `/sign-up` (TanStack Form), `/check-email?email=` (reenvio por `useMutation`) e `/email-verified` (destino do link; com `?error=<code>` mostra o motivo traduzido). Cliente `better-auth/react` em `client/auth.ts`. Códigos do Better Auth que as telas mostram entram na tabela `errors` do i18n (`authErrorCodes`). shadcn `input` e `label`.
- `createApp({ title, emailFrom, messages })`: `emailFrom` e `messages` são novos (ticket 07 leva para `product.config.ts`).
- Testes: seam 3 `test/sign-up.test.ts` (cadastro grava usuário não verificado e o MSW captura o email do Resend; o link verifica e redireciona; link adulterado → `?error=INVALID_TOKEN`; não verificado recebe 403 `EMAIL_NOT_VERIFIED` e entra depois de verificar; hash gravado confere com o scrypt padrão; reenvio; email verificado (criado pelo `testUtils()` numa instância só de teste, `test/support/auth.ts`) ou desconhecido não recebe nada; cadastro repetido responde igual e não muda nada), `test/email-outbox.test.ts` (transporte `outbox`, sem Resend), `test/password-hashing.test.ts` (pool e retry contra um namespace falso); seam 4 `test/browser/sign-up.browser.test.tsx` (handlers MSW escritos à mão em `test/spa/auth-handlers.ts`, porque as rotas do Better Auth não estão na OpenAPI); seam 5 `e2e/specs/sign-up.spec.ts` `@evidence` (`sign-up`, `check-email`, `email-verified`): o global setup intercepta o Resend com MSW no processo do harness e grava cada email em `test-results/mailbox/`, lido pelo fixture `mailbox`.
- `TURBO_FORCE=1 pnpm factory:verify` verde (12 tasks; skeleton 41 testes, browser 7, E2E 2 specs).

Desvios e decisões:
- `skeleton generate` importa o Worker com o `runnerImport` do Vite (em vez do `import()` do Node): o type stripping do Node não lê `.tsx` (template de email) e `cloudflare:workers` só existe no runtime, então vira um stub. O documento do próprio Skeleton sai da composição de teste (`test/worker/index.ts`).
- O Skeleton ganhou `tsconfig.worker.json` (tipos do `wrangler types` da composição de teste) para o que só roda no Workers (DO, composição); `jsx: react-jsx` subiu para o `tsconfig.base.json` (o esbuild do wrangler lê o JSX dele).
- `PASSWORD_HASHER` é tipado estruturalmente (`PasswordHasherPool`) no `SkeletonBindings`, para a `platform/` seguir neutra (Node e Workers).
- `sendOnSignIn` fica `false` (padrão): o login de um não verificado só recusa; o reenvio é pela tela "verifique seu email". O ticket 04 pode rever.
- Login (`/sign-in/email`) já funciona pelo Better Auth e é usado nos testes; telas de login/logout, rate limit e `GET /api/me` ficam no ticket 04.
- A rota de leitura do outbox fica no ticket 15 (só no preview).
- Bundle do Worker do `example`: `index.js` 2,2 MB (≈ 0,48 MB gzip) + chunks lazy (react-dom/server, prettier, dialetos do kysely) ≈ 4,7 MB sem compressão. Cabe no limite do Free (3 MB comprimido), mas o tempo de startup e o CPU do render do email no Worker devem ser medidos no ticket 14.
- pnpm 12 acrescentou `minimumReleaseAgeExclude` para `better-auth` 1.7.11 e os `@better-auth/*` publicados hoje; dá para tirar a partir de 2026-10-20.

Pending (human): domínio do Resend e `RESEND_API_KEY` restrita ao domínio na conta real (bootstrap, ticket 14). Nenhum teste chama o Resend de verdade.
Pending (human): medir na conta (ticket 14) o login real sem `exceededCpu` no `PasswordHasher` e o CPU do render do email no Worker no Free.

