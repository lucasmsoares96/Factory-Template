import { existsSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_DIR, expect, test } from "@workspace/skeleton/e2e";

test("the Product's own spec runs and its print lands in the Product's evidence folder", { tag: "@evidence" }, async ({ page, t, evidence, product }) => {
  await page.goto("/sign-in");

  await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await evidence("product-sign-in");
  expect(existsSync(join(EVIDENCE_DIR, product, "product-sign-in.png"))).toBe(true);
});
