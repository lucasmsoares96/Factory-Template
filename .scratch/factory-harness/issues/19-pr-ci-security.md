# Segurança do CI do PR com código da Factory

Type: grilling
Status: resolved

## Question

O workflow de preview por PR (`pull_request`, branch do mesmo repo) executa código escrito pelo agente (`package.json` com `postinstall`, `drizzle.config.ts`, build, testes) num job que tem os tokens do Cloudflare e do Neon. Um `postinstall` malicioso, vindo de injeção de prompt na issue, vazaria esses secrets. Com o [Ambiente de preview por PR](05-pr-preview-environments.md) e a [Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md) já decididos, como separar o CI do PR para que código do branch nunca rode com secrets? Pontos a fechar:
- **Build sem secrets → deploy com código da `main`**: job de build/teste sem secrets que gera artefatos (bundle do Worker, migrations SQL); job de deploy que faz checkout da `main` e só aplica os artefatos (`wrangler preview`, `drizzle-kit migrate` ou SQL puro). As migrations SQL geradas pelo agente são código também: o que pode rodar contra o branch Neon do PR?
- **Escopo dos tokens**: token do Cloudflare restrito a Workers Previews? Token do Neon restrito ao projeto, ou API key só para branches?
- **Smoke pós-deploy**: o Playwright do smoke é código do PR; precisa de algum secret?
- **`workflow_run` × `pull_request_target`** como gatilho do job com secrets, e o que disso porta para o Forgejo (que ignora `permissions:`).
- **Aprovação**: PRs do machine user exigem algo antes do deploy do preview, ou o isolamento basta?

## Progresso do grilling (rodada 1)

Pesquisa: [research/19-pr-ci-security.md](../research/19-pr-ci-security.md).

- **Fechadas pelo usuário (aceitaram a recomendação):**
  - Q1: workflow único em `pull_request_target` (YAML sempre da `main`), com `build` sem secrets e sem cache → `deploy` em VM nova com checkout da `main`. `workflow_run` descartado (o Forgejo não tem).
  - Q4: o `deploy` usa só a config de preview da `main`; PR que muda bindings pula o preview e comenta.
  - Q5: o preview não fala com o Resend; o adaptador de email grava num outbox no banco, visível em rota só de preview.
  - Q7: a produção usa a mesma separação `build` sem secrets → `deploy`.
- **Q2 (projeto Neon separado para previews) e Q3 (Worker de preview separado)**: o usuário não está convencido de que a burocracia vale. Investigar o risco real, o que os repositórios de referência fazem e alternativas mais baratas.
- **Q6 (secrets no Forgejo)**: investigar a fundo e achar a solução, em vez de só registrar a lacuna.
- Pedido do usuário: para o preview da Cloudflare, ler a documentação oficial, as boas práticas e repositórios de exemplo.

## Progresso do grilling (rodada 1)

Pesquisa: [19-pr-ci-security](../research/19-pr-ci-security.md).

- **Fato decisivo**: no `pull_request`, o YAML vem do próprio branch (GitHub e Forgejo). No Forgejo v16, todo job que não vem de fork recebe todos os secrets do repo, referenciados ou não, e o `permissions:` é ignorado.
- **Gatilho e separação (aceito)**: um único workflow em `pull_request_target` (YAML sempre da `main`), com artifacts passados dentro da mesma execução. `build`: checkout do head, `persist-credentials: false`, `contents: read`, sem cache e sem secrets; gera bundle do Worker, assets e pasta de migrations. `deploy`: VM nova, checkout da `main`, aplica migrations com `migrate(db, { migrationsFolder })` (sem drizzle-kit nem `drizzle.config.ts` do PR) e roda `wrangler preview`. `workflow_run` descartado (não existe no Forgejo).
- **Bindings (aceito)**: o `deploy` usa só o config de preview da `main`. Se o PR mudou bindings, pula o preview e comenta no PR.
- **Email no preview (aceito)**: o preview não fala com o Resend. O adaptador de email grava num outbox no banco do branch, lido por uma rota que só existe no preview, pelo humano e pelo smoke. Resend real só na produção. Revê o smoke com `*.resend.app` de [Testes de integração e E2E](08-integration-and-e2e-testing.md).
- **Deploy da `main` (aceito)**: mesma divisão `build` sem secrets → `deploy` com os tokens, reaproveitando o mesmo código.
- **Em aberto**: projeto Neon separado para previews e Worker separado para previews. O usuário acha burocracia para um risco mínimo e pediu investigação melhor, incluindo docs oficiais, boas práticas e repositórios de exemplo de Worker Previews. Lacuna do Forgejo (todos os secrets em todo job): o usuário pediu investigação a fundo e uma solução, não só uma nota.

## Progresso do grilling (rodada 2)

Pesquisas: [práticas de preview da Cloudflare](../research/19-cloudflare-previews-practice.md), [isolamento do Neon](../research/19-neon-preview-isolation.md), [secrets no Forgejo](../research/19-forgejo-secrets-isolation.md).

- **Cloudflare (aceito)**: mesmo Worker e mesmo token para preview e produção, como a Cloudflare recomenda e como fazem os repositórios reais (o token por Worker nem funciona com os endpoints de Preview, workers-sdk#15797). Previews configurados pelo bloco `previews` do config da `main`, com KV e R2 próprios. Requisitos do job `deploy`: sempre `--config` da `main`; artifact extraído em `$RUNNER_TEMP`, fora do diretório de trabalho (o wrangler carrega `.env`/`.env.local` e segue `.wrangler/deploy/config.json`); `CLOUDFLARE_API_BASE_URL` fixado no env; dependências pelo lockfile da `main` com `--ignore-scripts`, nunca o `node_modules` do build; número do PR lido do evento; allowlist do artifact (bundle, assets, migrations). Risco aceito: cota de 100k requests/dia do Workers Free é por conta.
- **Quem ganha preview (aceito)**: automático para autor com `write`+ (inclui o machine user); os demais só com a label `preview` posta por alguém com `write`+, removida a cada push novo.
- **Neon**: o usuário pediu pesquisa de repositórios reais com preview Neon e como tratam segurança antes de decidir. Fato novo: no Free, CU-horas, egress e storage são por projeto, então um preview pode suspender a produção.
- **Forgejo**: a Factory no Forgejo será de repo privado com runner próprio; o usuário acha o desenho AGit + runners separados complexo demais e prefere registrar os pontos numa issue à parte. Pediu explicação do reusable workflow sugerido para o build.
- **Fora deste ticket, pedido do usuário**: rever o login com senha para rodar o hash num Durable Object (afeta [Trocas na stack](13-stack-swaps.md) e [Medir a CPU do login no leadflow](17-leadflow-login-cpu.md)).

## Progresso do grilling (rodada 3)

Pesquisas: [repositórios reais com preview Neon](../research/19-neon-preview-repos.md), [hash de senha num Durable Object](../research/20-durable-object-password-hash.md).

- **Banco do preview (aceito, C)**: projeto Neon separado `<app>-preview`, com um branch `base` (schema + seed, sem dados reais) migrado pelo deploy da `main`; os `preview/pr-N` saem dele. `NEON_PREVIEW_API_KEY` só alcança esse projeto; a produção tem a própria key, usada só pelo deploy da `main`. Motivos: é o que fazem os projetos sérios (Isomer, okou, Metaculus, Neo.Tax, Invenco), nenhum roda código não confiável contra dados de produção, e no Free as cotas são por projeto (um preview não derruba a produção). O usuário pediu exemplo em projetos do Matt Pocock.
- **Forgejo**: sem endurecimento agora (repo privado, runner próprio). O usuário quer reportar os problemas no repositório oficial do Forgejo.
- **Login (aceito, fora da pergunta original)**: o hash de senha sai do Worker e roda num Durable Object `PasswordHasher` (RPC `hash`/`verify`, pool de 8 a 16 nomes), plugado em `emailAndPassword.password.hash/verify` do Better Auth. Revê o login de [Trocas na stack](13-stack-swaps.md). Antes da spec, o ticket [Medir o hash de senha num Durable Object no Free](20-do-password-hash-cpu.md) confirma na conta que o DO passa dos 10 ms sem `exceededCpu`.
- **Rate limit**: o usuário pediu para confirmar se o binding de Rate Limiting existe no Free antes de decidir.
- **Matt Pocock** ([pesquisa](../research/19-pocock-preview-practice.md)): nenhum projeto público dele tem preview por PR com banco. No course-video-manager ele **desligou** os Preview Deployments da Vercel (ADR 0026) depois que um preview aplicou migration não revisada no banco de produção; o CI de PR roda sem secrets com Postgres em container, e o agente verifica a UI contra um snapshot local sem as tabelas de credenciais. Os workflows `agent-*` dele rodam o head do PR com token de escrita no env (contradiz o próprio spec); o melhor padrão é o `agent-explore.yml` do Sandcastle (agente só leitura → job separado aplica com o PAT), que é o mesmo `work` → `publish` do ticket 16. Reforça a opção C e a separação `build` → `deploy`.
- **Rate limit**: o binding de Rate Limiting não tem plano documentado, aceita deploy no Free, mas hoje não bloqueia nada no ar (workers-sdk#16097, aberta em 2026-10-06, sem resposta da Cloudflare) e é por datacenter e eventualmente consistente. Recomendação mantida: DO `RateLimiter`.

## Answer

Princípio: **todo código de branch é não confiável até o Merge Gate**. Ele nunca roda com credencial que alcance recursos ou dados de produção. O Worker de preview roda o código do PR com secrets que só valem no preview, e vazar esses secrets não expõe nada além do próprio preview.

**Workflow do preview**: um único `pull_request_target`, então o YAML vem sempre da `main` (no `pull_request`, o YAML vem do branch). Os artifacts passam dentro da mesma execução (o Forgejo não tem `workflow_run`).
- `build`: checkout do head do PR, `persist-credentials: false`, `permissions: contents: read`, sem cache e sem nenhum secret. Roda install, build e testes; sobe o bundle do Worker, os assets e a pasta de migrations.
- `deploy`: VM nova, checkout da `main`. Aplica as migrations com `migrate(db, { migrationsFolder })` (código da `main`, sem drizzle-kit e sem `drizzle.config.ts` do PR) e roda `wrangler preview --name pr-N`. Regras de blindagem, porque o wrangler lê arquivos do diretório onde roda:
  - sempre `--config` da `main` (um config do PR rodaria `build.command` com o token);
  - artifact extraído em `$RUNNER_TEMP`, fora do diretório de trabalho (o wrangler carrega `.env`/`.env.local` e segue `.wrangler/deploy/config.json`);
  - `CLOUDFLARE_API_BASE_URL` fixado no env do step;
  - dependências pelo lockfile da `main` com `--ignore-scripts`, nunca o `node_modules` do build;
  - número do PR lido do evento, nunca do artifact;
  - allowlist do artifact: só bundle, assets e migrations.
- `smoke`: Playwright do PR, sem secrets, contra a URL do preview.
- Sem reusable workflow: no GitHub, um job que não cita `secrets.X` já roda sem ele.

**Quem ganha preview**: automático para autor com `write`+ (inclui o machine user). Os demais só com a label `preview` posta por alguém com `write`+, removida a cada push novo.

**Cloudflare**: mesmo Worker e mesmo token para preview e produção, como a Cloudflare recomenda e como fazem os repositórios reais. Token restrito a um Worker nem funciona com os endpoints de Preview (workers-sdk#15797). Os bindings do preview vêm só do bloco `previews` do config da `main`, com KV e R2 próprios. Se o PR mudou bindings, o preview é pulado e o CI comenta no PR. Risco aceito: a cota de 100k requests/dia do Workers Free é por conta.

**Neon**: projeto separado `<app>-preview`, com um branch `base` (schema + seed, sem dados reais) migrado pelo deploy da `main`; cada `preview/pr-N` sai dele (cerca de 9 simultâneos). `NEON_PREVIEW_API_KEY` só alcança esse projeto; a key da produção fica só no deploy da `main`. Motivos: um branch da produção copia dados, sessões e a senha da role (que abre o endpoint da produção), e o `dblink` permite exfiltrar; no Free, CU-horas, egress e storage são por projeto, então um preview no mesmo projeto pode suspender a produção. É o que fazem os projetos sérios (Isomer, okou, Metaculus, Neo.Tax, Invenco); o Matt Pocock desligou os previews do course-video-manager depois que um aplicou migration no banco de produção.

**Email**: o preview não fala com o Resend. O adaptador de email grava num outbox no banco do branch, lido por uma rota que só existe no preview, pelo humano e pelo smoke. O Resend real só roda na produção (smoke pós-deploy da produção, código da `main`). Revê o smoke com `*.resend.app` de [Testes de integração e E2E](08-integration-and-e2e-testing.md).

**Deploy da `main`**: mesma divisão, `build` sem secrets → `deploy` com os tokens, mesmo código.

**Login (revisão de [Trocas na stack](13-stack-swaps.md))**: email e senha continuam, mas o scrypt sai do Worker (10 ms de CPU no Free) e roda num Durable Object `PasswordHasher` sem estado (RPC `hash`/`verify`, pool de 8 a 16 nomes por `getByName`, um retry em `.retryable`), plugado em `emailAndPassword.password.hash/verify` do Better Auth 1.7. Os hashes atuais continuam válidos. Rate limit num DO `RateLimiter` (`customStorage.consume`, SQLite do DO), com `rateLimit.enabled: true` e `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` (sem isso fica desligado no Workers). O binding de Rate Limiting não serve: hoje não bloqueia nada no ar (workers-sdk#16097) e é por datacenter. A doc de limites de DO se contradiz sobre CPU no Free; [Medir o hash de senha num Durable Object no Free](20-do-password-hash-cpu.md) confirma na conta antes da spec.

**Forgejo**: sem endurecimento agora (a Factory no Forgejo será de repo privado com runner próprio). Três pontos vão para o doc de migração: o token automático do `build` tem escrita no repo inteiro (`permissions:` ignorado); o `pull_request_target` usa o YAML da branch base, que pode ser qualquer uma; não existe equivalente ao escopo `workflow` do PAT. Os defeitos achados viram relatos ao Forgejo, escritos pelo usuário ([rascunhos](../forgejo-reports.md)), fora do caminho deste mapa.

Pesquisas: [CI do PR](../research/19-pr-ci-security.md), [previews da Cloudflare](../research/19-cloudflare-previews-practice.md), [isolamento do Neon](../research/19-neon-preview-isolation.md), [repositórios com preview Neon](../research/19-neon-preview-repos.md), [Matt Pocock](../research/19-pocock-preview-practice.md), [secrets no Forgejo](../research/19-forgejo-secrets-isolation.md), [hash num Durable Object](../research/20-durable-object-password-hash.md).
