# 21: Base pronta: ADRs, docs e limpeza do `.scratch/`

Spec: [../spec.md](../spec.md)

**What to build:** a base é declarada pronta e o repo fica no estado em que a Factory vai recebê-lo: as decisões duradouras do mapa viram ADRs e docs em `docs/`, e o `.scratch/` some. Depois deste ticket, a primeira issue do backlog do Skeleton pode ir para o GitHub.

**Blocked by:** 17, 18, 19, 20

**Status:** ready-for-agent

- [ ] Conferência da base pronta: `doctor` verde na parte comum e nos módulos Produção, Previews e Factory; deploy de teste e PR de teste com preview e smoke; `ci-probe` verde; todos os critérios de aceite medidos e registrados nos tickets.
- [ ] Nenhum recurso de teste sobrando nas contas (PRs, branches, Worker Previews, branches Neon, issues, Products descartáveis).
- [x] ADRs em `docs/adr/` para as decisões difíceis de reverter, incluindo "vários Products num repo, Skeleton como pacote compartilhado"; docs em `docs/` para o que tiver valor duradouro (fatos medidos, riscos, notas do Forgejo).
- [x] `GLOSSARY.md` revisado contra o que foi construído.
- [ ] `.scratch/` apagado.

## Comments

2026-10-21 (implementer, critérios 3 e 4; 1, 2 e 5 ficam com o orquestrador).

- ADRs novos (0001 e 0002 já existiam): 0003 vários Products num repo, Skeleton como pacote; 0004 Sandcastle como motor, `claude-code-action` fora; 0005 `claim`/`work`/`publish`; 0006 `pull_request_target` com workflow e código da `main`; 0007 Workers Free + Neon + Durable Objects (hash e rate limit); 0008 issue de Product nunca muda o Skeleton ("The Skeleton must grow"); 0009 uma conta padrão por Product, senha como secret de deploy; 0010 o wizard nunca pergunta duas vezes e mantém os logins; 0011 TypeScript 7 + oxlint. Os fatos essenciais estão dentro de cada ADR, sem link para `.scratch/`.
- Docs: `docs/README.md` (índice, linkado do `AGENTS.md`), `docs/measured-facts.md` (CPU, rate limit, previews, Actions/GHCR, tetos do Free), `docs/known-risks.md` (10 ms de CPU x p50 21 ms, `/mcp` não separável, falsos positivos do check de testes pulados, tokens clássico x fine-grained, o que nunca foi demonstrado ao vivo), `docs/forgejo.md` (AGit, sem escopo `workflow`, token restrito a repo desde v15, `pull_request_target` com a branch base).
- `GLOSSARY.md`: Product, Skeleton, Triage (vereditos), Merge Gate (aviso), Escalation (motivos), Blocked Issue ajustados; novos Evidence, Preview, Factory marker, Skeleton gap, Default account, Harness change. Não havia termo morto nem "machine user" no arquivo.
- Incerto: "Evidence" e "Harness change" são termos que o código já usa mas a spec não nomeava como domínio; o orquestrador pode tirá-los. A cobertura dos tickets 01-13 foi lida só pelos relatórios AFK e pela spec.

Conferência das contas (2026-10-21, orquestrador, depois das demonstrações):
- **GitHub:** nenhum PR ou issue aberto. Os branches remotos são só `main` e `factory-base`, porque os branches dos PRs já mesclados foram apagados.
- **Cloudflare:** os Workers são `example` e os dos outros projetos do dono (`elara_booking`, `leadflow`, `meetspot`). Nenhum Worker Preview de PR responde (`pr-15`, `pr-17`, `pr-20`, `pr-30`, `pr-32` dão 404). Os KV são `example-oauth-kv`, `example-preview-oauth` e o `AUTH_KV` de outro projeto.
- **Neon:** os projetos são `example`, `example-preview` (só o branch `base`) e o `elara` de outro projeto.
- **Local:** só o worktree `integration`, e nenhuma pasta `factory-*` em `/private/tmp`.
- **Products descartáveis:** nenhum foi criado, porque a demonstração do `destroy` (ticket 19) ainda depende do dono.
