# 03: Cadastro e verificação de email

Spec: [../spec.md](../spec.md)

**What to build:** um visitante se cadastra com email e senha, recebe o email de verificação, pode pedir reenvio e só usa a app depois de verificar. O hash de senha roda num Durable Object, e o email sai pelo Resend na produção e cai no outbox nos testes e no preview.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Better Auth 1.7 com `emailAndPassword` e verificação obrigatória, montado na `platform/` do Skeleton.
- [ ] DO `PasswordHasher` sem estado (RPC `hash`/`verify`, pool de 16 nomes por `getByName`, um retry em `.retryable`) plugado em `emailAndPassword.password.hash/verify`; scrypt sem mudança de parâmetros.
- [ ] Adaptador de email: Resend com `html` renderizado do `react-email` 6 e remetente do Product; outbox no banco no preview e nos testes. Os emails usam as mensagens do i18n.
- [ ] Telas de cadastro, "verifique seu email" com reenvio e o destino do link de verificação.
- [ ] Testes de integração: cadastro grava o usuário, o email é capturado por MSW, o link verifica, o usuário não verificado é recusado; `testUtils()` do Better Auth numa instância só de teste (seam 3).
- [ ] Teste das telas no Browser Mode (seam 4) e E2E cadastro → verificação pelo email capturado (seam 5).
