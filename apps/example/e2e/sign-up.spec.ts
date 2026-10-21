import { expect, test } from "@workspace/skeleton/e2e";
import { passwordProblem } from "@workspace/skeleton/node";

/** The shortest password the server accepts, read from the same rule sign-up applies. */
function serverMinimumLength(): number {
  let length = 0;
  while (passwordProblem("a".repeat(length)) !== undefined) length += 1;
  return length;
}

test("sign up shows the server's minimum password length below the password field", { tag: "@evidence" }, async ({ page, t, evidence }) => {
  await page.goto("/sign-up");

  await expect(page.getByRole("heading", { name: t.auth.signUp.title })).toBeVisible();
  const password = page.getByLabel(t.auth.signUp.password);
  await expect(password).toHaveAccessibleDescription(t.auth.signUp.passwordHint);
  expect(t.auth.signUp.passwordHint).toContain(String(serverMinimumLength()));
  await evidence("product-sign-up-password-hint");
});
