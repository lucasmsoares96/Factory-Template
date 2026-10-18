# Medir o hash de senha num Durable Object no Free

Type: task
Status: open

## Question

O hash scrypt do Better Auth (65–179 ms de CPU) roda dentro de um Durable Object no Workers Free sem `exceededCpu`? A doc dos limites de DO se contradiz (tabela: 30 s por request; texto: limite do plano do Worker, 10 ms no Free), e a única medição pública é de terceiros ([pesquisa](../research/20-durable-object-password-hash.md)).

Trabalho (AFK, na conta do usuário):
- Deploy de um Worker descartável com uma classe `PasswordHasher` (SQLite-backed, RPC `hash`/`verify` usando `better-auth/crypto`), chamada por `getByName` num pool de nomes.
- 50 chamadas (sequenciais e em rajada paralela) acompanhadas no `wrangler tail`; registrar CPU por invocação do DO e qualquer `exceededCpu`/1102.
- Apagar o Worker no fim.

Resultado esperado: CPU do DO bem acima de 10 ms, todas `ok`. Se falhar, as saídas são as de [Medir a CPU do login no leadflow](17-leadflow-login-cpu.md): scrypt mais barato, plano Paid ou login externo.
