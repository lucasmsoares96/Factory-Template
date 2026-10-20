# 17: Blocked Issues e Triage

Spec: [../spec.md](../spec.md)

**What to build:** um humano marca várias issues de uma vez com dependências nativas, e a Factory começa cada Blocked Issue sozinha quando o último bloqueador é mergeado. Uma issue sem seams vai para a Triage, que dá o veredito e os seams e, num `easy-call`, a põe na fila sozinha.

**Blocked by:** 16

**Status:** ready-for-agent

- [ ] `factory-unblock.yml` (`issues: closed` + `workflow_dispatch`) varre todas as issues `ready-for-agent` e despacha as destravadas; sem cron.
- [ ] `factory-triage.yml` (label `agent:explore` posta por quem tem `write`+, em lote, concorrência global): `work` só leitura → `apply`. Veredito `easy-call | needs-a-human | blocked` com comentário marcado `<!-- factory:triage -->` (dificuldade, arquivos, claims verificados, perguntas, abordagem, door, seams com o que pegam e o que deixam passar); agrupa duplicadas.
- [ ] `apply`: `easy-call` → `ready-for-agent` com o `FACTORY_TOKEN`; `needs-a-human` → `ready-for-human`; `blocked` → `needs-info`. Confere `product:<id>` e a acrescenta quando o caso é claro.
- [ ] Triage local por `pnpm factory local NN`.
- [ ] Testes pela CLI contra os falsos: varredura, comentário único, cada veredito (seam 1).
- [ ] Demonstração no repo com duas issues de teste encadeadas e uma em Triage, apagadas no fim junto com PRs, branches e previews.
