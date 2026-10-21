# 17: Blocked Issues e Triage

Spec: [../spec.md](../spec.md)

**What to build:** um humano marca várias issues de uma vez com dependências nativas, e a Factory começa cada Blocked Issue sozinha quando o último bloqueador é mergeado. Uma issue sem seams vai para a Triage, que dá o veredito e os seams e, num `easy-call`, a põe na fila sozinha.

**Blocked by:** 16

**Status:** ready-for-agent

- [x] `factory-unblock.yml` (`issues: closed` + `workflow_dispatch`) varre todas as issues `ready-for-agent` e despacha as destravadas; sem cron.
- [x] `factory-triage.yml` (label `agent:explore` posta por quem tem `write`+, em lote, concorrência global): `work` só leitura → `apply`. Veredito `easy-call | needs-a-human | blocked` com comentário marcado `<!-- factory:triage -->` (dificuldade, arquivos, claims verificados, perguntas, abordagem, door, seams com o que pegam e o que deixam passar); agrupa duplicadas.
- [x] `apply`: `easy-call` → `ready-for-agent` com o `FACTORY_TOKEN`; `needs-a-human` → `ready-for-human`; `blocked` → `needs-info`. Confere `product:<id>` e a acrescenta quando o caso é claro.
- [x] Triage local por `pnpm factory local NN`.
- [x] Testes pela CLI contra os falsos: varredura, comentário único, cada veredito (seam 1).
- [ ] Demonstração no repo com duas issues de teste encadeadas e uma em Triage, apagadas no fim junto com PRs, branches e previews.

## Comments

2026-10-20, implementer (Sonnet 5.5). Código e testes prontos; falta só a demonstração no repo real (precisava do machine user do ticket 16; substituído pelo 25: agora precisa do token do dono). Status continua `ready-for-agent`.

**O que foi feito**
- `pnpm factory unblock` (`commands/unblock.ts`): varre as `ready-for-agent`, roda o `guard` em cada e despacha `issue` (via `CodeHost.dispatch`) só as que o guard aceita (um bloqueador `done` não basta: sem critérios ou com label de quem não tem `write` o `claim` recusaria de qualquer forma). As ainda bloqueadas não recebem comentário. Um dispatch que falha não interrompe a varredura (exit 1 no fim). `factory-unblock.yml`: `issues: closed` + `workflow_dispatch`, sem cron, `vars.FACTORY_ENABLED`, token do job com `actions: write` e nenhum secret.
- `pnpm factory triage --out` (read-only) e `pnpm factory apply --in --repo` (`commands/triage.ts`, `triage-output.ts`). `triage` só lê issues cuja label `agent:explore` foi posta por `write`+ e roda UMA sessão para o lote (estágio novo `triage` no seam Agent; `timeouts.triage` = 30 min). `apply` reconfere a forja, posta o comentário único `<!-- factory:triage -->` (renderizado pelo harness a partir de campos validados: dificuldade, arquivos, claims, perguntas, abordagem, door, seams com o que pegam e o que deixam passar) ANTES de trocar a label (`ready-for-agent` dispara o `claim`, cujo guard procura o comentário), depois `easy-call` → `ready-for-agent`, `needs-a-human` → `ready-for-human`, `blocked` → `needs-info`. Duplicada (`duplicateOf`) nunca vai para a fila: `ready-for-human`, citando a original. `product:<id>` só entra se a issue não tem nenhuma e `apps/<id>` existe. `Tracker.addLabel` novo (fake, GitHub; no Markdown é no-op).
- `factory-triage.yml`: `image` → `work` (imagem, read-only, só auth do Claude, `FACTORY_RUNNER` permitido) → `apply` (VM nova, `FACTORY_TOKEN`), artifact `triage-out`; grupo global `factory-triage` sem cancel (um label durante uma rodada substitui a pendente, que varre tudo que ainda está em Triage).
- Triage local: `pnpm factory local NN` num ticket com Status `agent:explore` roda `triage` no container (`ContainerJob.command`) e o `apply` no host.
- Testes: `test/triage.test.ts`, `test/unblock.test.ts`, um caso em `test/local.test.ts`, e blocos novos em `test/ci-workflows.test.ts` (o `work` nunca recebe `FACTORY_TOKEN`, roda em `container:`, só ele toma `vars.FACTORY_RUNNER`, teste do `pnpm exec`).

**Fallback da extração (definido aqui; o ticket 07 do pr-bottleneck depende dele)**
Validador: todas as issues do lote têm veredito válido (Zod; `easy-call` exige pelo menos um seam). Sem bloco válido, a sessão é retomada (retomada de extração do seam Agent, máx. 2 vezes, dentro do timeout). Depois disso, ou em timeout, cada issue sem veredito válido recebe o veredito determinístico `needs-a-human` (`ready-for-human`, door `one-way`, comentário marcado dizendo "no valid verdict after 2 resumes" ou "timed out" e as últimas palavras da sessão, sem confiar nelas). Nada entra na fila por palpite. Vereditos válidos do mesmo bloco são mantidos; só as faltantes caem no fallback. Os tokens das retomadas entram em `triage.json` (`usage`, `retries`).

**Desvios**
- O `triage` de CI usa só `issues: read` e `canWrite` com o token do job (mesmo precedente do `claim`); `apply` repete a checagem com o `FACTORY_TOKEN`.
- O schema do veredito virou estruturado (o prompt anterior tinha só `seams: string[]` e `comment` livre) para o harness renderizar o comentário.

Pending (human): *(Substituído pelo 25: a Factory usa o token fine-grained do dono, sem machine user.)* Depois do ticket 16 (machine user + `pnpm bootstrap factory`) e do merge na `main`: (1) criar duas issues de teste com `## Acceptance criteria`, a 2ª bloqueada pela 1ª (dependência nativa), marcar ambas `ready-for-agent` com a conta com `write` e conferir o "Waiting on #1" na 2ª; mergear o PR da 1ª e conferir que o `factory-unblock.yml` despacha a 2ª sem ação manual; (2) criar uma 3ª issue sem spec pai, marcar `agent:explore`, conferir o `factory-triage.yml` (comentário `<!-- factory:triage -->`, label nova, `product:<id>` quando claro); (3) apagar as issues, PRs, branches `factory/issue-N` e previews no fim. Não rodar nada disso sem a conta real.


Merge (2026-10-21): na `factory-base`, combinado com o 18 (conflitos em `cli.ts`, `AGENTS.md` e nos testes dos workflows resolvidos mantendo os dois lados). O ticket mudou o script do container local para receber o comando como argumento sem atualizar o teste do ticket 10 (`local-docker.test.ts`): corrigido no merge. `verify` completo verde duas vezes. Falta a demonstração no repo.

- Review fixes 2 (2026-10-21): `apply` agora põe `product:<id>` ANTES de trocar para `ready-for-agent` (a troca dispara a run).
- Demo real 2 (2026-10-21): a issue #12, fechada pelo merge do PR, manteve o label `in-progress`. Correção: `pnpm factory unblock --issue N` (o `factory-unblock.yml` passa `github.event.issue.number` por variável de ambiente, só como dica) lê o estado no forge e, se a issue está fechada, remove `in-progress` pelo novo `Tracker.removeLabel` (fake, GitHub `DELETE .../labels/{name}` tolerando 404, Markdown no-op) antes da varredura. O job do unblock passou de `issues: read` para `issues: write`. Testes: `test/unblock.test.ts`, `test/github/tracker.test.ts`, `test/ci-workflows.test.ts`. Só vale depois do merge na `main` (evento `issues` roda o workflow da branch padrão).
