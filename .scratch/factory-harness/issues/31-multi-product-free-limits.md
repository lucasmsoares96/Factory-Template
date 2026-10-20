# Limites gratuitos com vários produtos

Type: research
Status: resolved

## Question

Com vários produtos separados num repo privado só ([Vários produtos num repo só](30-multi-product-repo.md)), cada um com Worker, banco e domínio próprios, quais limites dos planos gratuitos são por conta (somados entre produtos) e quais são por recurso? Na documentação oficial mais recente (outubro de 2026), com versão e data:

- **Cloudflare Workers Free**: requests/dia e CPU por conta ou por Worker; número máximo de Workers, KV namespaces, Durable Objects (classes, SQLite) e Worker Previews por conta; domínios próprios e rotas por Worker.
- **Neon Free**: quantos projetos por conta, branches por projeto, compute-hours e armazenamento somados ou por projeto. Cada produto tem um projeto de produção e um `<produto>-preview` ([Segurança do CI do PR com código da Factory](19-pr-ci-security.md)).
- **Resend Free**: quantos domínios por conta, cota de emails por dia e por mês somada entre domínios.
- **GitHub Actions** em repo privado no Free: minutos por mês por conta, jobs simultâneos, armazenamento de artifacts e do GHCR.
- **Turborepo e pnpm**: a forma oficial de rodar só os pacotes afetados por um PR (`--affected`, `--filter`), e como isso se comporta quando um pacote compartilhado muda.
- **Precedentes**: exemplos oficiais de monorepo com vários Workers (Cloudflare, Turborepo), e como fazem deploy e preview por app.

Resultado: uma tabela limite → por conta ou por recurso → quantos produtos cabem de graça, e o que exige plano pago.

## Answer

- **Resend Free é o menor teto: 3 domínios verificados por team, ou seja 3 produtos** com e-mail de produção. Do 4º em diante, Pro ($20/mês, 10 domínios). A cota de 100/dia e 3.000/mês é da conta, somada entre produtos e com os e-mails recebidos no E2E. O Email Sending da Cloudflare não existe no Free.
- **GitHub Free privado: 2.000 min/mês de Actions por conta**, somados entre produtos e a Factory. Cache de 10 GB por repo (dividido entre produtos), artifacts e Packages 500 MB, GHCR grátis. Sem environments, secrets de environment, branch protection nem rulesets. Teto de 100 secrets por repo, e os secrets de cada produto vão com prefixo.
- **Neon Free: 100 projetos**, ou seja 50 produtos com prod + `<produto>-preview`. O que limita antes é o **storage de 20 GB somados**. CU-h (100), egress (5 GB), 1 GB e 10 branches são por projeto.
- **Workers Free: 100 mil requests/dia por conta**, somados entre Workers. Assets não contam. Os demais tetos por conta são 100 Workers e 100 classes de DO (50 produtos com 2 classes), 5 crons, KV com 1 GB e 1.000 escritas/dia, e DO com 5 GB. CPU, Previews (100 por Worker) e rotas/domínios (por zona) são por recurso.
- **Afetados:** `turbo run --affected` equivale a `--filter=...[main...HEAD]` e inclui os dependentes, então mudar o Skeleton seleciona todos os produtos. Precisa de histórico completo, senão roda tudo. `turbo query affected --packages` dá a lista para a matrix. A Cloudflare documenta Previews por Worker num monorepo, mas não há exemplo oficial com vários Workers + `--affected`.

[pesquisa](../research/31-multi-product-free-limits.md)
