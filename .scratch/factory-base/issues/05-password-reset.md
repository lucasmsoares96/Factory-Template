# 05: Reset de senha

Spec: [../spec.md](../spec.md)

**What to build:** um usuário que esqueceu a senha pede o reset, recebe um link por email, define uma senha nova e entra com ela. As outras sessões dele deixam de valer.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Telas de pedido de reset e de nova senha; email de reset com as mensagens do i18n.
- [ ] O reset revoga as outras sessões do usuário.
- [ ] Pedido de reset para email inexistente responde igual a um existente.
- [ ] Testes de integração: link capturado por MSW, senha antiga recusada, nova aceita, outra sessão revogada (seam 3).
- [ ] E2E `@evidence` do reset completo (seam 5).
