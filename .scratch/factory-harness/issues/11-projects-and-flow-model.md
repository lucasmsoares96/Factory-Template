# Modelo de projetos, Tarefas e fluxo

Type: grilling
Status: resolved

## Question

Como se modelam Project, Ticket, Sprint, colunas e o histórico de movimentações? Pontos a fechar: Project pertence a um Team ou à Company; o modo Kanban/Scrum é fixo por Project ou alternável; colunas fixas ou configuráveis por Project; ciclo de vida de Sprint (planejada, ativa, encerrada; Tickets não concluídos ao encerrar); dependência entre Tickets (só no mesmo Project? ciclos proibidos? bloqueia mover para "feito"?); responsável pelo Ticket; o registro de cada movimentação (quando, coluna de origem, coluna de destino, quem moveu) e quais métricas derivar (tempo por coluna, por responsável); a visão de Tarefas (de quem? de todos os Projects?) em lista ou board.

Herdado de [Modelo de organização da Reference App](10-organization-model.md): as roles são da Company (Owner, Manager, Employee) e o Team nunca concede permissão. Falta fechar aqui: o que cada role pode fazer com Projects, Sprints e Tickets (o Manager ganha poderes além de convidar e remover Employees?); o que acontece com os Projects de um Team apagado; Tickets de quem saiu da Company ficam sem responsável e o histórico mostra "ex-membro".

## Answer

**Nome**: o item de trabalho se chama **Tarefa** na UI e `Task` no código. "Ticket" deixa de ser usado.

**Project**
- Pertence à Company e se liga a 0..N Teams. Um Team também se liga a 0..N Projects.
- Segue um **Pipeline**, escolhido na criação. Esse Pipeline não pode ser trocado depois.
- Tem uma sigla, também definida na criação, que forma o identificador das Tarefas (`WEB-42`).
- Não tem "modo". Kanban e Scrum são apenas filtros.
- É apagado de vez, com confirmação pelo nome e em cascata, incluindo os anexos. Não existe arquivamento.
- A página do Project tem configurações, Backlog e Sprints. Ela não tem board próprio: o board é a tela de Tarefas filtrada por aquele Project.

**Visibilidade e Teams** (revê o [Modelo de organização da Reference App](10-organization-model.md): o Team passa a dar acesso)
- O Owner vê todos os Projects. Manager e Employee veem apenas os Projects ligados aos seus Teams.
- Um Project sem Team fica visível só para o Owner. Um Member que não está em nenhum Team não vê nenhum Project.
- Se alguém perde acesso a um Project, as Tarefas em andamento dessa pessoa ficam sem responsável e o histórico é mantido. O MCP segue a mesma regra.
- Um Team com Members não pode ser apagado: antes é preciso tirar os Members dele. Os Projects do Team continuam existindo e só perdem o vínculo.

**Manager** (revê o [Modelo de organização da Reference App](10-organization-model.md))
- Continua sendo uma role da Company, mas só age nos Teams de que faz parte.
- Sai no Strip. No Skeleton ficam apenas Owner e Employee, e só o Owner convida e remove pessoas. **Revisto em [Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md):** o Manager fica no Skeleton, com os direitos de um Employee; no Skeleton só o Owner convida e remove.

| Ação | Owner | Manager | Employee |
|---|---|---|---|
| Ver Projects | todos | dos seus Teams | dos seus Teams |
| Criar Project (ligado a um Team seu) | ✅ | ✅ | ❌ |
| Editar ou apagar Project, ligar Teams, sobrescrever configurações de Sprint | ✅ | só os ligados apenas aos seus Teams | ❌ |
| Criar, editar ou apagar Pipelines | ✅ | ❌ | ❌ |
| Configurações da Company | ✅ | ❌ | ❌ |
| Criar ou apagar Teams | ✅ | ❌ | ❌ |
| Pôr ou tirar Employees dos seus Teams | ✅ | ✅ | ❌ |
| Convidar para a Company | ✅ | só Employee, já dentro de um Team seu | ❌ |
| Remover da Company | ✅ | ❌ | ❌ |
| Sprints, Tarefas, dependências, comentários, anexos | ✅ | ✅ | ✅ |
| Apagar Tarefa | ✅ | ✅ | só as que criou |
| Repassar Tarefa | ✅ | ✅ | se for o responsável |
| Escopo Empresa / Team / Pessoa | ✅ / todos / qualquer um | ❌ / os seus / Members dos seus Teams | ❌ / os seus / só a si mesmo |

Tudo vale só nos Projects que a pessoa vê.

**Pipeline e colunas**
- Os Pipelines são definidos na Company, numa aba própria, e só o Owner os edita.
- Toda Company nasce com o Pipeline "Padrão": A fazer → Implementando → Implementado → Testando → Testado → Revisando → Feito.
- Um Pipeline em uso por algum Project não pode ser apagado.
- Cada coluna tem um de quatro tipos: **entrada** (sempre a primeira), **fila**, **em andamento** (o Pipeline precisa ter pelo menos uma) e **concluído** (sempre a última).
- Para apagar uma coluna, é preciso escolher para onde vão as Tarefas dela, em todos os Projects que usam o Pipeline.
- Os registros de tempo guardam uma cópia do nome da coluna. Mudar o tipo de uma coluna não reescreve o passado.

**Tarefa**
- Campos: título e descrição em Markdown; criador; coluna e posição na coluna; Sprint atual, mais as anteriores; dependências; estimativa em horas; comentários, anexos e links de PR; datas `criada em`, `iniciada em` e `concluída em`.
- Responsável: um por vez. Quem move a Tarefa para uma coluna em andamento passa a ser o responsável, e ela fica sem responsável quando sai dessa coluna. O responsável (ou Owner/Manager) pode repassá-la no meio do trabalho, sempre para alguém que vê o Project, e o tempo se divide entre os dois.
- "Começar" uma Tarefa significa tirá-la da coluna de entrada.
- Dependências: só entre Tarefas do mesmo Project, e ciclos são rejeitados. Uma Tarefa só começa depois que as Tarefas de que ela depende estiverem concluídas. Reabrir uma delas não afeta uma Tarefa dependente que já foi concluída.
- Comentários em Markdown. O autor edita e apaga os seus, e o Owner apaga qualquer um. Sem menções nem notificações.
- Anexos no R2: até 10 MB, qualquer tipo, com miniatura para imagens. Apagar a Tarefa apaga os anexos.
- O PR entra só como link, sem integração com a forja.

**Registro de tempo** (Time Entry)
- Cada linha guarda: Tarefa, coluna (id e nome copiado), responsável (vazio quando a coluna é de fila), Sprint, início e fim.
- Uma linha abre quando a Tarefa entra numa coluna em andamento ou de fila e fecha quando ela sai. A linha é dividida se mudar o responsável ou a Sprint.
- O tempo na coluna de entrada é calculado como `criada em` → `iniciada em`.
- Não se grava quem moveu a Tarefa; não há trilha de auditoria.
- Métricas: tempo por coluna, somando as voltas, com mediana por Project em um período; tempo por responsável em cada coluna; tempo nas filas, para achar gargalos; cycle time, de `iniciada em` até `concluída em`.

**Sprint**
- Estados: pendente → ativa → encerrada. No máximo uma Sprint ativa por Project. Uma Sprint encerrada fica só para leitura.
- Encerramento manual ou automático, e destino das Tarefas não terminadas (próxima Sprint ou Backlog): a Company define o padrão e o Project pode sobrescrever.
- No encerramento automático: a Sprint encerra no fim do dia de término, no fuso da Company; a próxima Sprint pendente é ativada; se não houver Sprint pendente e sobrarem Tarefas não terminadas, uma nova Sprint é criada com a mesma duração.
- No encerramento manual, quem encerra escolhe o destino das Tarefas não terminadas, e a configuração do Project já vem selecionada.
- Uma Tarefa fica em uma Sprint por vez, mas guarda as Sprints anteriores. O tempo gasto fica na Sprint em que foi gasto.
- O Backlog do Project mostra as Tarefas que não estão em nenhuma Sprint e as Sprints pendentes, e dá para arrastar Tarefas entre eles.

**Tela de Tarefas**
- Uma única tela, em Kanban ou lista. Filtros: **escopo** (Empresa, Team ou Pessoa); **Project**; **Kanban ou Scrum** (no Scrum aparece só a Sprint ativa, e o board avisa quais Projects não têm Sprint ativa).
- **Pessoa**: as Tarefas em andamento dessa pessoa, as que estão em entrada ou fila nos Projects que ela vê e as concluídas que algum dia foram dela. Ficam ocultas as Tarefas em andamento com outra pessoa.
- **Team** e **Empresa**: todas as Tarefas, incluindo as concluídas.
- As Tarefas concluídas aparecem por N dias, configuração da Company com padrão de 14.
- No Kanban, cada Pipeline vira um board, um embaixo do outro, ordenados pelo nome. Um Pipeline sem Tarefas nos filtros atuais fica oculto. O filtro de Project deixa só o Pipeline daquele Project. Cada cartão mostra a sigla do Project.
- A lista é agrupada por Pipeline e, dentro dele, por coluna.

**Configurações**
- Só da Company, editadas pelo Owner: fuso horário (padrão vem do navegador de quem cria a Company) e os dias em que as concluídas continuam visíveis.
- Padrão da Company que o Project pode sobrescrever: encerramento de Sprint e destino das Tarefas não terminadas.

**Fronteira com o Skeleton**: saem no Strip os Teams, o Manager, os Pipelines, os Projects, as Tarefas, as Sprints, os registros de tempo, a tela de Tarefas e os anexos no R2.

**Fora do escopo**: trocar o Pipeline de um Project; arquivar Project; menções e notificações; integração de PR com a forja.

Vocabulário registrado em `GLOSSARY.md`: Manager (movido para a Reference App), Project, Pipeline, Task, Column, Assignee, Time Entry, Dependency, Sprint, Backlog.
