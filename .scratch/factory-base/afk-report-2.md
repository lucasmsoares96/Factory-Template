# Relatório da segunda execução sem você (2026-10-20 → 21)

Tudo está na `factory-base` e no [PR #9](https://github.com/lucasmsoares96/Factory-Template/pull/9), que espera o seu merge. Nada foi mesclado na `main` sem você.

## O que ficou pronto

| Ticket | Entrega | Status |
|---|---|---|
| 14 | Medições em produção: rate limit, CPU dos Durable Objects e do Worker | `ready-for-agent`: falta a medição no repo privado |
| 15 | Previews: o bug que impedia qualquer preview de subir foi corrigido | `ready-for-agent`: falta um preview subir de verdade |
| 16 | A Factory no Actions: adaptadores do GitHub, `factory-issue.yml`, `pnpm bootstrap factory` | código pronto, falta o usuário de máquina |
| 17 | Blocked Issues e Triage: `factory-unblock.yml`, `factory-triage.yml`, `apply` | código pronto, falta a demonstração |
| 18 | Comentários no PR e atualização de branch: `factory-pr-feedback.yml`, `factory-update-branches.yml` | código pronto, falta a demonstração |
| 19 | `pnpm bootstrap destroy` | código pronto, testado só com falsos |
| 20 | Doc do runner próprio (`docs/self-hosted-runner.md`) | doc pronto, falta a VM |
| 23 | Testes estáveis sob carga e sem lixo em `/tmp` | `done` |
| pr-bottleneck 06 | Prints de evidência no corpo do PR | código pronto, falta a demonstração |
| pr-bottleneck 07 | Retomada de extração na Triage | `done` |

Verificação: `TURBO_FORCE=1 pnpm factory:verify` verde na `factory-base` (13/13 tarefas, 727 testes do harness). Antes da revisão, verde duas vezes seguidas com carga 85–96.

## O que a execução encontrou e corrigiu

- **Nenhum preview tinha subido.** O plugin Vite da Cloudflare escreve listas vazias no config, e cada uma contava como um binding novo. O PR de teste #10 ficou verde, mas o comentário dizia "preview skipped". Corrigido. Os previews passam a funcionar a partir do primeiro PR depois do merge do #9.
- **Revisão de código** (eixos Standards e Spec). Corrigi 12 achados, cada um com teste. Os mais graves:
  - o corpo do PR deixava passar `closes #9 and #10` no meio do texto, o que fecharia outras issues no merge;
  - `git` e `gh` herdavam todos os secrets do job;
  - faltava `queue: max`, então um terceiro comentário durante uma rodada viraria Escalation "infra";
  - o filtro de comentários do PR só olhava o último autor da thread;
  - com o usuário de máquina vazio, a Factory leria as próprias respostas em loop;
  - o `destroy` aceitava `CI=` vazio e podia abrir login antes da confirmação.
- **Problemas de juntar tickets.** O ticket 17 mudou o script do container sem atualizar um teste do 10. Os tickets 17 e 18 deram conflito em `cli.ts`, `AGENTS.md` e nos testes dos workflows; resolvi mantendo os dois lados.
- **Vazamento de pasta temporária.** A checagem nova do ticket 23 pegou um teste do ticket 16 que deixava pasta para trás. Apaguei 186 pastas antigas de `/tmp`.
- **O CI do PR #9 ficou vermelho na checagem do ticket 23**, que passava aqui. Os motivos só aparecem no Actions:
  - o vitest filho imprimia cores e anotações do GitHub, e o resumo "1 failed | 1 passed" não batia;
  - o Node cria a própria `node-compile-cache` no TMPDIR, e a checagem a contava como sobra.
  
  Corrigido: o filho roda com `NO_COLOR` e `--reporter=default`, e a pasta do Node é ignorada. Testei com `FORCE_COLOR=1 GITHUB_ACTIONS=true`; os 727 testes do harness passam.

## Decisão para você revisar

- **pr-bottleneck 05 marcado `done`** sem a retomada de extração com Claude real. O Claude entregou o bloco na primeira resposta, e não há como forçar o contrário. A retomada está provada pelo teste do adaptador com um `claude` falso. Se você preferir esperar um run real, volte o Status para `ready-for-agent`.

## Medido em produção (`https://example.bytewer.workers.dev`)

- **Rate limit do login.** 5 tentativas num email inexistente deram 401, 401, 401, 429, 429. Depois de 11 s voltou a 401: são 3 tentativas por 10 s por IP, atrás da Cloudflare. Nenhuma conta foi criada nem bloqueada.
- **`PasswordHasher`.** Cerca de 112 ms de CPU por hash, no orçamento do Durable Object. O login funciona, sem `exceededCpu`.
- **`RateLimiter`.** Cerca de 0,7 ms por chamada.
- **Worker, todas as rotas.** CPU p50 21 ms, p90 76 ms e p99 116 ms, com 0 erros. Já fica acima dos 10 ms por request do Workers Free na mediana. Vale observar quando houver tráfego.
- **Não dá para medir.** O CPU só do `/mcp` não aparece separado, porque a analytics da Cloudflare não agrupa por caminho.

## O que depende de você, em ordem

1. **Mesclar o PR #9**, depois que o CI dele ficar verde.
2. **Abrir qualquer PR que mexa no `example`** para ver o primeiro preview de verdade: preview `pr-N`, smoke e comentário com a URL. Ao fechar o PR, a limpeza apaga o preview e o branch Neon. Isso fecha o ticket 15. Eu acompanho e meço as permissões da Cloudflare se você me avisar.
3. **Criar o usuário de máquina da Factory.** É uma conta separada no GitHub, com um PAT clássico só com `repo`, sem `workflow`. Depois rode `pnpm bootstrap factory`: ele pede o PAT uma vez, aceita o convite de colaborador, não pede a auth do Claude de novo e liga o `FACTORY_ENABLED`. Isso destrava as demonstrações dos tickets 16, 17, 18 e pr-bottleneck 06, que eu consigo conduzir.
4. **Opcional:** rodar `! gh auth refresh -h github.com -s delete_repo` para eu medir a resposta da API num repo privado (ticket 14).
5. **Opcional:** a demonstração do `destroy` com um Product descartável (ticket 19) e o runner numa VM (ticket 20).

## Depois disso

- **Ticket 21:** ADRs e docs da base pronta. Faz sentido com 15, 16, 17 e 18 demonstrados. É a última etapa antes de a Factory receber o backlog do Skeleton.
- **Ticket 22:** o prompt de instalação no Forgejo. Vem depois do teste de aceitação.
- **Melhorias apontadas pela revisão** (julgamento, não bugs):
  - **duplicação:** o cliente REST do GitHub aparece duas vezes, e há dois `runGh`;
  - **tipos:** strings no lugar de tipos (`method`, `dispatch`, `ReviewThread.id`);
  - **documentação:** bullets longos demais no `.factory/AGENTS.md`.
