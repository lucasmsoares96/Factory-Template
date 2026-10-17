# Medir a CPU do login no leadflow

Type: task
Status: open

## Question

O login com email e senha do Better Auth (scrypt nativo, `N=16384`) cabe no plano Workers Free sem erro 1102? O leadflow (`~/Bytewer/monorepo/site/leadflow`, Worker `leadflow`) já roda isso em produção. Levantar nos Workers Logs / Analytics (ou `wrangler tail` durante logins de teste):
- `cpuTime` das requests de `/api/auth/sign-in/email` (e de sign-up, que também faz hash);
- se já houve algum `exceededCpu` / 1102 no Worker;
- o comportamento com uma rajada de logins seguidos (por exemplo 5 a 10 em poucos segundos).

Se o `wrangler` não estiver logado na conta do usuário, entregar um checklist curto para ele rodar.

Resultado esperado: confirmar email e senha no Free, ou acionar a saída já prevista (rate limit de login e parâmetros de scrypt mais baratos) antes de escrever a spec do Skeleton.
