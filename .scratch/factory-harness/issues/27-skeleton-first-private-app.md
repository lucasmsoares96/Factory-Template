# Skeleton primeiro, Reference App em repo privado

Type: grilling
Status: resolved

## Question

O template público precisa trazer a Reference App? O usuário quer publicar a Factory + Skeleton como código aberto e manter a aplicação final fechada. Isso muda o destino do mapa, o Strip e o teste de aceitação da Factory.

## Answer

Decidido em 2026-10-18 com o usuário.

- **Repo público** (`lucasmsoares96/Factory-Template`, MIT): Factory + Skeleton, sem a Reference App. O destino deste mapa passa a ser só a spec do harness + Skeleton e o backlog do Skeleton.
- **Repo privado**: a Reference App (ou a app final do usuário) vive num repo à parte, criado por `git push` para outro remote, e não pelo botão Fork, porque fork de repo público não pode ser privado. O repo público fica como `upstream`, e as melhorias do Skeleton entram por `git merge upstream/main`. O PRD da Reference App é um esforço separado, nesse repo.
- **Strip sai**: o repo público já é o Skeleton, então o `pnpm strip`, o manifesto e o job `strip-check` deixam de existir. Fica a convenção de [Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md) para apps construídas sobre o Skeleton: features em `features/<app>/`, pontos de contato num registro e num `routes.<app>.ts`, a app aponta para o Skeleton e nunca o contrário, com o `no-restricted-imports`.
- **Quem constrói o quê**: o usuário, com o Claude Code local, implementa o harness e a base que a Factory precisa para rodar (`platform/`, `pnpm factory:verify`, deploy e preview). A Factory constrói o resto do Skeleton a partir de issues `ready-for-agent` (cadastro, conta, Companies, convites). Esse é o novo teste de aceitação.
- **Fora deste mapa**: as Ferramentas do MCP da Reference App (o ticket passa a cobrir só o MCP do Skeleton), as Telas de métricas de tempo e a decisão de R2 de [R2 para anexos de Tarefas no Free e no preview por PR](22-r2-attachments-previews.md), que vale para o repo privado.
- **Manager sai do Skeleton**: as roles do Skeleton são `owner | employee`. A role do Member é guardada como `text`, com chave estrangeira para uma tabela de roles do Skeleton (`member_roles`, com as linhas `owner` e `employee`). O produto acrescenta `manager` com um `INSERT` numa migration própria, sem alterar estrutura do Skeleton, como pede a regra de expansão de [Puxar o Skeleton upstream num produto privado](28-upstream-skeleton-sync.md). Isso revê o Manager de [Layout do monorepo e fronteira do Strip](21-monorepo-layout-and-strip.md) e volta ao que [Modelo de projetos, Tarefas e fluxo](11-projects-and-flow-model.md) dizia (no Skeleton, só Owner e Employee).
- **Para o repo privado** (fica registrado aqui, não neste mapa): o GitHub Actions Free tem 2.000 min/mês em repo privado, e um job da Factory pode passar de 5 h. Os tickets 10, 11 e 22, o glossário da Reference App e o PRD vão para lá.
