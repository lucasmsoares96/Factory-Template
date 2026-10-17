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
