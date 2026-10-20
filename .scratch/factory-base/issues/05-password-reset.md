# 05: Reset de senha

Spec: [../spec.md](../spec.md)

**What to build:** um usuário que esqueceu a senha pede o reset, recebe um link por email, define uma senha nova e entra com ela. As outras sessões dele deixam de valer.

**Blocked by:** 04

**Status:** done

- [x] Telas de pedido de reset e de nova senha; email de reset com as mensagens do i18n.
- [x] O reset revoga as outras sessões do usuário.
- [x] Pedido de reset para email inexistente responde igual a um existente.
- [x] Testes de integração: link capturado por MSW, senha antiga recusada, nova aceita, outra sessão revogada (seam 3).
- [x] E2E `@evidence` do reset completo (seam 5).

## Comments

Implementado em 2026-10-19. Nenhuma dependência nova: tudo sai das versões já fixadas no `catalog` (better-auth 1.7.11, react-email 6.11.3, resend 6.34.1, wrangler 4.151.2, TanStack Router 1.170.45 / Form 1.33.5, Playwright 1.64.1), conferidas de novo nos tipos e no código publicados nessa data (`emailAndPassword.sendResetPassword`, `revokeSessionsOnPasswordReset`, `onPasswordReset`, `resetPasswordTokenExpiresIn` padrão 1 h; rotas `/request-password-reset`, `GET /reset-password/:token`, `POST /reset-password`).

O que ficou:
- `authOptions()`: `sendResetPassword` (email do i18n, sai depois da resposta como os outros), `revokeSessionsOnPasswordReset: true` (o Better Auth apaga as sessões na mesma transação da senha nova) e `onPasswordReset` → `revokeAccessAfterPasswordReset(c, user)` em `platform/password-reset.ts`. **Gancho do ticket 06:** esse arquivo é o único lugar; a lista `revokers` está vazia e recebe a revogação das Connections (`listUserGrants` + `revokeGrant`). Ele roda depois da senha salva e das sessões apagadas, antes da resposta.
- Email: `emails/reset-password.tsx` (textos `emails.resetPassword` em `en` e `pt-BR`). O layout comum do email de link saiu para `emails/link-email.tsx` (`linkEmail`, `renderEmail`); o de verificação passou a usá-lo sem mudar o que envia.
- Telas: `/forgot-password` (TanStack Form; a mesma mensagem "se {email} tiver uma conta…" para qualquer email; aceita `?email=` vindo do login) e `/reset-password` (destino do link: com `?token=` pede a senha nova e manda para `/sign-in?passwordReset=true` com o aviso "A sua senha foi trocada"; com `?error=` ou sem token mostra o motivo e "Pedir um link novo"; `INVALID_TOKEN` no envio também oferece o link novo). Link "Esqueceu a senha?" no login, levando o email digitado.
- Pedido para email desconhecido: o Better Auth responde igual (status e corpo) e simula o trabalho; nada é enviado. Rate limit padrão do Better Auth para `/request-password-reset`: 3 a cada 60 s por IP, no mesmo `RateLimiter`.
- Testes: seam 3 `test/password-reset.test.ts` (pedido → email capturado pelo MSW com assunto do i18n → link redireciona para `/reset-password?token=` → senha antiga recusada e nova aceita; duas sessões abertas recebem 401 em `/api/me` depois do reset; email desconhecido responde igual e não recebe nada; link usado de novo e link adulterado → `INVALID_TOKEN` sem mudar a senha; senha curta recusada sem gastar o link). Conferido em vermelho antes: sem `sendResetPassword` (400) e sem `revokeSessionsOnPasswordReset` (sessão segue 200). Seam 4 `test/browser/password-reset.browser.test.tsx` (7 testes; handlers escritos à mão em `test/spa/auth-handlers.ts`). Seam 5 `e2e/specs/password-reset.spec.ts` `@evidence` (`forgot-password`, `reset-link-sent`, `reset-password`, `password-reset`): usuário verificado logado num segundo contexto (outro IP), reset pelas telas com o email capturado, senha antiga recusada, nova aceita, e o outro contexto cai no login. O fixture `mailbox.latest(to, { subject })` ganhou o filtro por assunto.
- `TURBO_FORCE=1 pnpm factory:verify` verde (12 tasks; skeleton 71 testes node+browser, harness 91, E2E do example 4 + 3 specs).

Desvios e decisões:
- O reset encerra **todas** as sessões do usuário (quem pede o reset normalmente não está logado; quem estava logado entra de novo com a senha nova). A tela de senha nova avisa isso.
- O reset não loga o usuário automaticamente: volta para o login com o aviso.
- `test/db.test.ts`: os três testes de `db check` (drizzle-kit num processo filho, `spawnSync`) ganharam timeout de 180 s. Sozinhos levam ~15 s, mas no `verify` completo, com Workers, navegadores e scrypt em paralelo, chegaram a 50–89 s e um `verify` estourou os 60 s padrão.
