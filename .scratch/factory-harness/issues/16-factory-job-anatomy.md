# Anatomia do job da Factory e interface do adaptador de forja

Type: grilling
Status: open

## Question

Como o job da Factory se divide entre YAML e código, e qual é a interface do adaptador de forja? Pontos a fechar:
- **Steps do workflow**: guard (permissão de quem rotulou, bloqueadores, lock) → setup (Node, Claude CLI, Docker/Postgres) → script Sandcastle (sem `FACTORY_TOKEN`) → push, PR e evidência (com `FACTORY_TOKEN`) → Escalation.
- **Onde vive o código**: por exemplo `.factory/` na raiz, fora dos pacotes da app, e como sobrevive ao Strip.
- **Interface do adaptador**: quais operações (partindo da tabela de cerca de 20 da pesquisa 14), em TS, chamadas por uma CLI pequena a partir dos steps. Usar a skill `codebase-design`: módulo profundo, seam na forja.
- **Agendador**: o workflow que re-dispara as Blocked Issues e como ele usa o mesmo adaptador.
- **Observabilidade**: logs do stream do Claude, resumo no job, custo por issue.
