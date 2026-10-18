# Factory Template

A public repository template for an autonomous AI software factory: a harness that turns ready issues into reviewed pull requests, shipped with a reference app that demonstrates it.

## Language

### Factory

**Factory**:
The harness that takes a ready issue and, without human intervention, produces a pull request with evidence of what was built.
_Avoid_: Pipeline, bot

**Template**:
This repository: the Factory and the Skeleton, meant to be copied to start a new product that the factory builds.
_Avoid_: Boilerplate, starter

**Reference App**:
The first product built on the Skeleton, a project-management application kept in its own repository, outside the template.
_Avoid_: Demo, sample app

**Skeleton**:
The application base shipped with the template: the stack wired end to end, with sign-up, Company creation, deploy and tests working. Every product, the Reference App included, is built on top of it. Built by the factory itself, as its acceptance test.
_Avoid_: Boilerplate, base app

**Stage**:
One step of the factory's work on an issue: Development, Review, or E2E. A failing E2E stage sends the work back to Development; Review fixes what it finds itself and never sends the work back.
_Avoid_: Phase, step

**Triage**:
The read-only pass that decides whether an issue can be built by the factory as written, and at which seams it will be tested.
_Avoid_: Exploration, explore

**Merge Gate**:
The point where a human reviews and merges the factory's pull request; the factory never merges its own work.

**Escalation**:
What the factory does when an issue fails E2E five times, runs out of time, or needs a human decision: opens a draft pull request with its progress, explains the failure on the issue, and hands it to a human.
_Avoid_: Failure, abort

**Blocked Issue**:
A ready issue that the factory will not start until every issue blocking it has been merged.

### Organization (Skeleton)

**Company**:
The tenant: an organization whose Members work inside it; what each Member sees within it depends on their role. A user can belong to several Companies and works in one at a time, the active Company.
_Avoid_: Organization, workspace, tenant, account

**Member**:
A user's membership in one Company, carrying exactly one role: Owner or Employee. A product built on the Skeleton may add roles of its own, such as the Reference App's Manager.
_Avoid_: User (when the Company relationship is meant), membership

**Owner**:
The role of the single Member who holds a Company and has the final say over it.
_Avoid_: Admin, creator

**Employee**:
The default role of a Member: works inside the Company without administering it.
_Avoid_: Contributor, collaborator, member (as a role)

**Invitation**:
A pending, expiring offer, sent by email, for a specific address to join a Company with a given role.
_Avoid_: Invite link

### Reference App

**Manager**:
The role of a Member who leads the Teams they belong to: runs those Teams' people and Projects, and nothing beyond them.
_Avoid_: Admin, lead, team lead

**Team**:
A flat, named group of Members within a Company, with no roles of its own. A Member can be in any number of Teams, or none. Managers and Employees see only the Projects linked to one of their Teams.
_Avoid_: Group, squad, department

**Project**:
A body of work owned by a Company, following one Pipeline. A Project can be linked to any number of Teams, and a Team to any number of Projects.
_Avoid_: Board, workspace

**Pipeline**:
A named, ordered set of Columns defined once per Company and shared by every Project that follows it.
_Avoid_: Workflow, board template

**Task**:
A unit of work inside a Project that moves from Column to Column until it is done.
_Avoid_: Ticket, card, issue (an issue is what the Factory works on)

**Column**:
One step of a Pipeline, of one of four kinds: entry (the first), queue, in progress, or done (the last). Time in an in-progress Column counts as work; time in a queue Column counts as waiting.
_Avoid_: Status, lane, stage (a Stage belongs to the Factory)

**Assignee**:
The one Member working a Task while it sits in an in-progress Column. A Task in any other kind of Column has no Assignee.
_Avoid_: Owner (a Company role), responsible

**Time Entry**:
One uninterrupted stretch a Task spent in a single in-progress or queue Column, credited to its Assignee (none, for a queue) and to the Sprint it was in at the time.
_Avoid_: Log, history, event

**Dependency**:
A link stating that a Task cannot start until another Task of the same Project is done. Dependencies never form a cycle.
_Avoid_: Blocker, blocked by

**Sprint**:
A time-box within a Project, pending, active or closed, holding the Tasks planned for it. A Task left unfinished can carry over into later Sprints, and the time spent on it stays with the Sprint in which it was spent.
_Avoid_: Iteration, cycle

**Backlog**:
The Tasks of a Project that are in no Sprint at the moment, waiting to be planned.
_Avoid_: Icebox, to-do list
