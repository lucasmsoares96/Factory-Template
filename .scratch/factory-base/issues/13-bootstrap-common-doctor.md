# 13: Bootstrap: estrutura, parte comum e `doctor`

Spec: [../spec.md](../spec.md)

**What to build:** quem copia o Template roda `pnpm bootstrap`, configura a parte comum a todos os Products (Cloudflare e labels) e confere tudo com `pnpm bootstrap doctor`. Rodar de novo não cria nada repetido. A estrutura do wizard, com clientes falsos, fica pronta para os módulos dos tickets seguintes.

**Blocked by:** 11

**Status:** done

- [x] Wizard em TS com `@clack/prompts` dentro de `.factory/`, `pnpm bootstrap`; `gh` como único pré-requisito, `wrangler` e `neonctl` como devDependencies; chamadas ao `gh` num módulo de forja só.
- [x] Clientes de GitHub, Cloudflare, Neon e Resend atrás de interfaces, com adaptador real e falso.
- [x] Sem estado local e sem segredo em disco: cada etapa consulta o estado e pula o que existe; `--redo <etapa>`.
- [x] Parte comum: token da Cloudflare pela URL do template "Edit Cloudflare Workers", `CLOUDFLARE_ACCOUNT_ID`, registro do `workers.dev` se faltar, labels a partir do `config.ts` (`gh label create --force`).
- [x] `doctor` só leitura: secrets, variáveis, labels, recursos e permissões, mostrando o que ficou desligado.
- [x] Testes contra os falsos: segunda execução não cria nada, `--redo`, labels conferidas (seam 8).

## Comments

Implementado em 2026-10-19. Código em `.factory/src/bootstrap/` (`cli.ts`, `steps.ts`, `common.ts`, `doctor.ts`, `labels.ts`, `clients.ts`, `github.ts`, `cloudflare.ts`, `services.ts`, `prompter.ts`, `fake/fakes.ts`), testes em `.factory/test/bootstrap/` (26 casos), script raiz `pnpm bootstrap`.

Versões (npm, 2026-10-19): `@clack/prompts` 1.8.1, `neonctl` 8.8.0, `wrangler` 4.151.2 (já no catalog), todos fixados no catalog; `@clack/prompts` em `dependencies`, `neonctl` e `wrangler` em `devDependencies` de `@factory/harness`. URL do template conferida na doc "Account-owned token template URLs": chaves `workers_scripts`, `workers_kv_storage`, `workers_r2` (edit) e `account_settings` (read); a doc não lista chave para Workers Tail, então fica de fora.

Decisões e desvios:
- Etapas da parte comum: `cloudflare-token`, `workers-dev`, `labels` (nomes aceitos por `--redo`). Token e `CLOUDFLARE_ACCOUNT_ID` vão para secrets do repo via `gh secret set` por stdin; ficam só em memória durante a execução.
- Como segredos não são legíveis, a segunda execução não verifica o `workers.dev` sem `CLOUDFLARE_API_TOKEN` no ambiente (diz "not verified" e não pergunta nada). O `doctor` também mostra `skip` nesse caso.
- Cor e descrição das labels ficam em `labels.ts`, indexadas pelas chaves de `config.labels` (o tipo exige uma entrada por chave); `config.ts` não mudou. `product:<id>` é do `bootstrap product` (ticket 14).
- Clientes Neon (`neonctl projects list`) e Resend (REST) têm só `findProject`/`findDomain`; os tickets 14 em diante ampliam as interfaces.
- `doctor` mostra os interruptores `DEPLOY_ENABLED`, `PREVIEWS_ENABLED`, `FACTORY_ENABLED`, a auth do Claude (aviso se houver as duas), `FACTORY_TOKEN` e a queda para secrets no repo (`FACTORY_USE_ENVIRONMENTS=false`). Exit 1 só se algo obrigatório faltar. O `doctor` por Product é do ticket 14.
- `destroy`, `product` e a verificação final não existem aqui (tickets 14 e 19): hoje respondem "Unknown command".

Pending (human): rodar `pnpm bootstrap` na conta real (criar o token pela URL do template, registrar o `workers.dev`) e `pnpm bootstrap doctor` para conferir. O adaptador real do `gh` e da Cloudflare só foi exercitado por testes de construção de comando/fetch falso.

Revisão: `workers_r2` saiu do template do token (R2 está fora do escopo da spec; a pesquisa 26 só cita R2 como recurso de auto-provisionamento do Wrangler, que o Skeleton não usa). Ficam `workers_scripts`, `workers_kv_storage` e `account_settings`. Teste em `bootstrap/common.test.ts`.

Correção da URL do token (2026-10-20): a URL era impressa por `clack.note`, que quebra o texto na largura do terminal e põe a moldura (`│`) no meio dela; o link ficava cortado (`...permissionGroupKeys=%5`) e o Ctrl+click abria só o pedaço. A codificação já era única (`%255` era `%5` + a quebra), não havia dupla codificação. Correção: novo `Prompter.link(mensagem, url)` imprime a URL sozinha numa linha, sem moldura e sem quebra (`process.stdout.write`); a URL agora usa `URLSearchParams` (nome com `+`, mais curta). `cloudflareTokenUrl(accountId?)`: com conta conhecida (`CLOUDFLARE_ACCOUNT_ID` no ambiente ou memória) gera `https://dash.cloudflare.com/<conta>/api-tokens/create?permissionGroupKeys=...&name=...` (forma que o usuário confirmou funcionar); sem conta, cai no `?to=/:account/api-tokens&...`, a única forma documentada (docs "account owned token template", atualizada 2025-01-14, conferida em 2026-10-20; `:account` é placeholder literal e o dashboard pergunta a conta). A forma direta não está nos docs, só validada à mão. O wizard ainda não conhece a conta nesse passo (ela vem da listagem feita com o token). Nenhuma outra URL longa é impressa hoje (Neon, Resend e PAT do GitHub não imprimem URLs). Testes: `bootstrap/common.test.ts` (terminal de 60 colunas, uma linha, codificação única, três permissões e nome; builder com e sem conta).
Pending (human): conferir na conta real que o Ctrl+click abre o template completo.
