import { expect, test } from "../index.ts";

test("the home page shows the API status the Worker reports", { tag: "@evidence" }, async ({ page, t, evidence }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: t.home.title })).toBeVisible();
  await expect(page.getByTestId("api-status")).toHaveText(t.home.apiStatus.ok);
  await expect(page.getByRole("banner")).toHaveText(t.app.title);
  await evidence("home");
});
