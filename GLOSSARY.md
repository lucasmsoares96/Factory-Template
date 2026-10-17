# Factory Template

A public repository template for an autonomous AI software factory: a harness that turns ready issues into reviewed pull requests, shipped with a reference app that demonstrates it.

## Language

### Factory

**Factory**:
The harness that takes a ready issue and, without human intervention, produces a pull request with evidence of what was built.
_Avoid_: Pipeline, bot

**Template**:
This repository, meant to be copied to start a new product that the factory builds.
_Avoid_: Boilerplate, starter

**Reference App**:
The example project-management application shipped inside the template to show the factory and the stack working; meant to be removed or adapted by whoever uses the template. Built by the factory itself, as its acceptance test.
_Avoid_: Demo, sample app

**Skeleton**:
The part of the template that stays after the Reference App is stripped: the stack wired end to end, with sign-up, Company creation, deploy and tests working.
_Avoid_: Boilerplate, base app

**Strip**:
Removing the Reference App from a copy of the template, leaving only the Skeleton, still green.

**Stage**:
One step of the factory's work on an issue: Exploration, Development, E2E, or Review. A failing E2E or Review stage sends the work back to Development.
_Avoid_: Phase, step

**Merge Gate**:
The point where a human reviews and merges the factory's pull request; the factory never merges its own work.

**Escalation**:
What the factory does when an issue fails E2E or Review five times: opens a draft pull request with its progress, explains the failure on the issue, and hands it to a human.
_Avoid_: Failure, abort

**Blocked Issue**:
A ready issue that the factory will not start until every issue blocking it has been merged.

### Organization (Skeleton)

**Company**:
The tenant: an organization whose Members share everything built inside it. A user can belong to several Companies and works in one at a time, the active Company.
_Avoid_: Organization, workspace, tenant, account

**Member**:
A user's membership in one Company, carrying exactly one role: Owner, Manager or Employee.
_Avoid_: User (when the Company relationship is meant), membership

**Owner**:
The role of the single Member who holds a Company and has the final say over it.
_Avoid_: Admin, creator

**Manager**:
The role of a Member trusted by the Owner to bring Employees in and out of the Company.
_Avoid_: Admin, lead

**Employee**:
The default role of a Member: works inside the Company without administering it.
_Avoid_: Contributor, collaborator, member (as a role)

**Invitation**:
A pending, expiring offer, sent by email, for a specific address to join a Company with a given role.
_Avoid_: Invite link

### Reference App

**Team**:
A flat, named group of Members within a Company. A Member can be in any number of Teams, or none; a Team grants no permissions of its own.
_Avoid_: Group, squad, department
