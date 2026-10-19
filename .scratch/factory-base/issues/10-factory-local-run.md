# 10: Execução local da Factory

Spec: [../spec.md](../spec.md)

**What to build:** o usuário escreve uma issue em Markdown local, roda `pnpm factory local NN` e vê a Factory de verdade (Claude, Sandcastle, `factory:verify`) resolver a issue num container descartável, deixando um branch local e a review, a evidência e o resultado nos comentários do arquivo. É a primeira vez que o loop roda com os adaptadores reais, antes de qualquer forja.

**Blocked by:** 08, 02

**Status:** ready-for-agent

- [ ] `Tracker` Markdown local (`Status:` = label, `Blocked by:`, `## Comments`; desbloqueada quando todas estão `done`) e `CodeHost` local (branch local, review e Escalation no `## Comments`, prints numa pasta de evidência), com testes próprios (seam 1).
- [ ] `Agent` real: Sandcastle fixado com `noSandbox()` num processo filho, env por allowlist (`PATH`, `HOME`, auth do Claude, `DATABASE_URL`, `CI`), com teste que prova que nada mais vaza.
- [ ] `Verify` real chamando `pnpm factory:verify`.
- [ ] Prompts em `.factory/prompts/` (`development`, `review`, `triage`, `pr-feedback`, `update-branch`), em inglês, chamando as skills pelo nome e repetindo as regras duras.
- [ ] Imagem `ubuntu:24.04` + `setup.sh` (Node pelo `.node-version`, pnpm via corepack, Claude Code do `config.ts`, `git`, Chromium do Playwright), `useradd -u 1001`, `USER 1001`, sem `docker` CLI; tag pelo hash das versões; `factory local` tenta `docker pull` e só constrói se faltar.
- [ ] Container do agente com o repo por `git clone` (nunca bind-mount), só a auth do Claude, Postgres num container irmão em rede privada, sem o socket do Docker; o `publish` roda no host.
- [ ] `stream-json` de cada sessão guardado junto da evidência.
- [ ] Demonstração: uma issue de teste em Markdown sobre o `example` chega a `ready` localmente; a issue, o branch e a evidência de teste são apagados no fim.
