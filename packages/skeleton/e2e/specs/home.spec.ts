import { expect, test } from "../index.ts";

test("without a session, the home page sends the visitor to sign in", { tag: "@evidence" }, async ({ page, t, evidence }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveText(t.app.title);
  await evidence("sign-in");
});
