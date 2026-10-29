import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "@workspace/skeleton/e2e";

test("a person subscribes to a fixed Plan in the local Checkout and comes back on it", { tag: "@evidence" }, async ({ page, baseURL, t, mailbox, evidence }) => {
  const email = `payer-${randomUUID()}@example.com`;
  const password = "correct horse battery";

  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL! },
    data: { name: "Ana Souza", email, password, callbackURL: "/email-verified" },
  });
  expect(signUp.ok()).toBe(true);
  const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
  expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
  await page.goto("/sign-in");
  await page.getByLabel(t.auth.signIn.email).fill(email);
  await page.getByLabel(t.auth.signIn.password).fill(password);
  await page.getByRole("button", { name: t.auth.signIn.submit }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/account/plan");
  await expect(page.getByRole("heading", { level: 1, name: t.billing.title })).toBeVisible();
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.free.name);
  await evidence("plan-before");

  // A declined card leaves the Plan as it was.
  await page.getByTestId("plan-prod_fake_pro").getByRole("button", { name: t.billing.subscribe }).click();
  await page.getByTestId("fake-checkout-decline").click();
  await expect(page.getByTestId("fake-checkout-declined")).toBeVisible();
  await page.goto("/account/plan");
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.free.name);

  await page.getByTestId("plan-prod_fake_pro").getByRole("button", { name: t.billing.subscribe }).click();
  await page.getByTestId("fake-checkout-pay").click();

  await expect(page).toHaveURL(/\/account\/plan/);
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.pro.name);
  await evidence("plan-after");
});
