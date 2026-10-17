# Modelo de organização da Reference App

Type: grilling
Status: resolved

## Question

Como se modelam Company, Team, membro e papéis? Pontos a fechar: um usuário pertence a uma ou várias Companies; a relação usuário–Team (vários Teams?); o fluxo de convite por email (convite pendente, expiração, usuário já existente vs novo); o que um Manager pode e não pode fazer; promoção e rebaixamento de Manager (pode remover o último Manager? o criador pode ser rebaixado?); remoção de membros e o que acontece com seus Tickets. Também: quais desses conceitos pertencem ao Skeleton (sobrevivem ao Strip) e quais à Reference App.

## Answer

**Company**
- Um usuário pode pertencer a várias Companies. A Company ativa vem da URL: `/c/<id>/...`, com um id aleatório e imutável (não é derivado do nome, então não colide nem muda ao renomear). A sessão guarda só a última Company usada, para o redirect depois do login. Duas abas podem estar em Companies diferentes.
- O nome não precisa ser único. Qualquer usuário verificado cria Companies, sem limite.
- Um usuário pode ficar sem Company (convidado ainda não aceito, saiu da última). A tela é "crie uma Company ou aguarde um convite".
- A exclusão é definitiva e imediata, com confirmação pelo nome, em cascata, e revoga os acessos MCP. Não há exclusão lógica.

**Roles** (da Company; valem em toda a app; o Team nunca concede permissão)
- **Owner**: exatamente um por Company. Transfere a posse para outro Member com confirmação pelo nome da Company, sem aceite do destinatário; o antigo Owner vira Manager.
- **Manager**: convida e remove Employees; reenvia e cancela convites de Employee, inclusive os enviados por outros.
- **Employee**: a role padrão.

| Ação | Owner | Manager | Employee |
|---|---|---|---|
| Convidar como Employee | ✅ | ✅ | ❌ |
| Convidar como Manager | ✅ | ❌ | ❌ |
| Promover Employee → Manager | ✅ | ❌ | ❌ |
| Rebaixar ou remover um Manager | ✅ | ❌ | ❌ |
| Remover um Employee | ✅ | ✅ | ❌ |
| Reenviar/cancelar convite de Employee | ✅ | ✅ | ❌ |
| Reenviar/cancelar convite de Manager | ✅ | ❌ | ❌ |
| Renomear a Company | ✅ | ❌ | ❌ |
| Transferir a posse / apagar a Company | ✅ | ❌ | ❌ |
| Criar, editar, apagar Teams e definir quem está neles | ✅ | ❌ | ❌ |
| Ver Members (nome, email, role) | ✅ | ✅ | ✅ |
| Ver convites pendentes | ✅ | ✅ | ❌ |
| Sair da Company | transfere antes | ✅ | ✅ |

Ninguém altera a própria role.

**Convites**
- Por email (Resend), validade de 7 dias. O link leva ao cadastro ou ao login e aceita o convite em seguida, com a role escolhida no convite.
- Só o email convidado aceita; logado com outro email, mostra erro e oferece trocar de conta.
- Reenviar renova a validade; cancelar é possível. Convidar quem já é Member é bloqueado.
- O convite pertence à Company e sobrevive à saída de quem o enviou.

**Saída de um Member** (removido ou saiu)
- Os Tickets atribuídos a ele ficam sem responsável; nada é apagado.
- O histórico continua mostrando o nome, com o rótulo "ex-membro". Se ele voltar por novo convite, o histórico é dele de novo (ligado ao usuário), mas os Tickets não voltam a ser dele.
- O acesso MCP àquela Company é revogado na hora (`revokeGrant`), e cada chamada de tool revalida o vínculo e a role.

**Conta**
- Verificação de email obrigatória antes de qualquer ação na Company.
- Nome editável. Trocar o email exige verificar o endereço novo; o antigo continua valendo até lá (sem isso, trocar para o email de um convite pendente permitiria aceitá-lo no lugar do convidado). Convites pendentes continuam presos ao email antigo.
- Excluir a própria conta é permitido (LGPD), mas bloqueado enquanto o usuário for Owner de alguma Company. Depois, ele aparece como "usuário removido" nos históricos.
- Senha: depende de [Trocas na stack](13-stack-swaps.md).

**Teams** (Reference App)
- Grupos planos de Members, sem role interna. Um Member pode estar em vários Teams ou em nenhum.

**Fronteira com o Skeleton**
- Fica no Skeleton: Companies, roles, convites, lista de Members, troca de role, remoção, sair da Company, transferência de posse, exclusão da Company, seletor de Company e a conta (nome, email, exclusão).
- Sai no Strip: Teams (e o que a Reference App acrescenta além deles).

**Repassado**
- Permissões sobre Projects, Sprints e Tickets por role, e o destino dos Projects de um Team apagado: [Modelo de projetos, Tickets e fluxo](11-projects-and-flow-model.md).
- Senha e troca de senha: [Trocas na stack](13-stack-swaps.md).

Vocabulário registrado em `GLOSSARY.md`: Company, Member, Owner, Manager, Employee, Invitation, Team.
