You are the Factory updating the branch of issue #{{NUMBER}} with `{{BASE}}`, in a fresh session. The harness already ran `git merge {{BASE}}` and it stopped on conflicts in:
{{CONFLICTS}}

Resolve every conflict and commit the merge. Preserve both intents, do not invent new behaviour. Read both sides' commits to understand what each one meant; when the issue's tests or the base branch's tests break, fix the merge, not the tests. Do not leave conflict markers, and do not finish without the merge commit.

When the merge brings a migration from `{{BASE}}` and the branch has its own unpublished migration in the same package, the chain forks (`skeleton migrations check-chain` fails): delete the branch's migration folder and generate it again on top of the newest migration from `{{BASE}}` (the `skeleton-add-migration` skill). Never change a migration that came from `{{BASE}}`.

{{RULES}}

{{ISSUE}}
