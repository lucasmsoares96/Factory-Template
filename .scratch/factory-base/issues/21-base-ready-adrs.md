# 21: Base pronta: ADRs, docs e limpeza do `.scratch/`

Spec: [../spec.md](../spec.md)

**What to build:** a base é declarada pronta e o repo fica no estado em que a Factory vai recebê-lo: as decisões duradouras do mapa viram ADRs e docs em `docs/`, e o `.scratch/` some. Depois deste ticket, a primeira issue do backlog do Skeleton pode ir para o GitHub.

**Blocked by:** 17, 18, 19, 20

**Status:** ready-for-agent

- [ ] Conferência da base pronta: `doctor` verde na parte comum e nos módulos Produção, Previews e Factory; deploy de teste e PR de teste com preview e smoke; `ci-probe` verde; todos os critérios de aceite medidos e registrados nos tickets.
- [ ] Nenhum recurso de teste sobrando nas contas (PRs, branches, Worker Previews, branches Neon, issues, Products descartáveis).
- [ ] ADRs em `docs/adr/` para as decisões difíceis de reverter, incluindo "vários Products num repo, Skeleton como pacote compartilhado"; docs em `docs/` para o que tiver valor duradouro (fatos medidos, riscos, notas do Forgejo).
- [ ] `GLOSSARY.md` revisado contra o que foi construído.
- [ ] `.scratch/` apagado.
