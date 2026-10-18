# Telas de métricas de tempo

Type: prototype
Status: open

## Question

Como ficam as telas de métricas da Reference App? As definições já estão em [Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md): tempo por Column (somando as voltas, com mediana por Project num período), tempo por Assignee em cada Column, tempo nas Columns de fila (gargalos) e cycle time. Os Time Entries guardam Column, Assignee e Sprint. Fazer um protótipo de UI barato para reagir a:

- **Onde moram**: uma tela por Project, uma da Company, ou abas na tela de Tarefas; o que cada role vê (Owner, Manager nos seus Teams, Employee).
- **Filtros**: período, Sprint, Team, Assignee.
- **Visualizações**: tabela, barras empilhadas por Column, distribuição do cycle time; o que é número e o que é gráfico.
- **Drill-down**: do número até as Tarefas que o compõem.
- **Biblioteca de gráficos** compatível com shadcn (Base UI) e gratuita.
