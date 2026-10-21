import { existsSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_DIR, expect, test } from "@workspace/skeleton/e2e";
import { messagesFor, resolveLocale } from "@workspace/skeleton/i18n";

test("the Product's own spec runs and its print lands in the Product's evidence folder", { tag: "@evidence" }, async ({ page, t, evidence, product }) => {
  await page.goto("/sign-in");

  await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await evidence("product-sign-in");
  expect(existsSync(join(EVIDENCE_DIR, product, "product-sign-in.png"))).toBe(true);
});

test("the sign-in screen shows the Product's tagline right below its title", { tag: "@evidence" }, async ({ page, t, evidence }) => {
  // The tagline is the Product's own text, not the Skeleton's default description.
  expect(t.auth.signIn.description).not.toBe(messagesFor(resolveLocale(process.env.LOCALE)).auth.signIn.description);

  await page.goto("/sign-in");

  const heading = page.getByRole("heading", { name: t.auth.signIn.title });
  await expect(heading).toBeVisible();
  await expect(page.getByText(t.auth.signIn.description, { exact: true })).toBeVisible();
  // Right below the title: the first text after the heading's card title.
  await expect(heading.locator("xpath=..").locator("xpath=following-sibling::*[1]")).toHaveText(t.auth.signIn.description);
  await evidence("sign-in-tagline");
});
