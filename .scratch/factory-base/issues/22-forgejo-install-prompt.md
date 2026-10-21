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

## Notas

- **Token no Forgejo (do ticket 25).** A Factory escreve com o token do dono e se reconhece por um marcador oculto, não pelo autor; o Forgejo também não tem GitHub App. A v15 (LTS até 2027-07-15) tem tokens restritos a repos específicos, só com `read/write:repository` e `read/write:issue`.
- **No Forgejo não existe escopo `workflow`.** Um token com `write:repository` consegue alterar `.forgejo/workflows/`. Lá, a única defesa é a recusa de caminhos protegidos antes do `publish` (Escalation `protected-paths`), e o token nunca vai para o job `work`. O prompt de instalação deve dizer isso.
- O aviso do Merge Gate sai pelo token automático do job (`GITHUB_TOKEN` no GitHub; o equivalente no Forgejo), porque ninguém é notificado das ações da própria Factory.
