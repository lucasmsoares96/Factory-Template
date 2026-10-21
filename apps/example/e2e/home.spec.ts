import { existsSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_DIR, expect, test } from "@workspace/skeleton/e2e";
import { locales, messagesFor } from "@workspace/skeleton/i18n";
import productConfig from "../product.config.ts";

test("the Product's own spec runs and its print lands in the Product's evidence folder", { tag: "@evidence" }, async ({ page, t, evidence, product }) => {
  await page.goto("/sign-in");

  await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await evidence("product-sign-in");
  expect(existsSync(join(EVIDENCE_DIR, product, "product-sign-in.png"))).toBe(true);
});

test("every locale's sign-in tagline is the Product's own text, not the Skeleton's default description", () => {
  for (const locale of locales) {
    const tagline = messagesFor(locale, productConfig.messages).auth.signIn.description;
    expect(tagline, locale).not.toBe(messagesFor(locale).auth.signIn.description);
  }
});

test("the sign-in tagline is the agreed copy in each locale", () => {
  expect(messagesFor("en", productConfig.messages).auth.signIn.description).toBe("Your workspace, one sign-in away.");
  expect(messagesFor("pt-BR", productConfig.messages).auth.signIn.description).toBe("Seu espaço de trabalho, a um login de distância.");
});

test("the sign-in screen shows the Product's tagline right below its title", { tag: "@evidence" }, async ({ page, t, evidence }) => {
  await page.goto("/sign-in");

  const heading = page.getByRole("heading", { name: t.auth.signIn.title });
  await expect(heading).toBeVisible();
  // Right below the title: the element that follows the card title wrapping the heading.
  await expect(heading.locator("xpath=..").locator("xpath=following-sibling::*[1]")).toHaveText(t.auth.signIn.description);
  await evidence("sign-in-tagline");
});
