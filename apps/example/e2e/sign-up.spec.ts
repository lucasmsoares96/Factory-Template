import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "@workspace/skeleton/e2e";
import type { Messages } from "@workspace/skeleton/i18n";
import { passwordProblem } from "@workspace/skeleton/node";

/** The shortest password the server accepts, read from the same rule sign-up applies. */
function serverMinimumLength(): number {
  for (let length = 0; length <= 1024; length += 1) {
    if (passwordProblem("a".repeat(length)) === undefined) return length;
  }
  throw new Error("passwordProblem accepts no password made of a single repeated letter");
}

async function signUp(page: Page, t: Messages, password: string) {
  await page.goto("/sign-up");
  await page.getByLabel(t.auth.signUp.name).fill("Ana Souza");
  await page.getByLabel(t.auth.signUp.email).fill(`visitor-${randomUUID()}@example.com`);
  await page.getByLabel(t.auth.signUp.password).fill(password);
  await page.getByRole("button", { name: t.auth.signUp.submit }).click();
}

test("sign up shows the server's minimum password length below the password field", { tag: "@evidence" }, async ({ page, t, evidence }) => {
  await page.goto("/sign-up");

  await expect(page.getByRole("heading", { name: t.auth.signUp.title })).toBeVisible();
  const password = page.getByLabel(t.auth.signUp.password);
  await expect(password).toHaveAccessibleDescription(t.auth.signUp.passwordHint);
  expect(t.auth.signUp.passwordHint).toMatch(new RegExp(`(?<!\\d)${serverMinimumLength()}(?!\\d)`));
  await evidence("product-sign-up-password-hint");
});

test("the server refuses a password one character shorter than the hint says", async ({ page, t }) => {
  await signUp(page, t, "a".repeat(serverMinimumLength() - 1));

  await expect(page.getByRole("alert")).toHaveText(t.errors.PASSWORD_TOO_SHORT);
  await expect(page.getByRole("heading", { name: t.auth.signUp.title })).toBeVisible();
});

test("the server accepts a password exactly as long as the hint says", async ({ page, t }) => {
  await signUp(page, t, "a".repeat(serverMinimumLength()));

  await expect(page.getByRole("heading", { name: t.auth.checkEmail.title })).toBeVisible();
});
