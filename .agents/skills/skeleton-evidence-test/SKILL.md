---
name: skeleton-evidence-test
description: Write a Playwright E2E test that proves a screen works and saves a print as evidence. Use when a ticket asks for an E2E test, or the Factory needs @evidence screenshots.
---

# Write an evidence test

E2E specs run on the local stack (Worker + Postgres + intercepted Resend). The model is `packages/skeleton/e2e/specs/home.spec.ts`. Specs import `test` and `expect` from the Skeleton's `e2e/index.ts` (`@workspace/skeleton/e2e`). `defineE2EConfig` runs those Skeleton specs in every Product, then the Product's own specs in `apps/<id>/e2e/*.spec.ts` (same `test`/`expect` import, same fixtures, same evidence folder). A Product's feature gets its spec there; never add Product specs to the Skeleton.

## Locating elements

Locate by role plus the i18n key, or by `data-testid`. Never by literal text, so the test survives a locale change.

```ts
import { expect, test } from "@workspace/skeleton/e2e";

test("a visitor lands on sign in", { tag: "@evidence" }, async ({ page, t, evidence }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await evidence("sign-in");
});
```

- `t` is the Product's messages for the build locale (Product overrides included). A Product feature's keys come from its `messages.ts`.
- `getByRole("button", { name: t.<key> })`, `getByLabel(t.<key>)`; use `getByTestId` only when there is no accessible role or label.
- `mailbox.latest(to)` and `linkIn(email)` read emails the Worker sent, for verification and reset flows.

## Evidence

1. Tag the test `{ tag: "@evidence" }` and call `await evidence("<name>")` once the screen shows the result being proved.
2. The print goes to `test-results/evidence/<product>/<name>.png` (fixed by the Skeleton; the Factory collects it). Use short kebab-case names that say what the print shows.
3. One print per behaviour the ticket asks for. Never print a loading state or an error you did not mean to show.
4. `pnpm --filter <id> run e2e`, then `pnpm factory:verify`. Open the PNG and check it shows what the name says.

## Do not

- Use `waitForTimeout`; wait on an assertion.
- Put secrets or real addresses in a print.
