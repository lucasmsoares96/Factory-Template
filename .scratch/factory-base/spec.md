# Spec: base da Factory e do Skeleton

Status: ready-for-agent
Origem: [mapa do wayfinder](../factory-harness/map.md), principalmente [Fronteira entre a base e o backlog da Factory](../factory-harness/issues/29-base-vs-factory-backlog.md) e as revisões dele.

## Problem Statement

O usuário quer um Template público em que uma issue marcada como pronta vire, sem intervenção humana, um pull request revisado e com evidência. Esse trabalho é da Factory, e o Template traz junto o Skeleton sobre o qual os Products são construídos. Hoje o repo tem só as skills do Matt, dois workflows do `claude-code-action` e o mapa de decisões. Não existe harness, app, CI, preview nem bootstrap.

A Factory não consegue construir a própria fundação. Para rodar, ela precisa de um repo com stack ponta a ponta, auth, `factory:verify`, preview por PR e um harness que funcione. Se a primeira issue da Factory rodar sobre uma fundação incompleta, uma falha não diz se o problema está no harness ou na base. O usuário precisa de uma base feita à mão, com o Claude Code local, toda verde e medida, antes de entregar à Factory o resto do Skeleton como teste de aceitação.

## Solution

O usuário implementa a **base** com o Claude Code local, ticket a ticket, a partir de `.scratch/factory-base/issues/`. Quando a base termina, o repo tem:

- um workspace com vários Products: o pacote do Skeleton, o Product de exemplo `example` e o pacote da Factory;
- o Skeleton com a `platform/` (Hono, banco, Better Auth, Durable Objects de hash e rate limit, email com outbox, i18n, ponte OpenAPI → MCP), a auth completa com telas e emails, e uma fatia mínima `GET /api/me` que exercita todas as camadas;
- a Factory em `.factory/`, com os quatro seams, os jobs `claim` → `work` → `publish`, a Triage, o fluxo de comentários no PR, o agendador de Blocked Issues e a atualização de branches, além da execução local num container;
- o CI por Product afetado: `factory:verify`, preview por PR com smoke, deploy da `main` com smoke e `skills-check`;
- o `pnpm bootstrap`, com uma parte comum, `bootstrap product <id>`, `doctor` e `destroy`;
- os arquivos de harness (`AGENTS.md`, skills, `.claude/settings.json`, `.mcp.json`) e a imagem de execução no GHCR;
- os ADRs e docs em `docs/`, escritos no fim.

**Base pronta** significa: as três partes do bootstrap com `doctor` verde, um deploy de teste, um PR de teste com preview e smoke, o teste `new-product ci-probe` passando e os critérios de aceite medidos. Só então a Factory recebe a primeira issue do backlog do Skeleton, que é uma spec separada, publicada depois no GitHub. O último ticket da base é o prompt de instalação da Factory num repo do Forgejo, e ele só é escrito depois que a Factory passa no teste de aceitação.

## User Stories

### Quem copia o Template

1. Como quem copia o Template, quero criar meu repo pelo botão "Use this template", para começar sem fork e sem `upstream`.
2. Como quem copia o Template, quero que nada fique fixo no código (nome de repo, conta, domínio), para que a cópia funcione só com secrets e variáveis.
3. Como quem copia o Template, quero um wizard `pnpm bootstrap` que me guie conta por conta, para não precisar ler a documentação de quatro serviços.
4. Como quem copia o Template, quero que o wizard só exija o `gh` instalado, porque o `wrangler` e o `neonctl` já vêm como devDependencies.
5. Como quem copia o Template, quero que o wizard consulte o estado atual e pule o que já está feito, para poder rodá-lo de novo sem medo.
6. Como quem copia o Template, quero refazer uma etapa com `--redo <etapa>`, para corrigir um passo sem refazer tudo.
7. Como quem copia o Template, quero que nenhum segredo seja gravado em disco pelo wizard, para não vazar credencial num arquivo esquecido.
8. Como quem copia o Template, quero que a parte comum configure a Cloudflare, o machine user, o token do Claude e as labels uma vez só, para todos os Products.
9. Como quem copia o Template, quero que `pnpm bootstrap product <id>` configure a Produção e os Previews de um Product, para acrescentar Products um de cada vez.
10. Como quem copia o Template, quero que o token da Cloudflare seja criado pela URL do template "Edit Cloudflare Workers", porque esse token só nasce no dashboard.
11. Como quem copia o Template, quero que o subdomínio `workers.dev` seja registrado pela API quando faltar, para o primeiro deploy não falhar por isso.
12. Como quem copia o Template, quero que o wizard procure o projeto Neon pelo nome antes de criar, para não duplicar banco numa segunda execução.
13. Como quem copia o Template, quero uma API key do Neon restrita a cada projeto, para que a key do preview nunca alcance a produção.
14. Como quem copia o Template, quero poder adiar o domínio do Resend, para subir a produção antes de ter um domínio.
15. Como quem copia o Template, quero ver os registros DNS do Resend no wizard, para verificar o domínio sem procurar no dashboard.
16. Como quem copia o Template, quero que o wizard convide o machine user como colaborador `write`, aceite o convite e confira os escopos do PAT, para não errar a identidade da Factory.
17. Como quem copia o Template, quero que o wizard recuse um PAT do mesmo login que o dono do repo, para que o humano nunca seja o autor do PR da Factory.
18. Como quem copia o Template, quero escolher entre `CLAUDE_CODE_OAUTH_TOKEN` (recomendado) e `ANTHROPIC_API_KEY`, e que o `doctor` avise se os dois existirem.
19. Como quem copia o Template, quero que as labels sejam criadas a partir do `.factory/config.ts`, com nome, cor e descrição, para não manter duas listas.
20. Como quem copia o Template, quero que o wizard tente criar os environments `<id>-production` e `<id>-preview` e o ruleset da `main`, e que caia para secrets no nível do repo quando a API recusar, para que o mesmo wizard sirva em repo público e em privado no Free.
21. Como quem copia o Template, quero que o `doctor` mostre o que ficou desligado por limitação do plano, para saber o que ganho trocando de plano.
22. Como quem copia o Template, quero rodar o wizard de novo depois de trocar de plano e ligar o que passou a existir.
23. Como quem copia o Template, quero que cada workflow só rode com a variável do seu módulo ligada, e que apareça como pulado em vez de falhar enquanto o módulo não estiver configurado.
24. Como quem copia o Template, quero que o wizard ligue a variável de cada módulo só depois de o `doctor` daquele módulo passar.
25. Como quem copia o Template, quero que o wizard termine com um deploy de teste e um PR de teste com preview e smoke, para saber que tudo funciona de ponta a ponta.
26. Como quem copia o Template, quero que tudo o que a verificação cria para testar (PR de teste, branch, Worker Preview, branch Neon, issue de exemplo) seja apagado ao final, passando ou falhando, para não sobrar lixo nas contas.
27. Como quem copia o Template, quero uma issue de exemplo para a Factory como opção, com "não" como padrão.
28. Como quem copia o Template, quero `pnpm bootstrap destroy [product <id> | módulo]`, que mostre tudo o que vai sumir, com o banco de produção em destaque, e exija digitar o id, para desmontar sem apagar o que não devia.
29. Como quem copia o Template, quero que o `destroy` recuse rodar sem TTY ou com `CI` definido, para que nenhum agente o execute.
30. Como quem copia o Template, quero apagar o Product `example` quando não precisar mais dele.
31. Como quem copia o Template, quero que o README explique os Termos do GitHub sobre a conta de máquina gratuita e o alcance do PAT clássico.
32. Como dono de um repo privado, quero apontar `work` e `build` para um runner próprio por `vars.FACTORY_RUNNER`, para não gastar os 2.000 minutos do Actions.
33. Como dono de um repo privado, quero um doc do runner próprio (VM dedicada, efêmero por JIT, uid 1001, `ACTIONS_RUNNER_REQUIRE_JOB_CONTAINER`), para montá-lo sem expor o host.

### Quem desenvolve um Product

34. Como dev, quero `pnpm new-product <id>`, que cria `apps/<id>/` a partir do molde do Skeleton, registra o Product e mostra o comando do bootstrap.
35. Como dev, quero que a identidade do Product (`id`, `title`, `emailFrom`, domínio) fique num `product.config.ts`, para não editar arquivo do Skeleton.
36. Como dev, quero estender o Skeleton com configuração, tema por tokens do shadcn, textos do i18n por cima, features próprias e roles a mais, sem substituir tela nem regra do Skeleton.
37. Como dev, quero que um lint impeça o Product de importar algo que não seja export público do Skeleton e impeça o Skeleton de importar de `apps/`.
38. Como dev, quero que `pnpm dev` suba o Product quando houver um só, e peça `pnpm dev <id>` quando houver vários.
39. Como dev, quero rodar `pnpm dev`, `pnpm factory:verify` e `pnpm factory local` sem ter feito bootstrap.
40. Como dev, quero que `pnpm factory:verify` rode typecheck, lint, testes de integração, testes do front e Playwright, e que use o `DATABASE_URL` se ele existir ou suba o Postgres por `docker compose` se não existir.
41. Como dev, quero que `pnpm generate` produza a OpenAPI, o cliente e os handlers do Kubb, o `routeTree.gen.ts` e a lista de tools do MCP, e que todas as tasks dependam dele.
42. Como dev, quero que o código do Kubb e a `openapi.json` fiquem fora do git e que o `routeTree.gen.ts` e o snapshot do `tools/list` fiquem dentro.
43. Como dev, quero que as migrations do Skeleton fiquem no pacote, num schema Postgres e numa `migrationsTable` próprios, e rodem antes das do Product.
44. Como dev, quero que o CI recuse alterar uma migration publicada, no Skeleton ou no Product.
45. Como dev, quero que o `factory:verify` rode `drizzle-kit check` e confira `no_changes` depois de migrar um banco vazio.
46. Como dev, quero uma feature declarada por uma interface `Feature` (API, MCP manual opcional, navegação, seed, eventos), para que uma feature nova não mexa no núcleo.
47. Como dev, quero criar um endpoint Hono com Zod e OpenAPI e receber o hook do Kubb, o handler do MSW e a tool do MCP sem escrever mais nada.
48. Como dev, quero que toda rota de lista use `limit` (padrão 50) e cursor.
49. Como dev, quero que a API devolva um código de erro estável e uma mensagem em inglês, que a SPA traduza pelo código e que o MCP receba o inglês.
50. Como dev, quero as strings do Skeleton em `en` e `pt-BR`, com objeto tipado (o `tsc` pega a chave que faltar) e o idioma escolhido por config no build.
51. Como dev, quero que os emails usem o mesmo arquivo de mensagens da UI.
52. Como dev, quero skills `skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-add-feature` e `skeleton-evidence-test`, com as receitas da stack.
53. Como dev, quero que os specs de E2E do Skeleton fiquem no pacote e rodem no `e2e` de cada Product.
54. Como dev, quero que os testes localizem elementos por role e chave do i18n (ou `data-testid`), nunca pelo texto, para que um Product possa trocar os textos sem quebrar os testes.
55. Como dev, quero que as versões da stack fiquem fixadas num catalog do pnpm, para que o lockfile não mude a stack sem aviso.

### Usuário final de um Product

56. Como visitante, quero me cadastrar com email e senha.
57. Como usuário cadastrado, quero receber um email de verificação e só usar a app depois de verificar.
58. Como usuário, quero pedir o reenvio da verificação.
59. Como usuário, quero entrar com email e senha.
60. Como usuário, quero sair.
61. Como usuário que esqueceu a senha, quero receber um link de reset por email e definir uma senha nova.
62. Como usuário, quero que um reset de senha revogue minhas outras sessões e as Connections.
63. Como usuário, quero ver meu nome na página inicial depois de entrar.
64. Como usuário, quero que tentativas de login em excesso sejam bloqueadas por IP, para que ninguém descubra minha senha por força bruta.
65. Como usuário, quero a UI no idioma configurado pelo Product.
66. Como usuário, quero conectar um agente de IA à app pelo MCP, com consentimento e escolha entre `read` e `write`.
67. Como usuário que conectou um agente, quero que ele aja só com a minha identidade e as minhas permissões, pelas mesmas rotas da SPA.
68. Como usuário que concedeu só `read`, quero que o agente nem veja as tools de escrita.

### Cliente MCP

69. Como cliente MCP, quero descobrir o servidor de autorização a partir do 401 com `WWW-Authenticate` no `/mcp`.
70. Como cliente MCP, quero registrar-me por CIMD ou por DCR.
71. Como cliente MCP, quero uma tool por operação da API, com nome, descrição, schema de entrada e de saída e anotações derivadas do verbo HTTP.
72. Como cliente MCP, quero receber `structuredContent` no sucesso e `isError: true` com a mensagem legível num 4xx.
73. Como cliente MCP, quero que um token de um Product não valha em outro Product.

### Quem mantém o harness

74. Como mantenedor, quero que o YAML de cada workflow seja fino e termine em `pnpm factory <comando>`, para que a lógica fique em TS e seja testável.
75. Como mantenedor, quero que a Factory fale com a forja só pelos seams `Tracker` e `CodeHost`, para que um adaptador do Forgejo caiba sem mexer no loop.
76. Como mantenedor, quero adaptadores falsos de `Tracker`, `CodeHost`, `Agent` e `Verify`, para testar o loop inteiro sem Claude, sem Docker e sem forja.
77. Como mantenedor, quero que toda mudança de comportamento do harness venha com teste contra os adaptadores falsos.
78. Como mantenedor, quero um teste que falhe se o job `work` do YAML receber `FACTORY_TOKEN`.
79. Como mantenedor, quero um teste que falhe se `work` ou `build` rodarem sem `container:`, ou se `claim`, `publish`, `apply`, `deploy` ou `image` aceitarem `vars.FACTORY_RUNNER`.
80. Como mantenedor, quero um teste que falhe se as tabelas de labels de `docs/agents/triage-labels.md` divergirem do `.factory/config.ts`.
81. Como mantenedor, quero que o adaptador `Agent` rode o Sandcastle num processo filho com env por allowlist (`PATH`, `HOME`, auth do Claude, `DATABASE_URL`, `CI`), com teste.
82. Como mantenedor, quero que modelos, timeouts, limite de tentativas, labels e limite de previews fiquem no `config.ts`, sobrescrevíveis por variável do repo.
83. Como mantenedor, quero os prompts em `.factory/prompts/`, em inglês, como templates que chamam as skills pelo nome e repetem as regras duras.
84. Como mantenedor, quero um job `skills-check` que restaure as skills do `skills-lock.json` e exija `git diff` vazio e symlinks corretos.
85. Como mantenedor, quero uma imagem `ubuntu:24.04` + `setup.sh`, com tag pelo hash das versões, construída sob demanda e publicada no GHCR do repo, para não pagar setup em cada job.
86. Como mantenedor, quero que o PR que sobe uma versão da stack já teste com a imagem nova.
87. Como mantenedor, quero o `stream-json` de cada sessão como artifact, uma linha por tentativa e Stage no resumo do job e o custo estimado na review e na Escalation.

### Quem opera a Factory

88. Como humano com `write`+, quero marcar uma issue com `ready-for-agent` e receber um PR draft que vira `ready` com review e evidência.
89. Como humano, quero que a Factory só aceite `ready-for-agent` aplicada por quem tem `write`+.
90. Como humano, quero que a Factory recuse a spec pai, uma issue com PR aberto, uma issue sem `## Acceptance criteria` (vai para `needs-info`) e uma issue sem seams (vai para `agent:explore`).
91. Como humano, quero que a troca `ready-for-agent` → `in-progress` sirva de trava, e que tirar `in-progress` cancele a execução.
92. Como humano, quero que uma Blocked Issue mantenha `ready-for-agent`, receba um único comentário "Waiting on …" e comece sozinha quando o último bloqueador for mergeado.
93. Como humano, quero que o agendador varra todas as issues `ready-for-agent` a cada fechamento, para recuperar eventos perdidos.
94. Como humano que removeu uma dependência, quero ser orientado a recolocar `ready-for-agent` para começar na hora.
95. Como humano, quero que cada tentativa siga Development → Review → E2E, com Development em TDD nos seams combinados e a Review corrigindo em vez de reprovar.
96. Como humano, quero que só a falha no E2E volte ao Development, com o comando que falhou e a saída cortada, até 5 vezes.
97. Como humano, quero uma Escalation clara (PR em draft, comentário com motivo, uma linha por tentativa, link do run, `ready-for-human`) depois de 5 falhas, de estouro de tempo, de `needs-human` ou de falha de infra.
98. Como humano, quero re-rotular uma issue escalada e ver a Factory recomeçar da `main`, fechando o draft antigo.
99. Como humano, quero que o PR da Factory saia com título `Fix #N: <título>`, corpo `Closes #N` e a review como `COMMENT` com comentários inline.
100. Como humano, quero os prints `@evidence` de todos os Products afetados num único comentário, agrupados por Product e editado a cada volta.
101. Como humano com `write`+, quero comentar no PR e ver cada thread receber Address, Decline ou Defer, com as perguntas respondidas na thread.
102. Como humano, quero que comentários avulsos sejam agrupados por alguns minutos e que uma review enviada dispare na hora.
103. Como humano, quero que PRs da Factory em conflito com a `main` sejam atualizados sozinhos: merge limpo sem agente, conflito resolvido pelo agente preservando as duas intenções.
104. Como humano, quero que uma execução descarte o trabalho e comente "Run discarded: …" se o estado mudou ou o branch andou.
105. Como humano, quero que um diff que toca `.github/workflows/`, skills, `skills-lock.json`, `.claude/settings.json` ou `.mcp.json` vire Escalation sem PR, com o patch no comentário.
106. Como humano, quero que um diff que toca `AGENTS.md`, `docs/agents/`, `GLOSSARY.md`, `docs/adr/` ou `.factory/` receba a label `harness-change` e um aviso no topo do PR.
107. Como humano, quero marcar uma issue com `agent:explore` e receber um veredito da Triage (`easy-call`, `needs-a-human`, `blocked`) com os seams sob teste, e ver `easy-call` virar `ready-for-agent` sozinha.
108. Como humano, quero que a Triage confira a label `product:<id>` e a acrescente quando o caso for claro.
109. Como humano, quero rodar `pnpm factory local NN` contra uma issue em Markdown local, num container descartável, antes de testar no GitHub.
110. Como humano, quero que a Factory nunca faça merge, para que o Merge Gate seja sempre meu.

### Quem revisa um PR

111. Como revisor, quero um preview `pr-N` por Product afetado, com a URL comentada no PR.
112. Como revisor, quero que o preview use um banco Neon separado da produção, criado a partir de um branch `base` sem dados reais.
113. Como revisor, quero ler os emails do preview numa rota do outbox que só existe no preview.
114. Como revisor, quero que o código do PR nunca rode com secrets: `build` sem secrets, `deploy` com o código e o config da `main`, `smoke` sem secrets.
115. Como revisor, quero que o preview seja automático só para autor com `write`+, e que os demais precisem da label `preview` posta por alguém com `write`+.
116. Como revisor, quero que um PR que muda bindings pule o preview com um comentário explicando.
117. Como revisor, quero ver "preview skipped: limit reached" quando houver 9 previews abertos do Product.
118. Como revisor, quero que o preview e o branch Neon sejam apagados quando o PR fecha.
119. Como revisor, quero que só os Products afetados rodem `verify`, preview e smoke, e que uma mudança no Skeleton rode todos.

### Produção

120. Como dono do Product, quero que todo merge na `main` faça deploy dos Products afetados pelo Actions, nunca da máquina do dev.
121. Como dono do Product, quero que o deploy da `main` também separe `build` sem secrets de `deploy` com os tokens.
122. Como dono do Product, quero um smoke pós-deploy com login real e o 401 do `/mcp`, para que um `exceededCpu` no hash apareça como falha de deploy.

### Fim da base

123. Como usuário, quero um teste de CI que crie `new-product ci-probe` numa cópia temporária e rode o `verify` sem deploy, apagando a cópia no fim.
124. Como usuário, quero os critérios de aceite medidos e registrados antes da primeira issue da Factory.
125. Como usuário, quero os ADRs e docs em `docs/` escritos no fim da base, para que a Factory comece já lendo `docs/adr/`.
126. Como usuário, quero, depois do teste de aceitação, um prompt único que instale a Factory num repo do Forgejo que já existe e tem outra stack.

## Implementation Decisions

### Workspace

- Workspace pnpm com Turborepo: `apps/<id>/` (um Worker por Product), `packages/skeleton/` e `.factory/`. Sem Remote Cache. O cache local fica ligado no dev e desligado no `build` do preview e no `work`.
- Tasks: `generate`, `typecheck`, `lint`, `test`, `e2e` e `build`. Todas dependem de `generate`, e `e2e` depende também de `build`. `pnpm factory:verify` é `turbo run typecheck lint test e2e`, com `--affected` no CI e na Factory e completo no local.
- Os arquivos da raiz entram em `globalDependencies`. Mudanças só em `.factory/` ou `.github/` rodam apenas os testes do harness.
- Versões fixadas num catalog, conferidas na documentação oficial na hora de implementar e registradas com a data: Hono 4.13 + `@hono/zod-openapi` + Zod 4, Swagger UI, Drizzle `1.0.0-rc.4` exato, Better Auth 1.7.x, wrangler ≥ 4.135, Kubb 5.x, MSW 3.0.x (com `peerDependencyRules.allowedVersions` para o `@kubb/plugin-msw`), TanStack Router/Query/Form, shadcn com Base UI (`-b base`), `react-email` 6 renderizado para `html`, Playwright, Sandcastle fixado (pré-1.0).
- `docker-compose.yml` com o Postgres de teste. A imagem `postgres` usa login ou espelho no GHCR por causa do limite de pulls do Docker Hub.

### Product e Skeleton

- O pacote Skeleton exporta a `platform/`, as features `auth` e `me` (`account`, `companies` e `invitations` virão da Factory), as migrations, o molde do `new-product` e os specs de E2E. Ele nunca importa de `apps/`.
- Cada Product é uma raiz de composição fina: `product.config.ts`, `wrangler.jsonc`, migrations próprias, `src/features/`, rotas e `AGENTS.md` gerado pelo molde. `example` é o Skeleton sem features próprias.
- Interface `Feature`: `{ id, api(app), mcp?(server), nav?, companyPage?, seed?(db), events?: { memberJoined?, companyDeleting? } }`. Os schemas entram por glob. As rotas da UI entram por `physical()` do `@tanstack/virtual-file-routes`.
- Um Product só estende o Skeleton: configuração, tema por tokens do shadcn, textos do i18n por cima, features próprias e roles a mais por `INSERT` em `member_roles`. Se faltar algo, a interface do Skeleton cresce.
- `pnpm new-product <id>` copia o molde, registra o Product e mostra o comando do bootstrap.
- Um Worker por Product: SPA em Static Assets com `@cloudflare/vite-plugin` e Hono em `/api/*` e `/mcp` (`run_worker_first`), sem Pages. DOs, `OAUTH_KV` e Previews ficam no Worker do Product.

### Banco

- `pg` + `drizzle-orm/node-postgres` direto na URL pooled do Neon em produção e preview, e no container no local. Sem Hyperdrive.
- Um banco por Product. As migrations do Skeleton ficam num schema Postgres e numa `migrationsTable` próprios, com dois configs de globs disjuntos, e rodam antes das do Product.
- Uma pasta de migrations por pacote. Migration publicada é imutável, sem squash, sem regenerar e sem renomear pasta. O CI confere.
- Tabelas da base: as do Better Auth, `member_roles` (`owner`, `employee`; a tabela de Members vem com Companies, na Factory), o outbox de email, o storage do `RateLimiter` no SQLite do DO e o que o `workers-oauth-provider` guarda no `OAUTH_KV`.
- Seed por feature, usado no branch `base` do Neon de preview e no E2E.

### Auth

- Better Auth 1.7 com `emailAndPassword`, verificação de email obrigatória, reset de senha por link e revogação das outras sessões e das Connections no reset. Troca de senha e de email ficam para a Factory.
- O hash de senha roda num DO `PasswordHasher` sem estado (RPC `hash`/`verify`, pool de 16 nomes por `getByName`, um retry em `.retryable`), plugado em `emailAndPassword.password.hash/verify`. Os parâmetros do scrypt não mudam.
- Rate limit com `rateLimit.enabled: true`, `customStorage` num DO `RateLimiter` (SQLite) e `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`. O binding de Rate Limiting da Cloudflare não é usado.
- Telas de cadastro, login, verificação de email (com reenvio), pedido de reset e nova senha, com emails em `react-email`.
- Um ponto único resolve o usuário pelo cookie da SPA ou pelo token do MCP.

### Email

- Adaptador de email com dois destinos: o Resend real na produção (`html` renderizado, remetente `emailFrom` do Product, API key restrita ao domínio) e o outbox no banco no preview e nos testes, lido por uma rota que só existe no preview.
- Nos testes de integração e no E2E local, o Resend é interceptado pelo MSW.

### Fatia mínima `GET /api/me`

- Rota Hono com Zod e OpenAPI (`operationId`, `summary`, `description`), hook do Kubb, página inicial logada com o nome do usuário, teste de integração do back, teste do front com MSW, E2E `@evidence` e a tool `getMe` saindo do gerador. Nada de Company.

### Ponte OpenAPI → MCP

- `workers-oauth-provider` + `createMcpHandler`, CIMD e DCR ligados, `legacy: "stateless"`. Um `/mcp`, um `OAuthProvider` e um `OAUTH_KV` por Product.
- `/authorize` lê a sessão do Better Auth e mostra o consentimento com a escolha `read`/`write`. O token carrega só o `userId`.
- O gerador fica no Skeleton e roda no `pnpm generate` de cada Product sobre a OpenAPI composta (`app.getOpenAPI31Document()`). Ele produz uma tool por operação: nome pelo `operationId`, descrição, schemas de entrada e saída, escopo pelo verbo (`GET` = `read`, o resto = `write`) e anotações (`GET` → `readOnlyHint`, `DELETE` → `destructiveHint`, `PUT` → `idempotentHint`). Opt-out com `x-mcp: false`. Rotas do Better Auth ficam fora.
- A tool chama a rota Hono dentro do Worker (`app.request(path, init, env)`) com a identidade no `env`, sem repassar o token do agente. Sucesso vira `structuredContent`, 4xx vira `isError: true`. O `tools/list` esconde as tools de escrita de um token `read`.
- O `verify` falha se uma operação exposta não tiver `operationId`, `summary` ou `description`, e compara o `tools/list` com um snapshot commitado por Product.
- Só tools. O `mcp?(server)` da `Feature` fica para o que não sai da OpenAPI. A página "Conexões" vem com a conta, pela Factory.

### i18n

- Mensagens tipadas `en` e `pt-BR` no Skeleton, idioma por variável de build, sem biblioteca, sem troca em tempo de execução. Cada feature de Product traz o seu `messages.ts`, e o Product sobrescreve textos por cima.

### Factory: pacote `.factory/`

- Pacote do workspace com a CLI `pnpm factory <claim|work|publish|triage|apply|unblock|update-branch|pr-feedback|local>`, `config.ts`, `prompts/`, adaptadores e o bootstrap.
- Quatro seams com adaptador real e falso:
  - `Tracker`: `issue` (com pai e filhos), `blockers` (`done` normalizado), `blocking`, `labeled`, `swapLabel` (falso se a label sumiu), `comment`, `canWrite`, `labelActor`. Adaptadores: GitHub (REST por `fetch` + Zod), Markdown local (`Status:`, `Blocked by:`, `## Comments`) e falso.
  - `CodeHost`: `push` (`--force-with-lease` contra o SHA de partida), `openPrFor`, `openDraftPr`, `markReady`, `closePr`, `submitReview`, `threads`, `replyToThread`, `postEvidence` (cria ou edita o comentário único), `dispatch`. Adaptadores: GitHub (`gh` só no `--attach`), local (branch local, review e Escalation no `## Comments`, prints em `.scratch/<feature>/evidence/NN/`) e falso. Tokens ficam fora da interface.
  - `Agent.run(stage, prompt, {timeout}) → {commits, output, usage}`: Sandcastle com `noSandbox()` num processo filho com env por allowlist, e falso roteirizado.
  - `Verify.run() → {ok, failedCommand, output}`: `factory:verify` e falso.
- `result.json`, validado com Zod nos dois lados: `outcome: ready | escalated`, `reason: e2e-failures | time | needs-human | infra`, `question`, `attempts[]`, `review {summary, inline[]}`, `threadReplies[]`, `usage` por Stage, `evidence[]`.
- Loop por tentativa: Development (sessão nova, processo do `implement` + `tdd` só nos seams combinados, Conventional Commits com `#N`, gate "gerou commits", pode sair com `needs-human` + pergunta) → Review (sessão nova, `code-review`, corrige e commita; nas tentativas seguintes, só o que mudou desde o último commit revisado + checagem dos achados anteriores) → E2E (`Verify`). Só o E2E conta falha, com limite de 5. Timeouts por Stage (Development 60 min, Review 30 min, E2E 20 min) contam como falha, e o teto global de 5 h 30 leva à Escalation "time". Opus em todos os Stages. Nunca `resume()`: passam a issue com comentários, `git log main..HEAD` e o último feedback.
- Guard determinístico: aberta, `ready-for-agent` aplicada por quem tem `write`+, não é spec pai, sem PR aberto, `## Acceptance criteria` no corpo, `## Testing Decisions` no pai ou comentário da Triage com `<!-- factory:triage -->` escrito pelo machine user, todos os bloqueadores `done`. Sem critérios → `needs-info`; sem seams → `agent:explore`; bloqueada → um comentário "Waiting on …", só no evento `labeled`.
- Cada execução lê o estado atual da forja, nunca o conteúdo do evento. Antes de escrever, o `publish` confere de novo (issue aberta, `in-progress`, PR aberto) e descarta com "Run discarded: …" se mudou.
- Caminhos protegidos: diff em `.github/workflows/`, `.agents/skills`, `.claude/skills`, `skills-lock.json`, `.claude/settings.json` ou `.mcp.json` → Escalation sem PR, com o patch no comentário. Diff em `AGENTS.md`, `docs/agents/`, `GLOSSARY.md`, `docs/adr/` ou `.factory/` → label `harness-change` + aviso no PR. O Development pode acrescentar ao glossário, mas não cria ADR.
- PR: draft, `Fix #N: <título>`, `Closes #N` + "Implemented by the Factory", review `COMMENT` (resumo de todas as tentativas, inline filtrado ao diff), comentário de evidência separado e agrupado por Product, `ready` no fim. Escalation: draft com aviso, comentário na issue, `in-progress` → `ready-for-human`, sem PR quando `needs-human` não tem commits. O retry fecha o draft antigo e recomeça da `main`.
- Comentários no PR: só de quem tem `write`+, nunca do próprio machine user, só em branch `factory/issue-N`. Debounce com `sleep 180` e `cancel-in-progress: true` (review enviada pula a espera). Começa com merge da `main`, depois Address/Decline/Defer por thread → Development → Review → E2E → prints. Ao estourar as 5 falhas, responde no PR e põe `ready-for-human`, sem virar draft. A Factory nunca resolve threads.
- Update-branch: merge limpo sem agente; com conflito, o agente resolve com "preserve both intents, do not invent new behaviour"; depois o `Verify` e, se falhar, o loop normal.
- Execução local (`pnpm factory local NN`): container descartável da mesma imagem, repo por `git clone` (nunca bind-mount), só a auth do Claude dentro, Postgres num container irmão em rede privada, sem o socket do Docker no container do agente. O `publish` roda no host com os adaptadores locais. Cobre o fluxo da issue e a Triage, uma issue por vez.
- Observabilidade: `stream-json` de cada sessão como artifact por 14 dias, `$GITHUB_STEP_SUMMARY` com uma linha por tentativa e Stage, tokens e custo estimado no rodapé da review e na Escalation. Nada persistente.

### Factory: workflows

- Três jobs por execução: `claim` (`GITHUB_TOKEN`, `issues: write`) → `work` (imagem, `contents: read`, `persist-credentials: false`, só a auth do Claude, `runs-on` aceita `vars.FACTORY_RUNNER`) → `publish` (VM nova, `FACTORY_TOKEN`, harness da `main`, `if: always()`, Escalation "infra" sem resultado). Ligados por `git bundle` + `result.json` + prints. `timeout-minutes: 350`.
- `factory-issue.yml` (`issues: labeled` + `workflow_dispatch`), `factory-triage.yml` (`agent:explore`, em lote, `work` só leitura → `apply`), `factory-pr-feedback.yml`, `factory-unblock.yml` (`issues: closed` + `workflow_dispatch`, varre todas as `ready-for-agent`) e `factory-update-branches.yml` (`push` na `main`, `git merge-tree --write-tree`, despacha `update-branch` só para os PRs em conflito). Sem cron.
- Os fluxos da issue, de comentários e de update-branch dividem o grupo `factory-N` (`cancel-in-progress: false`, `queue: max` só no GitHub). A garantia é o `--force-with-lease`.
- Labels: as cinco de triage, mais `in-progress`, `agent:explore`, `harness-change`, `preview` e uma `product:<id>` por Product, todas no `config.ts` e na tabela "Factory labels" de `docs/agents/triage-labels.md`.
- Saem `claude.yml` e `claude-code-review.yml`.

### CI do PR e produção

- Checkout com `--filter=blob:none`. `turbo query affected --packages` monta a matrix dos Products afetados (`fail-fast: false`).
- Workflow do PR em `pull_request_target`:
  - `build`: head do PR, imagem, sem secrets, sem cache, `persist-credentials: false`, `contents: read`, `runs-on` aceita `vars.FACTORY_RUNNER`. Roda `verify` e sobe o bundle, os assets e as migrations de cada Product afetado.
  - `deploy`: VM nova, checkout da `main`, `--config` do preview da `main`, artifact extraído em `$RUNNER_TEMP` e limitado por allowlist, `CLOUDFLARE_API_BASE_URL` fixado, dependências do lockfile da `main` com `--ignore-scripts`, número do PR lido do evento. Cria o branch Neon `preview/pr-N` a partir do `base` no projeto `<id>-preview`, aplica as migrations com `migrate(db, { migrationsFolder })` e roda `wrangler preview --name pr-N`. O config é gerado com o id do Product, sem editar arquivo do Skeleton. Pula com comentário quando os bindings mudaram ou o limite de 9 previews foi atingido.
  - `smoke`: Playwright do PR, sem secrets, contra a URL do preview: login real, outbox e o 401 do `/mcp`.
  - Um comentário lista cada Product com a URL do preview.
  - Preview automático só para autor com `write`+. Para os demais, a label `preview`, removida a cada push.
  - Limpeza no `closed`: `wrangler preview delete` + branch Neon apagado.
- Deploy da `main`: a mesma divisão `build` → `deploy` (migrations da produção + `wrangler deploy --name <id>`) → `smoke` da produção (login real, 401 do `/mcp`), por Product listado em `DEPLOY_PRODUCTS` e afetado. O deploy da `main` também migra o branch `base` do preview e o recria se ele tiver sido apagado.
- Job reaproveitável `image` (`packages: write`): calcula o hash (`.node-version`, Playwright do lockfile, Claude Code do `config.ts`, `Dockerfile`, `setup.sh`), confere a tag no GHCR e constrói só se faltar. A imagem é `ubuntu:24.04` + `setup.sh` (Node, pnpm via corepack, Claude Code, `git`, Chromium do Playwright), `useradd -u 1001`, `USER 1001`, sem `docker` CLI e sem `options: --user`. Quem usa a imagem pede `packages: read`, Postgres por `services:` e `defaults.run.shell: bash`.
- `skills-check`: CLI `skills` fixado, restaura do lock, `git diff --exit-code` e confere os symlinks.
- `ci-probe`: cria `new-product ci-probe` numa cópia temporária, roda o `verify` sem deploy e apaga a cópia.
- Ruleset na `main` (PR obrigatório, sem force-push nem exclusão, check `verify`), quando a API aceitar.

### Bootstrap

- Wizard em TS com `@clack/prompts`, dentro de `.factory/`, chamado por `pnpm bootstrap`. As chamadas ao `gh` ficam num módulo de forja só. Clientes de GitHub, Cloudflare, Neon e Resend atrás de interfaces, com adaptador real e falso.
- Parte comum: token e conta da Cloudflare, subdomínio `workers.dev`, machine user com PAT clássico `repo` sem `workflow`, auth do Claude, labels.
- `bootstrap product <id>`:
  - Produção (obrigatório): projeto Neon `<id>` com key restrita, domínio do Resend adiável, secrets com prefixo `<ID>_` e o id em `DEPLOY_PRODUCTS`.
  - Previews: projeto `<id>-preview` com branch padrão `base` e key restrita, KV do preview (`PREVIEW_OAUTH_KV_ID`) e o id em `PREVIEW_PRODUCTS`.
  - O KV da produção é criado pelo próprio `wrangler deploy`.
- Secrets comuns sem prefixo. Environments `<id>-production` e `<id>-preview` restritos à `main` quando a API aceitar. Se recusar, `FACTORY_USE_ENVIRONMENTS=false` e os secrets ficam no repo. `DEPLOY_ENABLED`, `PREVIEWS_ENABLED` e `FACTORY_ENABLED` são ligados depois do `doctor` do módulo.
- Sem estado local: cada etapa consulta o estado e pula o que já existe. `--redo <etapa>` refaz uma.
- `doctor` só leitura, também por Product.
- Verificação no fim: deploy de teste da `main`, PR de teste com preview e smoke, e a issue de exemplo opcional. **Tudo o que a verificação cria para testar é apagado ao terminar, passando ou falhando**: PR, branch, Worker Preview, branch Neon e issue de exemplo. O deploy da produção fica.
- `destroy [product <id> | módulo]`: apaga Worker e Previews, KVs, projetos Neon, domínio no Resend, secrets, variáveis, environments, ruleset e colaborador. Não apaga o repo, as issues, as labels nem as contas. Mostra a lista, destaca o banco de produção e exige digitar o id. Recusa sem TTY ou com `CI`. `deny` em `Bash(pnpm bootstrap destroy:*)` e regra no `AGENTS.md`.

### Arquivos de harness

- `AGENTS.md` (inglês, < 200 linhas) na raiz, em `packages/skeleton/`, em cada `apps/<id>/` (gerado pelo molde) e em `.factory/`. Nenhum `CLAUDE.md`. A raiz traz o que é o repo (com link para o `GLOSSARY.md`), o mapa dos diretórios, os comandos, as regras (inglês, Conventional Commits com `#N`, nunca criar `CLAUDE.md`, não tocar em `.github/workflows/`, nunca alterar migration publicada, sempre consultar a documentação oficial atual, nunca rodar `bootstrap destroy`), "Building a product on the Skeleton" e "Agent skills", sem nome de repo fixo.
- Skills em `.agents/skills`, com `.claude/skills/<x>` como symlink. Ficam as 18 do Matt da lista decidida, mais `playwright-cli` e `workers-best-practices` (fixadas no `skills-lock.json`) e as quatro `skeleton-*` (fora do lock). As outras skills do Matt saem.
- `.mcp.json` com `cloudflare-docs` e `shadcn`. `cloudflare-api` e `neon` read-only documentados como `claude mcp add --scope local`.
- `.claude/settings.json`: `permissions.deny` para `Edit`/`Write` nos caminhos protegidos e para o `destroy`, e hook `PreToolUse` do `git-guardrails`. Sem `allow`, sem `env`, sem subagents.
- `docs/agents/issue-tracker.md` sem repo fixo. `triage-labels.md` ganha a tabela "Factory labels".
- Doc do runner próprio para o humano.

### Últimos tickets

- Penúltimo: ADRs e docs em `docs/`, incluindo o ADR "vários Products num repo, Skeleton como pacote compartilhado", depois da base pronta e antes da primeira issue da Factory. O que tiver valor duradouro no `.scratch/` vira ADR ou doc, e o `.scratch/` é apagado.
- Último, escrito depois do teste de aceitação: o prompt de instalação no Forgejo. Ele leva só o harness (`.factory/`, workflows, `AGENTS.md`, skills, `.claude/settings.json`, imagem com `setup.sh`), implementa os adaptadores Forgejo de `Tracker` e `CodeHost`, monta o `Verify` com o que o repo de destino tiver (com implementação mínima onde faltar, dita no prompt), configura o runner do Forgejo (`--ephemeral`, `one-job`) e as labels, e termina com uma issue de teste de ponta a ponta. Ele substitui o doc de migração e incorpora as notas de [Portabilidade GitHub → Forgejo](../factory-harness/issues/14-forgejo-portability.md) e de [Segurança do CI do PR com código da Factory](../factory-harness/issues/19-pr-ci-security.md).

## Testing Decisions

Um bom teste entra pelo seam e confere só o comportamento externo: o que sai pela CLI, pela resposta HTTP, pela tela, pelo banco ou pelo estado do adaptador falso. Ele não confere chamadas internas nem a estrutura do código, e continua passando depois de uma refatoração que não muda o comportamento. Os testes usam dados próprios (usuário e email únicos por teste) em vez de limpar o banco entre testes.

Seams, combinados com o usuário:

1. **CLI da Factory com os quatro adaptadores falsos.** O teste chama `pnpm factory <comando>` (ou a função de entrada do comando) com `Tracker`, `CodeHost`, `Agent` e `Verify` falsos e confere labels, comentários, PRs, push e `result.json`. Cobre o guard (cada recusa), a trava, as 5 falhas, o timeout, `needs-human` com e sem commits, o gate de commits, a Review incremental, a Escalation "infra", "Run discarded" (estado mudou, branch andou), os caminhos protegidos e `harness-change`, a Triage e o `apply`, o `unblock` (varredura, comentário único), `update-branch` (limpo, conflito) e `pr-feedback` (filtros, Address/Decline/Defer). O adaptador Markdown local e o env por allowlist do `Agent` têm testes próprios no mesmo nível. Sem Claude, sem Docker e sem forja.
2. **Arquivos de configuração.** Testes leem os YAML dos workflows e o `config.ts`: `work` sem `FACTORY_TOKEN`; `work` e `build` só em `container:`; só `work` e `build` aceitam `vars.FACTORY_RUNNER`; tabelas de labels iguais ao `config.ts`; `deny` dos caminhos protegidos e do `destroy` presente.
3. **Worker do Product por HTTP.** `createTestHarness()` do wrangler + Postgres em container + MSW no `fetch` de saída para o Resend. O teste faz requests a `/api/me`, `/api/auth/*` e `/mcp` e confere status, corpo, linhas no banco e emails capturados. Cobre cadastro, verificação, login, reset, rate limit (429), os DOs, o outbox, `getMe` e um 4xx pelo MCP com o cliente do SDK (`read` não vê escrita, a identidade chega à rota, 4xx vira `isError`). `testUtils()` do Better Auth numa instância de auth só de teste. Fica no pacote Skeleton, contra uma composição só de teste, e roda uma vez.
4. **Telas no navegador.** Vitest Browser Mode com `vitest-browser-react` e os handlers MSW gerados pelo Kubb (`parser: 'faker'`, seed fixo). Fixture com `scope: 'file'`, `resetHandlers` por teste, `onUnhandledFrame: 'error'` e `msw({ mode: 'worker-only' })`. Cobre as telas de auth e a página inicial.
5. **E2E com Playwright na stack local.** Specs do Skeleton no pacote, rodados no `e2e` de cada Product. Fluxos de cadastro → verificação (pelo email capturado) → login → página inicial, reset de senha e o fluxo completo do MCP (login, consentimento, token, chamada de tool). A tag `@evidence` gera os prints num diretório fixo. Os elementos são localizados por role + chave do i18n ou `data-testid`.
6. **Artefatos gerados.** `pnpm generate` + `git diff` vazio; snapshot do `tools/list` por Product; descrições obrigatórias nas operações expostas; `drizzle-kit check` + migrate num banco vazio com `no_changes`; migration publicada intocada; `skills-check`; gate do Kubb + `tsc` + um teste com override de handler gerado.
7. **Ambiente publicado.** Smoke no preview (login real, outbox, 401 com `WWW-Authenticate` no `/mcp`) e na produção (login real, 401 no `/mcp`). Roda no CI, não no `verify`.
8. **Bootstrap com clientes falsos.** Cada etapa do wizard roda contra clientes falsos de GitHub, Cloudflare, Neon e Resend e confere o estado final: idempotência (segunda execução não cria nada), `--redo`, queda para secrets no repo quando a API recusa environment ou ruleset, prefixo `<ID>_`, PAT do mesmo login recusado, aviso de duas auths do Claude, `destroy` recusando sem TTY ou com `CI`, e a limpeza dos recursos de verificação mesmo quando a verificação falha. A conta real só aparece no `doctor`, na verificação final e nos critérios de aceite.

Prior art: o repo ainda não tem testes. As referências são o padrão do Sandcastle e dos workflows `agent-*` do Matt ([loop do Sandcastle](../factory-harness/research/15-sandcastle-loop-pattern.md)), as receitas de [testes de integração e E2E](../factory-harness/research/08-integration-and-e2e-testing.md) e [Kubb + MSW 3](../factory-harness/research/18-kubb-msw3.md), e o leadflow (`~/Bytewer/monorepo/site/leadflow`) para Better Auth num Worker.

**Critérios de aceite medidos na conta** (cada um entra no ticket da peça que ele exercita; o que for criado só para medir é apagado no fim):

- CPU por request do `/mcp` no Workers Free;
- "Initialize containers" com a imagem contra o `setup.sh` direto na VM (se o pull não for mais rápido, a escolha da imagem é reaberta);
- `actions/checkout` dentro do container com `USER 1001`;
- permissões do token da Cloudflare que criam um Worker Preview (workers-sdk#15797);
- visibilidade com que o pacote do GHCR nasce num repo público, e leitura com `packages: read`;
- resposta da API ao criar environment e ruleset num repo privado no Free;
- login real no smoke pós-deploy, sem `exceededCpu` no `PasswordHasher`;
- `work` e `build` num runner próprio efêmero com uid 1001;
- `new-product ci-probe` + `verify` numa cópia temporária.

## Out of Scope

- O PRD do Skeleton (trocar o nome, Companies, resto da conta, "Conexões", convites, apagar a conta): spec separada, publicada depois no GitHub como issue pai com sub-issues `ready-for-agent`. Esta spec só garante que a Factory esteja pronta para recebê-lo.
- O GitHub como tracker da base: os tickets da base ficam em `.scratch/factory-base/`. O GitHub só passa a ser usado quando a Factory receber o backlog do Skeleton.
- Reference App, MCP além do Skeleton, métricas de tempo e anexos no R2: repo privado.
- Strip, `strip-check`, `pnpm sync-upstream` e as regras que só existiam para eles.
- Merge automático: o Merge Gate é sempre humano.
- Adaptadores Forgejo no Template e endurecimento do CI no Forgejo: só o prompt do último ticket.
- Sandbox `docker()` com rede restrita para o agente.
- `pnpm factory local --all`, teto global de execuções simultâneas e custo acumulado por issue.
- No MCP: resources, prompts, agrupamento por tag e Code Mode.
- Motor alternativo ao Sandcastle e o workflow `claude-code-review.yml`.
- Troca de senha, troca de email, apagar a conta e qualquer coisa de Company na base.

## Further Notes

- Tracker desta spec: Markdown local, conforme `.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md`. Os tickets vão para `.scratch/factory-base/issues/NN-<slug>.md`, com `Status:` e `Blocked by:`. `docs/agents/issue-tracker.md` continua apontando para o GitHub.
- Ordem natural para o `to-tickets`, sem fixar a granularidade: o pacote `.factory/` com os seams e os falsos pode avançar em paralelo ao workspace e ao Skeleton. A fatia `GET /api/me` atravessa todas as camadas e vem antes da ponte do MCP, da imagem e do CI. O CI do PR vem antes dos workflows da Factory que dependem dele. O bootstrap vem depois do CI que ele liga. Os ADRs e docs vêm depois da base pronta, e o prompt do Forgejo vem depois do teste de aceitação.
- Toda escolha técnica é conferida na documentação oficial mais recente na hora de implementar, com versão e data registradas no ticket.
- Riscos conhecidos: Worker Previews em open beta; o orçamento de CPU do DO no Free medido, mas não documentado sem ambiguidade; o GHCR privado depende do "currently free"; o Kubb ainda declara `msw ^2` (kubb-labs/plugins#1049) e há a msw#2801; Sandcastle pré-1.0; taxa de runner próprio adiada, não cancelada; Resend Free com 3 domínios e 100 emails/dia somados entre Products.
- Idioma: código, harness, commits, PRs e `AGENTS.md` em inglês; spec e tickets da base em português.
