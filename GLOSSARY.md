# Factory Template

A public repository template for an autonomous AI software factory: a harness that turns ready issues into reviewed pull requests, shipped with the Skeleton that products are built on.

## Language

### Factory

**Factory**:
The harness that takes a ready issue and, without human intervention, produces a pull request with evidence of what was built.
_Avoid_: Pipeline, bot

**Template**:
This repository: the Factory, the Skeleton and one example Product, meant to be copied to start a repository of Products that the factory builds.
_Avoid_: Boilerplate, starter

**Product**:
An application built on the Skeleton, with its own users, Companies, domain, database, Worker and deployment, kept in `apps/<id>/`. One repository can hold several Products, and a change to the Skeleton reaches all of them. A Product only extends the Skeleton (configuration, features, extra roles); it never edits it.
_Avoid_: App (ambiguous with an application package), tenant (a Company is the tenant), Project (a Reference App concept)

**Reference App**:
The first Product built on the Skeleton, a project-management application kept in its own repository, outside the template.
_Avoid_: Demo, sample app

**Skeleton**:
The application base shared by every Product in a repository, the package `packages/skeleton/`: the stack wired end to end, sign-up and sign-in, the OpenAPI to MCP bridge, account, Companies and Invitations. It is never deployed on its own, only as part of a Product. Its foundation, including sign-up and sign-in, is built by hand; the rest (account, Companies, Invitations) is built by the factory itself, as its acceptance test.
_Avoid_: Boilerplate, base app

**Stage**:
One step of the factory's work on an issue: Development, Review, E2E, or Pull Request. A failing E2E stage sends the work back to Development; Review fixes what it finds itself and never sends the work back. The Pull Request Stage runs once at the end, changes no code, and writes the pull request's description, Merge Danger included; always say "Pull Request Stage", since "pull request" alone means the pull request itself.
_Avoid_: Phase, step, write-up

**Triage**:
The read-only pass, started by the `agent:explore` label, that decides whether an issue can be built by the factory as written, and at which seams it will be tested. It ends in one verdict per issue: `easy-call` (queued for the factory), `needs-a-human` or `blocked`. With no valid verdict the issue is never queued by guess: it becomes `needs-a-human`.
_Avoid_: Exploration, explore

**Merge Gate**:
The point where a human reviews and merges the factory's pull request; the factory never merges its own work. When a pull request is ready or escalated, the Merge Gate notice, a comment from `github-actions[bot]`, mentions whoever started the run, since nobody is notified of what the factory itself writes.

**Escalation**:
What the factory does when it cannot finish an issue: it explains why on the issue, swaps `in-progress` for `ready-for-human`, and opens a draft pull request with its progress when there are commits. The reason is one of `e2e-failures` (five attempts failed), `time` (the global limit ran out), `needs-human` (a question for a person, or the criteria cannot be met without changing the Skeleton) or `infra` (the run left no result).
_Avoid_: Failure, abort

**Merge Danger**:
The risk of merging a Factory pull request, stated as a door (one-way, hard to walk back, or two-way, cheap to roll back) and a blast radius (what the change could break).
_Avoid_: Merge risk, risk summary

**Retro**:
A look back at an Escalation, or at a pull request where a human found something at the Merge Gate, that proposes changes to the Factory's environment (automated checks, coding standards, navigation) rather than the code. The Factory runs one on its own after each of those (the automatic Retro), but it only proposes, in a `needs-triage` issue: a human decides what becomes work.
_Avoid_: Postmortem, retrospective

**Blocked Issue**:
A ready issue that the factory will not start until every issue blocking it is closed as completed (its pull request merged). The factory answers "Waiting on #N", and starts it when the last blocker closes.

**Evidence**:
The screenshots of `@evidence` tests, saved in `test-results/evidence/<product>/` and shown inside the pull request body next to the text they support, grouped by Product.
_Avoid_: Screenshots (as a deliverable), proof

**Preview**:
A temporary deployment of one pull request: a Worker Preview `pr-N` and a Neon branch, deleted when the pull request closes. It is skipped when the Worker's bindings changed or nine previews are open.
_Avoid_: Staging, review app

**Factory marker**:
The hidden `<!-- factory -->` the factory puts in every text it writes. It writes with the owner's token, so the marker, not the author, tells its words from a person's.
_Avoid_: Bot signature, machine user

**Skeleton gap**:
What a Product issue needs that the Skeleton lacks. The factory reverts any Skeleton change made for a Product issue and opens an issue titled "The Skeleton must grow: ...", so the Skeleton grows in its own change.
_Avoid_: Workaround

**Default account**:
The one verified account `bootstrap product` creates in a Product's production database. The person uses it without signing up, and the post-deploy smoke test signs in with it.
_Avoid_: Admin user, test user

**Harness change**:
A change to the factory's own environment (`.factory/`, `AGENTS.md`, `GLOSSARY.md`, `docs/agents/`, `docs/adr/`, `CODING_STANDARDS.md`), or to a sensitive file (`.github/workflows/`, skills, `.claude/`, `.mcp.json`). The pull request gets the `harness-change` label and a warning; nothing is refused.

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

**Connection**:
An external AI agent that a user has authorized to use the app on their behalf, read-only or read-write, until the user revokes it.
_Avoid_: Integration, token, app

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
