# 22: Prompt de instalação da Factory no Forgejo

Spec: [../spec.md](../spec.md)

**What to build:** um arquivo com um prompt único que um agente executa num repo que já existe, no Forgejo e com outra stack, e que instala ali o mesmo fluxo da Factory, terminando com uma issue de teste resolvida de ponta a ponta. Ele substitui o doc de migração.

**Blocked by:** 21 e o teste de aceitação (o backlog do Skeleton concluído pela Factory no GitHub, fora deste tracker)

**Status:** ready-for-human

- [ ] Escrito só depois de a Factory passar no teste de aceitação, incorporando o que ele ensinou.
- [ ] Leva só o harness: `.factory/`, workflows, `AGENTS.md`, skills, `.claude/settings.json` e a imagem com `setup.sh`; deixa de fora o Skeleton e o bootstrap dos Products.
- [ ] Implementa os adaptadores Forgejo de `Tracker` e `CodeHost` (REST direto, assets para prints, `WIP:` como draft, `done` = `closed`).
- [ ] Monta o `Verify` com o que o repo de destino tiver (typecheck, lint, teste, E2E, preview, prints) e diz onde ficou uma implementação mínima.
- [ ] Configura o runner próprio do Forgejo (`--ephemeral`, `one-job`) e as labels.
- [ ] Incorpora as notas de [Portabilidade GitHub → Forgejo](../../factory-harness/issues/14-forgejo-portability.md) e de [Segurança do CI do PR com código da Factory](../../factory-harness/issues/19-pr-ci-security.md) (token automático com escrita, `pull_request_target` com YAML da branch base, sem escopo `workflow`, registry da instância).
- [ ] Termina com uma issue de teste de ponta a ponta no repo de destino.
